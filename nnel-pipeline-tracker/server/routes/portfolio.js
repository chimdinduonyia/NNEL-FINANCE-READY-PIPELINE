'use strict';
/**
 * routes/portfolio.js
 *
 * GET /api/portfolio          — project list with funnel grouping + filters
 * GET /api/portfolio/kpis     — aggregate KPI metrics
 * GET /api/decisions/pending  — decisions the current user must action
 *
 * These three endpoints power the portfolio landing screen (§4 Tier 1).
 */

const pool = require('../db');
const { requireLogin } = require('../middleware/auth');
const { getProjectMember, getRequiredAuthority } = require('../middleware/permissions');
const { sendJSON, sendError } = require('../utils/response');
const { getStageNameMapForVersionString } = require('../services/stageNames');

// Map project current_stage to the portfolio funnel tier (§4)
function getFunnelStage(stageNumber) {
  if (stageNumber === 0) return 'horizon';
  if (stageNumber === 1) return 'hopper';
  if (stageNumber <= 3) return 'funnel';
  return 'project';
}

// ---------------------------------------------------------------------------
// GET /api/portfolio
//
// Returns projects visible to the current user, each enriched with:
//   funnel_stage, current stage status, open condition count, and a
//   days_since_submitted value so the UI can surface stalled reviews.
//
// Query params (all optional):
//   technology    — exact-match technology filter
//   funnel        — horizon | hopper | funnel | project
//   pending       — true: show only stages currently awaiting a decision
//   at_risk       — true: show only is_at_risk = 1 projects
// ---------------------------------------------------------------------------
async function getPortfolio(req, res) {
  const user = await requireLogin(req, res);
  if (!user) return;

  const url = new URL(req.url, 'http://localhost');
  const technology = url.searchParams.get('technology');
  const funnel     = url.searchParams.get('funnel');
  const pending    = url.searchParams.get('pending') === 'true';
  const atRisk     = url.searchParams.get('at_risk') === 'true';

  const stageRange = { horizon: [0,0], hopper: [1,1], funnel: [2,3], project: [4,5] }[funnel] ?? null;

  const params = [];

  let query = `
    SELECT
      p.id, p.name, p.description, p.capex_usd, p.current_stage,
      p.status, p.technology, p.is_at_risk, p.created_at,
      ps.status         AS stage_status,
      ps.submitted_at,
      ps.review_round,
      DATEDIFF(NOW(), ps.submitted_at) AS days_since_submitted,
      ts_cur.name AS stage_name_db,
      (SELECT COUNT(*) FROM gate_conditions gc
       JOIN gate_decisions gd ON gd.id = gc.gate_decision_id
       WHERE gc.project_id = p.id
         AND gc.stage_number = p.current_stage
         AND gc.is_closed = 0
         AND gd.review_round = ps.review_round) AS open_conditions,
      COALESCE(
        (SELECT ROUND(100.0 * SUM(sc.is_complete) / NULLIF(COUNT(*), 0))
         FROM stage_checklist sc
         WHERE sc.project_id = p.id AND sc.stage_number = p.current_stage),
        0
      ) AS stage_pct,
      NULL AS my_role
    FROM projects p
    LEFT JOIN project_stages ps
      ON ps.project_id = p.id AND ps.stage_number = p.current_stage
    LEFT JOIN template_versions tv_cur ON tv_cur.version = p.template_version
    LEFT JOIN template_stages ts_cur
      ON ts_cur.template_version_id = tv_cur.id AND ts_cur.stage_number = p.current_stage
  `;

  // Admins and project managers see all projects.
  // All other roles see only their own projects (joined through membership).
  if (!['admin','project_manager'].includes(user.system_role)) {
    query = query.replace('NULL AS my_role', 'pm.role AS my_role');
    query += ' JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = ?';
    params.push(user.id);
  }

  const where = ["p.status != 'cancelled'"];

  if (technology) { where.push('p.technology = ?'); params.push(technology); }
  if (stageRange)  { where.push('p.current_stage BETWEEN ? AND ?'); params.push(...stageRange); }
  if (pending)     { where.push("ps.status = 'submitted'"); }
  if (atRisk)      { where.push('p.is_at_risk = 1'); }

  query += ' WHERE ' + where.join(' AND ');
  query += ' ORDER BY p.is_at_risk DESC, p.current_stage DESC, p.created_at DESC';

  const [projects] = await pool.execute(query, params);

  sendJSON(res, 200, projects.map(p => ({
    ...p,
    funnel_stage: getFunnelStage(p.current_stage),
    stage_name:   p.stage_name_db ?? `Stage ${p.current_stage}`,
    has_open_conditions: Number(p.open_conditions) > 0,
    open_conditions: Number(p.open_conditions),
    days_since_submitted: p.submitted_at ? Number(p.days_since_submitted) : null,
  })));
}

