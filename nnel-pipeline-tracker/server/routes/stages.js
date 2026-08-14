'use strict';
/**
 * routes/stages.js
 *
 * GET   /api/projects/:id/stages/:stage                   — stage state + gate routing summary
 * GET   /api/projects/:id/stages/:stage/checklist         — checklist items with completion state
 * PATCH /api/projects/:id/stages/:stage/checklist/:itemId — tick/untick item + evidence note
 */

const pool = require('../db');
const { requireLogin } = require('../middleware/auth');
const {
  canViewProject,
  canEditWorkingData,
  getRequiredAuthority,
  hasProjectRole,
} = require('../middleware/permissions');
const { sendJSON, sendError } = require('../utils/response');
const { readBody } = require('../utils/bodyParser');
const auditLog = require('../services/auditLog');

// ---------------------------------------------------------------------------
// GET /api/projects/:id/stages/:stage
// Returns the stage state with a gate-routing summary so the frontend
// can show who needs to approve and whether all prerequisites are met.
// ---------------------------------------------------------------------------
async function getStage(req, res, params) {
  const user = await requireLogin(req, res);
  if (!user) return;

  const projectId = parseInt(params.id, 10);
  const stageNumber = parseInt(params.stage, 10);
  if (!projectId || isNaN(stageNumber) || stageNumber < 0 || stageNumber > 5) {
    return sendError(res, 400, 'Invalid project id or stage number');
  }

  if (!await canViewProject(user.id, user.system_role, projectId)) {
    return sendError(res, 403, 'Forbidden');
  }

  // Stage state
  const [[stage]] = await pool.execute(
    `SELECT ps.stage_number, ps.status, ps.submitted_by, ps.submitted_at,
            ps.capex_at_submission, u.full_name AS submitted_by_name
     FROM project_stages ps
     LEFT JOIN users u ON u.id = ps.submitted_by
     WHERE ps.project_id = ? AND ps.stage_number = ?`,
    [projectId, stageNumber]
  );
  if (!stage) return sendError(res, 404, 'Stage not found');

  // Checklist summary (total items / complete items)
  const [[summary]] = await pool.execute(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN sc.is_complete = 1 THEN 1 ELSE 0 END) AS complete
     FROM stage_checklist sc
     WHERE sc.project_id = ? AND sc.stage_number = ?`,
    [projectId, stageNumber]
  );

  // Gate routing (uses capex locked at submission, or current project capex if not yet submitted)
  const [[project]] = await pool.execute('SELECT capex_usd FROM projects WHERE id = ?', [projectId]);
  const capexForRouting = stage.capex_at_submission ?? project?.capex_usd ?? 0;
  const requiredApprovers = await getRequiredAuthority(stageNumber, capexForRouting, projectId);

  sendJSON(res, 200, {
    ...stage,
    checklist_summary: { total: Number(summary.total), complete: Number(summary.complete) },
    required_approvers: requiredApprovers,
    capex_used_for_routing: capexForRouting,
  });
}

// ---------------------------------------------------------------------------
// GET /api/projects/:id/stages/:stage/checklist
// Returns all checklist items for this stage with their current completion
// state. Role-filtered: contributors see only their own pillar's items.
// ---------------------------------------------------------------------------
async function getChecklist(req, res, params) {
  const user = await requireLogin(req, res);
  if (!user) return;

  const projectId = parseInt(params.id, 10);
  const stageNumber = parseInt(params.stage, 10);
  if (!projectId || isNaN(stageNumber) || stageNumber < 0 || stageNumber > 5) {
    return sendError(res, 400, 'Invalid project id or stage number');
  }

  if (!await canViewProject(user.id, user.system_role, projectId)) {
    return sendError(res, 403, 'Forbidden');
  }

  // Confirm stage exists and has been opened
  const [[stage]] = await pool.execute(
    'SELECT status FROM project_stages WHERE project_id = ? AND stage_number = ?',
    [projectId, stageNumber]
  );
  if (!stage) return sendError(res, 404, 'Stage not found');
  // not_started stages are allowed — returns template items with is_complete=0
  // so the frontend can show a read-only preview of what this stage will require.

  // Contributors see ALL items — the frontend greys out items outside their
  // workstream, and canEditWorkingData() server-side rejects any save attempt
  // on a pillar that doesn't match their workstream assignment.

  // Build query — LEFT JOIN so items with no progress row still appear
  // (handles edge cases where rows weren't initialised for some reason)
  const [items] = await pool.execute(`
    SELECT
      tci.id                AS checklist_item_id,
      tci.item_code,
      tci.pillar,
      tci.description,
      tci.guidance,
      tci.is_mandatory,
      tci.sort_order,
      COALESCE(sc.is_complete, 0)   AS is_complete,
      sc.evidence_note,
      sc.completed_by,
      u.full_name           AS completed_by_name,
      sc.completed_at
    FROM template_checklist_items tci
    JOIN template_versions tv
      ON tv.id = tci.template_version_id
    JOIN projects p
      ON p.template_version = tv.version AND p.id = ?
    LEFT JOIN stage_checklist sc
      ON sc.checklist_item_id = tci.id
      AND sc.project_id = ?
      AND sc.stage_number = ?
    LEFT JOIN users u
      ON u.id = sc.completed_by
    WHERE tci.stage_number = ? AND tci.is_active = 1
    ORDER BY tci.sort_order, tci.item_code`,
    [projectId, projectId, stageNumber, stageNumber]
  );

  // Count items that exist in this stage but have been disabled in the template,
  // so the frontend can show a notice without rendering the items themselves.
  const [[{ deactivated_count }]] = await pool.execute(`
    SELECT COUNT(*) AS deactivated_count
    FROM template_checklist_items tci
    JOIN template_versions tv ON tv.id = tci.template_version_id
    JOIN projects p ON p.template_version = tv.version AND p.id = ?
    WHERE tci.stage_number = ? AND tci.is_active = 0`,
    [projectId, stageNumber]
  );

  sendJSON(res, 200, { items, deactivated_count: Number(deactivated_count) });
}

// ---------------------------------------------------------------------------
// PATCH /api/projects/:id/stages/:stage/checklist/:itemId
// Ticks or unticks a checklist item and optionally records an evidence note.
// Enforces submission lock: if the stage is submitted/approved, this fails.
// ---------------------------------------------------------------------------
async function updateChecklistItem(req, res, params) {
  const user = await requireLogin(req, res);
  if (!user) return;

  const projectId = parseInt(params.id, 10);
  const stageNumber = parseInt(params.stage, 10);
  const itemId = parseInt(params.itemId, 10);
  if (!projectId || isNaN(stageNumber) || !itemId) {
    return sendError(res, 400, 'Invalid ids');
  }

  let body;
  try { body = await readBody(req); } catch { return sendError(res, 400, 'Invalid JSON'); }

  if (typeof body.is_complete !== 'boolean') {
    return sendError(res, 400, 'is_complete (boolean) is required');
  }

  // Determine which workstream/pillar this item belongs to (for contributor scoping)
  const [[itemRow]] = await pool.execute(
    'SELECT pillar, item_code, description FROM template_checklist_items WHERE id = ?',
    [itemId]
  );
  if (!itemRow) return sendError(res, 404, 'Checklist item not found');

  // SECURITY: canEditWorkingData enforces the submission lock, stage state,
  // and contributor workstream scoping in one call
  if (!await canEditWorkingData(user.id, user.system_role, projectId, stageNumber, itemRow.pillar)) {
    return sendError(res, 403, 'Forbidden — stage may be frozen or you may not have edit rights for this section');
  }

  // Fetch the current row before any changes — needed for note-ownership check
  // and for the audit log (to record who originally completed the item).
  const [[existing]] = await pool.execute(
    `SELECT completed_by FROM stage_checklist
     WHERE project_id = ? AND stage_number = ? AND checklist_item_id = ?`,
    [projectId, stageNumber, itemId]
  );

  // SECURITY: evidence notes may only be edited by the user who wrote them,
  // OR by a project lead / admin (governance oversight).
  // Only a standalone note edit by a contributor on someone else's item is blocked.
  if (body.evidence_note !== undefined && body.is_complete !== false) {
    const isProjectLead = await hasProjectRole(projectId, user.id, ['project_lead']);
    if (!isProjectLead && user.system_role !== 'admin') {
      if (existing && existing.completed_by !== null && existing.completed_by !== user.id) {
        return sendError(res, 403, 'Only the user who completed this item can edit the evidence note');
      }
    }
  }

  const now = new Date().toISOString().replace('T', ' ').replace('Z', '');

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // Upsert: create the row if it somehow doesn't exist yet
    await conn.execute(
      `INSERT INTO stage_checklist
         (project_id, stage_number, checklist_item_id, is_complete, evidence_note, completed_by, completed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         is_complete   = VALUES(is_complete),
         evidence_note = VALUES(evidence_note),
         completed_by  = VALUES(completed_by),
         completed_at  = VALUES(completed_at)`,
      [
        projectId,
        stageNumber,
        itemId,
        body.is_complete ? 1 : 0,
        body.evidence_note || null,
        body.is_complete ? user.id : null,
        body.is_complete ? now : null,
      ]
    );

    // Use a distinct audit action when a project lead or admin edits someone else's
    // evidence note — makes it clearly attributable in the audit trail.
    const noteOnlyEdit = body.evidence_note !== undefined
      && body.is_complete === true
      && existing?.completed_by !== null
      && existing?.completed_by !== user.id;

    await auditLog.log(conn, {
      userId: user.id,
      action: noteOnlyEdit ? 'evidence_note_edited' : 'checklist_item_updated',
      projectId,
      stageNumber,
      detail: noteOnlyEdit
        ? {
            checklist_item_id: itemId,
            item_code: itemRow.item_code,
            item_description: itemRow.description,
            evidence_note: body.evidence_note || null,
            original_completed_by: existing.completed_by,
          }
        : {
            checklist_item_id: itemId,
            item_code: itemRow.item_code,
            item_description: itemRow.description,
            is_complete: body.is_complete,
            evidence_note: body.evidence_note || null,
          },
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

module.exports = { getStage, getChecklist, updateChecklistItem };
