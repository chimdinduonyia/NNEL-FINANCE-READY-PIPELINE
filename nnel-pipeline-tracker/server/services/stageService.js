'use strict';
/**
 * stageService.js — shared helpers for opening stages and advancing the project.
 *
 * Used by both the project-creation handler (Stage 0) and the gate-decision
 * handler (Stages 1–5) so the same initialisation logic runs in both paths.
 *
 * Every function accepts a database connection (not the pool) so it can
 * participate in the caller's transaction.
 */

/**
 * Creates stage_checklist rows for a stage from the project's template.
 * Uses INSERT IGNORE so it is safe to call even if some rows already exist.
 *
 * @param {object} conn  Transaction-scoped DB connection
 * @param {number} projectId
 * @param {number} stageNumber  0–5
 * @param {number} templateVersionId  PK of the template_versions row
 */
async function initializeStageChecklist(conn, projectId, stageNumber, templateVersionId) {
  const [items] = await conn.execute(
    'SELECT id FROM template_checklist_items WHERE template_version_id = ? AND stage_number = ? AND is_active = 1',
    [templateVersionId, stageNumber]
  );
  for (const item of items) {
    await conn.execute(
      'INSERT IGNORE INTO stage_checklist (project_id, stage_number, checklist_item_id) VALUES (?, ?, ?)',
      [projectId, stageNumber, item.id]
    );
  }
}

/**
 * Resolves the template_versions.id for a project by joining on version string.
 *
 * @param {object} conn
 * @param {number} projectId
 * @returns {number|null}
 */
async function getTemplateVersionId(conn, projectId) {
  const [[row]] = await conn.execute(
    `SELECT tv.id
     FROM projects p
     JOIN template_versions tv ON tv.version = p.template_version
     WHERE p.id = ?`,
    [projectId]
  );
  return row ? row.id : null;
}

/**
 * Advances the project after a gate has been fully approved.
 *
 * Steps:
 *   1. Mark the approved stage as 'approved'.
 *   2. If there is a next stage (stageNumber < 5):
 *        a. Open the next stage (set status to 'in_progress').
 *        b. Advance projects.current_stage.
 *        c. Initialise the checklist for the new stage.
 *   3. If stageNumber === 5 (COD approved):
 *        Mark the project as 'completed'.
 *
 * The caller is responsible for wrapping this in a transaction.
 *
 * @param {object} conn  Transaction-scoped DB connection
 * @param {number} projectId
 * @param {number} approvedStageNumber  The stage that has just been fully approved
 */
async function advanceProject(conn, projectId, approvedStageNumber) {
  // Mark the current stage approved
  await conn.execute(
    "UPDATE project_stages SET status = 'approved' WHERE project_id = ? AND stage_number = ?",
    [projectId, approvedStageNumber]
  );

  const templateVersionId = await getTemplateVersionId(conn, projectId);

  // Find the next stage that has at least one active checklist item.
  // Stages with no active items are deactivated and should be skipped automatically.
  let nextStage = approvedStageNumber + 1;
  while (nextStage <= 5) {
    const [[{ active_count }]] = await conn.execute(
      `SELECT COUNT(*) AS active_count
       FROM template_checklist_items tci
       JOIN template_versions tv ON tv.id = tci.template_version_id
       WHERE tv.id = ? AND tci.stage_number = ? AND tci.is_active = 1`,
      [templateVersionId, nextStage]
    );
    if (Number(active_count) > 0) break; // this stage has items — open it
    // No active items: mark as approved (skipped) and move to the next
    await conn.execute(
      "UPDATE project_stages SET status = 'approved' WHERE project_id = ? AND stage_number = ?",
      [projectId, nextStage]
    );
    nextStage++;
  }

  if (nextStage <= 5) {
    // Open the next non-deactivated stage
    await conn.execute(
      "UPDATE project_stages SET status = 'in_progress' WHERE project_id = ? AND stage_number = ?",
      [projectId, nextStage]
    );
    await conn.execute(
      'UPDATE projects SET current_stage = ? WHERE id = ?',
      [nextStage, projectId]
    );
    if (templateVersionId) {
      await initializeStageChecklist(conn, projectId, nextStage, templateVersionId);
    }
  } else {
    // All remaining stages were skipped or we're past stage 5 — project complete
    await conn.execute(
      "UPDATE projects SET status = 'completed', current_stage = ? WHERE id = ?",
      [approvedStageNumber, projectId]
    );
  }
}

module.exports = { initializeStageChecklist, getTemplateVersionId, advanceProject };