// ---------------------------------------------------------------------------
// GET /api/portfolio/kpis
//
// Aggregate metrics for the dashboard header cards.
// Admins see portfolio-wide numbers; others see only their projects.
// ---------------------------------------------------------------------------
async function getKPIs(req, res) {
  const user = await requireLogin(req, res);
  if (!user) return;

  const memberJoin = ['admin','project_manager'].includes(user.system_role)
    ? ''
    : `JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = ${pool.escape(user.id)}`;

  // Project counts by status and funnel stage
  const [[counts]] = await pool.execute(`
    SELECT
      COUNT(CASE WHEN p.status = 'active'             THEN 1 END) AS total_active,
      COUNT(CASE WHEN p.status = 'completed'          THEN 1 END) AS completed,
      COUNT(CASE WHEN p.status = 'on_hold'            THEN 1 END) AS on_hold,
      COUNT(CASE WHEN p.is_at_risk = 1
                  AND p.status = 'active'             THEN 1 END) AS at_risk,
      COUNT(CASE WHEN p.current_stage = 0             THEN 1 END) AS horizon,
      COUNT(CASE WHEN p.current_stage = 1             THEN 1 END) AS hopper,
      COUNT(CASE WHEN p.current_stage IN (2,3)        THEN 1 END) AS funnel_stage,
      COUNT(CASE WHEN p.current_stage IN (4,5)        THEN 1 END) AS project_stage
    FROM projects p ${memberJoin}
    WHERE p.status != 'cancelled'
  `);

  // Stages currently awaiting a gate decision
  const [[{ awaiting_decisions }]] = await pool.execute(`
    SELECT COUNT(*) AS awaiting_decisions
    FROM project_stages ps
    JOIN projects p ON p.id = ps.project_id ${memberJoin}
    WHERE ps.status = 'submitted' AND p.status = 'active'
  `);

  // Projects stuck on open conditions
  const [[{ open_conditions_count }]] = await pool.execute(`
    SELECT COUNT(DISTINCT ps.project_id) AS open_conditions_count
    FROM project_stages ps
    JOIN projects p ON p.id = ps.project_id ${memberJoin}
    WHERE ps.status = 'conditional' AND p.status = 'active'
      AND EXISTS (
        SELECT 1 FROM gate_conditions gc
        JOIN gate_decisions gd ON gd.id = gc.gate_decision_id
        WHERE gc.project_id = ps.project_id
          AND gc.stage_number = ps.stage_number
          AND gc.is_closed = 0
          AND gd.review_round = ps.review_round
      )
  `);

  sendJSON(res, 200, {
    total_active: Number(counts.total_active),
    completed: Number(counts.completed),
    on_hold: Number(counts.on_hold),
    at_risk: Number(counts.at_risk),
    awaiting_decisions: Number(awaiting_decisions),
    open_conditions: Number(open_conditions_count),
    by_funnel: {
      horizon:  Number(counts.horizon),
      hopper:   Number(counts.hopper),
      funnel:   Number(counts.funnel_stage),
      project:  Number(counts.project_stage),
    },
  });
}

