'use strict';
/**
 * routes/memo.js — Internal Memo Export
 *
 * GET /api/projects/:id/memo
 * Returns all data needed to render the print-ready internal memo.
 * Permission: Project Lead or Admin only (server-side enforced).
 */

const pool = require('../db');
const { requireLogin }  = require('../middleware/auth');
const { getProjectMember } = require('../middleware/permissions');
const { sendJSON, sendError } = require('../utils/response');
const { getStageNameMapForVersionString } = require('../services/stageNames');

async function getMemo(req, res, params) {
  const user = await requireLogin(req, res);
  if (!user) return;

  const projectId = parseInt(params.id, 10);
  if (!projectId) return sendError(res, 400, 'Invalid project id');

  // Permission: admin or project_lead
  if (user.system_role !== 'admin') {
    const member = await getProjectMember(projectId, user.id);
    if (!member || member.role !== 'project_lead') {
      return sendError(res, 403, 'Forbidden — only Project Lead or Admin can export the memo');
    }
  }

  // 1. Project info
  const [[project]] = await pool.execute(
    `SELECT id, name, description, capex_usd, current_stage, status,
            technology, is_at_risk, created_at, template_version,
            objectives, justification, benefits
     FROM projects WHERE id = ?`,
    [projectId]
  );
  if (!project) return sendError(res, 404, 'Project not found');

  const stageNameMap = await getStageNameMapForVersionString(project.template_version);

  // 2. Team members
  const [members] = await pool.execute(
    `SELECT pm.user_id, u.full_name, u.email, pm.role,
            pm.workstream, pm.approver_authority
     FROM project_members pm
     JOIN users u ON u.id = pm.user_id
     WHERE pm.project_id = ?
     ORDER BY pm.created_at`,
    [projectId]
  );

  // 3. Stage statuses with checklist completion counts and submission summaries
  const [stages] = await pool.execute(
    `SELECT ps.stage_number, ps.status, ps.submitted_at, ps.submission_summary,
            COUNT(sc.id)                               AS checklist_total,
            SUM(CASE WHEN sc.is_complete = 1 THEN 1 ELSE 0 END) AS checklist_done
     FROM project_stages ps
     LEFT JOIN stage_checklist sc
       ON sc.project_id = ps.project_id AND sc.stage_number = ps.stage_number
     WHERE ps.project_id = ?
     GROUP BY ps.stage_number, ps.status, ps.submitted_at, ps.submission_summary
     ORDER BY ps.stage_number`,
    [projectId]
  );

  // 4. Gate decisions (all rounds, all stages)
  const [decisions] = await pool.execute(
    `SELECT gd.stage_number, gd.decision, gd.authority, gd.rationale,
            gd.chain_position, gd.review_round, gd.created_at,
            u.full_name AS decided_by_name
     FROM gate_decisions gd
     JOIN users u ON u.id = gd.decided_by
     WHERE gd.project_id = ?
     ORDER BY gd.stage_number, gd.review_round, gd.chain_position`,
    [projectId]
  );

  // 5. Open conditions
  const [openConditions] = await pool.execute(
    `SELECT gc.description, gc.created_at,
            gd.stage_number, gd.authority
     FROM gate_conditions gc
     JOIN gate_decisions gd ON gd.id = gc.gate_decision_id
     WHERE gc.project_id = ? AND gc.is_closed = 0
     ORDER BY gd.stage_number, gc.id`,
    [projectId]
  );

  // 6. Document register (submitted + approved only for memo)
  const [documents] = await pool.execute(
    `SELECT dr.title, dr.status, dr.stage_number,
            vf.folder_code, vf.name AS folder_name
     FROM document_register dr
     JOIN template_vdr_folders vf ON vf.id = dr.vdr_folder_id
     WHERE dr.project_id = ?
     ORDER BY vf.sort_order, dr.stage_number`,
    [projectId]
  );

  // Enrich stages with names
  const stagesEnriched = stages.map(s => ({
    ...s,
    stage_name: stageNameMap[s.stage_number] ?? `Stage ${s.stage_number}`,
    checklist_pct: s.checklist_total > 0
      ? Math.round((Number(s.checklist_done) / Number(s.checklist_total)) * 100)
      : 0,
  }));

  sendJSON(res, 200, {
    generated_at: new Date().toISOString(),
    project,
    members,
    stages: stagesEnriched,
    decisions,
    open_conditions: openConditions,
    documents,
  });
}

module.exports = { getMemo };
