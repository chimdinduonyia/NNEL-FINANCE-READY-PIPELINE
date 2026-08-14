'use strict';
/**
 * routes/raci.js — Project RACI Matrix
 *
 * GET  /api/projects/:id/raci — full matrix (all project members)
 * POST /api/projects/:id/raci — upsert one cell (admin only)
 *
 * The matrix is pre-defined: rows are fixed activities from the FRP,
 * columns are the current project_members. Cells hold R/A/C/I or null.
 */

const pool = require('../db');
const { requireLogin }  = require('../middleware/auth');
const { canViewProject, hasProjectRole } = require('../middleware/permissions');
const { sendJSON, sendError } = require('../utils/response');
const { readBody }            = require('../utils/bodyParser');
const auditLog = require('../services/auditLog');

// PM can edit RACI for projects they created or lead
async function pmCanEditRaci(userId, projectId) {
  const [[proj]] = await pool.execute('SELECT created_by FROM projects WHERE id = ?', [projectId]);
  if (proj?.created_by === userId) return true;
  return hasProjectRole(projectId, userId, ['project_lead']);
}

const RACI_ACTIVITIES = [
  // Stages
  { key: 'Stage 0: Opportunity Screening',    group: 'Stages' },
  { key: 'Stage 1: Preliminary Assessment',   group: 'Stages' },
  { key: 'Stage 2: Technical Due Diligence',  group: 'Stages' },
  { key: 'Stage 2: Commercial Structure',     group: 'Stages' },
  { key: 'Stage 2: Legal & Regulatory',       group: 'Stages' },
  { key: 'Stage 2: Financial Modelling',      group: 'Stages' },
  { key: 'Stage 3: Information Memorandum',   group: 'Stages' },
  { key: 'Stage 3: Lender Engagement',        group: 'Stages' },
  { key: 'Stage 3: Data Room Management',     group: 'Stages' },
  { key: 'Stage 4: CP Management',            group: 'Stages' },
  { key: 'Stage 4: Construction Readiness',   group: 'Stages' },
  { key: 'Stage 5: Commissioning Oversight',  group: 'Stages' },
  { key: 'Stage 5: Post-COD Reporting',       group: 'Stages' },
  // Cross-cutting
  { key: 'Gate 0/1 Decision',             group: 'Cross-cutting' },
  { key: 'Gate 2 Decision',               group: 'Cross-cutting' },
  { key: 'Gate 3/Financial Close',        group: 'Cross-cutting' },
  { key: 'Financial Model Development',   group: 'Cross-cutting' },
  { key: 'Community Engagement',          group: 'Cross-cutting' },
];

// ---------------------------------------------------------------------------
// GET /api/projects/:id/raci
// ---------------------------------------------------------------------------
async function getRaci(req, res, params) {
  const user = await requireLogin(req, res);
  if (!user) return;

  const projectId = parseInt(params.id, 10);
  if (!projectId) return sendError(res, 400, 'Invalid project id');

  if (!await canViewProject(user.id, user.system_role, projectId)) {
    return sendError(res, 403, 'Forbidden');
  }

  // Members (columns)
  const [members] = await pool.execute(
    `SELECT pm.user_id, u.full_name, u.email, pm.role, pm.workstream, pm.approver_authority
     FROM project_members pm
     JOIN users u ON u.id = pm.user_id
     WHERE pm.project_id = ?
     ORDER BY pm.created_at`,
    [projectId]
  );

  // All stored cells for this project
  const [rows] = await pool.execute(
    'SELECT activity, user_id, raci_code FROM project_raci WHERE project_id = ?',
    [projectId]
  );

  // Build cell map: { activity: { userId: raci_code } }
  const cells = {};
  rows.forEach(r => {
    if (!cells[r.activity]) cells[r.activity] = {};
    cells[r.activity][r.user_id] = r.raci_code;
  });

  sendJSON(res, 200, {
    activities: RACI_ACTIVITIES,
    members,
    cells,
  });
}

// ---------------------------------------------------------------------------
// POST /api/projects/:id/raci
// Upserts a single cell. Admin only.
// Body: { activity, user_id, raci_code }  (raci_code null = clear the cell)
// ---------------------------------------------------------------------------
async function upsertCell(req, res, params) {
  const user = await requireLogin(req, res);
  if (!user) return;

  const projectId = parseInt(params.id, 10);
  if (!projectId) return sendError(res, 400, 'Invalid project id');

  if (user.system_role === 'project_manager') {
    if (!await pmCanEditRaci(user.id, projectId)) {
      return sendError(res, 403, 'Project managers can only edit the RACI for projects they created or lead');
    }
  } else if (user.system_role !== 'admin') {
    return sendError(res, 403, 'Forbidden');
  }

  let body;
  try { body = await readBody(req); } catch { return sendError(res, 400, 'Invalid JSON'); }

  const { activity, user_id, raci_code } = body;

  const validActivity = RACI_ACTIVITIES.some(a => a.key === activity);
  if (!validActivity) return sendError(res, 400, 'Invalid activity');
  if (!user_id)       return sendError(res, 400, 'user_id is required');
  if (raci_code !== null && raci_code !== undefined && !['R','A','C','I'].includes(raci_code)) {
    return sendError(res, 400, 'raci_code must be R, A, C, I, or null');
  }

  // Verify target user is a member of this project
  const [[member]] = await pool.execute(
    'SELECT user_id FROM project_members WHERE project_id = ? AND user_id = ?',
    [projectId, user_id]
  );
  if (!member) return sendError(res, 400, 'User is not a member of this project');

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    if (!raci_code) {
      // Clear cell: delete the row
      await conn.execute(
        'DELETE FROM project_raci WHERE project_id = ? AND activity = ? AND user_id = ?',
        [projectId, activity, user_id]
      );
    } else {
      // Upsert
      await conn.execute(
        `INSERT INTO project_raci (project_id, activity, user_id, raci_code, updated_by)
         VALUES (?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE raci_code = VALUES(raci_code), updated_by = VALUES(updated_by), updated_at = NOW()`,
        [projectId, activity, user_id, raci_code, user.id]
      );
    }

    await auditLog.log(conn, {
      userId: user.id,
      action: 'raci_cell_updated',
      projectId,
      detail: { activity, target_user_id: user_id, raci_code: raci_code || null },
    });

    await conn.commit();
    sendJSON(res, 200, { updated: true });
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

module.exports = { getRaci, upsertCell, RACI_ACTIVITIES };