// ---------------------------------------------------------------------------
// GET /api/decisions/pending
//
// Returns stages where the current user is the NEXT approver in the chain.
// This powers the "Decisions awaiting me" queue on the approver's landing
// screen (spec §4).
//
// The check is: stage is 'submitted', user is a gate_approver on the project,
// and their authority matches the required authority at the next chain index.
// Segregation of duties is also enforced (submitter ≠ approver).
// ---------------------------------------------------------------------------
async function getPendingDecisions(req, res) {
  const user = await requireLogin(req, res);
  if (!user) return;

  // Admins and project managers manage the system; they don't have a personal approver queue
  if (['admin','project_manager'].includes(user.system_role)) return sendJSON(res, 200, []);

  // Find submitted stages where this user is assigned as gate_approver
  const [candidates] = await pool.execute(`
    SELECT
      p.id AS project_id, p.name AS project_name, p.capex_usd, p.template_version,
      ps.stage_number, ps.submitted_at, ps.submitted_by,
      ps.capex_at_submission, ps.review_round,
      pm.approver_authority
    FROM project_stages ps
    JOIN projects p ON p.id = ps.project_id
    JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = ?
    WHERE ps.status = 'submitted'
      AND pm.role = 'gate_approver'
      AND p.status = 'active'
  `, [user.id]);

  const pending = [];
  const stageNameCache = {}; // template_version string -> { stage_number: name }, avoids re-querying per row

  for (const row of candidates) {
    // Segregation of duties
    if (row.submitted_by === user.id) continue;

    const required = await getRequiredAuthority(row.stage_number, row.capex_at_submission, row.project_id);
    if (required.length === 0) continue;

    // Count decisions already recorded for the current round
    const [signed] = await pool.execute(
      `SELECT id FROM gate_decisions
       WHERE project_id = ? AND stage_number = ? AND review_round = ?`,
      [row.project_id, row.stage_number, row.review_round]
    );
    const nextIndex = signed.length;
    if (nextIndex >= required.length) continue;
    if (row.approver_authority !== required[nextIndex]) continue;

    if (!stageNameCache[row.template_version]) {
      stageNameCache[row.template_version] = await getStageNameMapForVersionString(row.template_version);
    }

    pending.push({
      project_id:        row.project_id,
      project_name:      row.project_name,
      capex_usd:         row.capex_usd,
      stage_number:      row.stage_number,
      stage_name:        stageNameCache[row.template_version][row.stage_number] ?? `Stage ${row.stage_number}`,
      submitted_at:      row.submitted_at,
      capex_at_submission: row.capex_at_submission,
      my_authority:      row.approver_authority,
      chain_position:    nextIndex + 1,
      total_in_chain:    required.length,
      days_waiting:      row.submitted_at
        ? Math.floor((Date.now() - new Date(row.submitted_at).getTime()) / 86400000)
        : 0,
    });
  }

  sendJSON(res, 200, pending);
}

// ---------------------------------------------------------------------------
// GET /api/decisions/rejected
//
// Returns stages that were auto-reopened after a NO-GO, where the current
// user was the one who submitted that stage. Powers the rejection banner on
// the dashboard. Disappears automatically once the stage is re-submitted.
// Uses audit_log (not project_members) because submitted_by is cleared on
// auto-reopen and project managers may not have a project_members row.
// ---------------------------------------------------------------------------
async function getRejectedDecisions(req, res) {
  const user = await requireLogin(req, res);
  if (!user) return;

  // Admins see everything via the management UI — no banner needed.
  if (user.system_role === 'admin') return sendJSON(res, 200, []);

  const [rows] = await pool.execute(`
    SELECT DISTINCT
      p.id          AS project_id,
      p.name        AS project_name,
      p.template_version,
      ps.stage_number,
      ps.review_round,
      gd.rationale,
      gd.created_at AS decided_at,
      gd.authority,
      u.full_name   AS decided_by_name
    FROM project_stages ps
    JOIN projects p ON p.id = ps.project_id
    JOIN gate_decisions gd
      ON  gd.project_id   = ps.project_id
      AND gd.stage_number = ps.stage_number
      AND gd.decision     = 'no_go'
      AND gd.review_round = ps.review_round - 1
    JOIN users u ON u.id = gd.decided_by
    JOIN audit_log al
      ON  al.project_id   = ps.project_id
      AND al.stage_number = ps.stage_number
      AND al.action       = 'stage_submitted'
      AND al.user_id      = ?
    WHERE ps.status      = 'in_progress'
      AND ps.review_round > 1
      AND p.status       = 'active'
    ORDER BY gd.created_at DESC
  `, [user.id]);

  const stageNameCache = {};
  const result = [];
  for (const r of rows) {
    if (!stageNameCache[r.template_version]) {
      stageNameCache[r.template_version] = await getStageNameMapForVersionString(r.template_version);
    }
    result.push({
      project_id:      r.project_id,
      project_name:    r.project_name,
      stage_number:    r.stage_number,
      stage_name:      stageNameCache[r.template_version][r.stage_number] ?? `Stage ${r.stage_number}`,
      rationale:       r.rationale,
      decided_at:      r.decided_at,
      authority:       r.authority,
      decided_by_name: r.decided_by_name,
    });
  }

  sendJSON(res, 200, result);
}

module.exports = { getPortfolio, getKPIs, getPendingDecisions, getRejectedDecisions, getFunnelStage };
