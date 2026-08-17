'use strict';
/**
 * routes/dataroom.js
 *
 * GET /api/projects/:id/dataroom
 *
 * Returns the scoped, read-only Virtual Data Room view for a project.
 * This is the only endpoint observers/lenders should call — it exposes
 * nothing beyond submitted/approved documents and basic project metadata.
 *
 * Permission rules (server-enforced):
 *   - canViewProject() is called first; for observers this already enforces
 *     Stage 3+ and access_expires_at (built in Step 1).
 *   - All other roles with project access (admin, PL, approver, reviewer)
 *     also reach this endpoint and see the same filtered document view.
 *
 * Content rules:
 *   - Only documents with status 'submitted' or 'approved' are returned.
 *     Outstanding and draft documents are working-in-progress and are
 *     never shared with lenders.
 *   - No checklist, no gate-decision rationale, no audit trail, no member
 *     list — those are internal governance records, not data-room content.
 */

const pool = require('../db');
const { requireLogin } = require('../middleware/auth');
const { canViewProject } = require('../middleware/permissions');
const { sendJSON, sendError } = require('../utils/response');
const { getStageNameMapForVersionString } = require('../services/stageNames');

async function getDataroom(req, res, params) {
  const user = await requireLogin(req, res);
  if (!user) return;

  const projectId = parseInt(params.id, 10);
  if (!projectId) return sendError(res, 400, 'Invalid project id');

  // SECURITY: canViewProject enforces Stage 3+ and expiry for observers,
  // and standard project membership for all other roles.
  if (!await canViewProject(user.id, user.system_role, projectId)) {
    return sendError(res, 403, 'Access denied - this data room may require Stage 3+, or your access may have expired');
  }

  // Fetch basic project metadata shown at the top of the data room
  const [[project]] = await pool.execute(
    `SELECT id, name, capex_usd, current_stage, status, technology, template_version
     FROM projects WHERE id = ?`,
    [projectId]
  );
  if (!project) return sendError(res, 404, 'Project not found');

  const stageNameMap = await getStageNameMapForVersionString(project.template_version);

  // Get the observer row specifically so we can return the expiry date
  const [[member]] = await pool.execute(
    'SELECT access_expires_at FROM project_members WHERE project_id = ? AND user_id = ? AND role = ? LIMIT 1',
    [projectId, user.id, 'observer']
  );

  // Fetch the current stage state for the pipeline position summary
  const [[stageRow]] = await pool.execute(
    `SELECT status, submitted_at FROM project_stages
     WHERE project_id = ? AND stage_number = ?`,
    [projectId, project.current_stage]
  );

  // Data-room documents: APPROVED only.
  // Gate approval is what makes a document eligible for lender review.
  // 'submitted' docs are still under review and not yet disclosed.
  const [docs] = await pool.execute(
    `SELECT
       dr.id,
       dr.title,
       dr.stage_number,
       dr.status,
       dr.file_ref,
       dr.notes,
       dr.uploaded_at,
       dr.updated_at,
       vf.folder_code,
       vf.name       AS folder_name,
       vf.sort_order AS folder_sort,
       u.full_name   AS uploaded_by
     FROM document_register dr
     JOIN template_vdr_folders vf ON vf.id = dr.vdr_folder_id
     JOIN users u ON u.id = dr.uploaded_by
     WHERE dr.project_id = ? AND dr.status = 'approved'
     ORDER BY vf.sort_order, dr.stage_number, dr.uploaded_at DESC`,
    [projectId]
  );

  // Return ALL VDR folders for this project's template (even empty ones)
  // so the observer can see the full data-room structure.
  const [allFolders] = await pool.execute(
    `SELECT vf.folder_code, vf.name, vf.description, vf.sort_order
     FROM template_vdr_folders vf
     JOIN template_versions tv ON tv.id = vf.template_version_id
     JOIN projects p ON p.template_version = tv.version AND p.id = ?
     ORDER BY vf.sort_order`,
    [projectId]
  );

  sendJSON(res, 200, {
    project: {
      id:            project.id,
      name:          project.name,
      capex_usd:     project.capex_usd,
      technology:    project.technology,
      current_stage: project.current_stage,
      stage_name:    stageNameMap[project.current_stage] ?? `Stage ${project.current_stage}`,
      stage_status:  stageRow?.status ?? null,
      status:        project.status,
    },
    my_role:           user.system_role === 'admin' ? 'admin' : (member ? 'observer' : null),
    access_expires_at: member ? (member.access_expires_at ?? null) : null,
    document_count:    docs.length,
    documents:         docs,
    vdr_folders:       allFolders,
  });
}

module.exports = { getDataroom };
