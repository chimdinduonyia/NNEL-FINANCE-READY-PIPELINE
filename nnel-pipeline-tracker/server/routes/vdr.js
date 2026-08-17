'use strict';
/**
 * routes/vdr.js — cross-project document views
 *
 * GET /api/vdr             — every project with a document count (admin/PM only)
 * GET /api/vdr/:projectId  — full document register for one project (admin/PM only) —
 *                             same shape as GET /api/projects/:id/documents, just
 *                             reachable without being a member of the project
 * GET /api/documents/mine  — every document the current user has personally
 *                             uploaded, across every project they're on
 *
 * These are read-only aggregate views. Nothing here writes to
 * document_register — uploading/editing/deleting still goes through the
 * existing per-project /api/projects/:id/documents endpoints, which already
 * enforce the real permission rules (uploader-only delete, project-lead
 * write access, etc). This file exists so admins/PMs can see the whole
 * portfolio's document register in one place ("VDR"), and so any user can
 * see their own upload footprint ("Documents") without having to open each
 * project individually.
 */

const pool = require('../db');
const { requireLogin } = require('../middleware/auth');
const { sendJSON, sendError } = require('../utils/response');

// ---------------------------------------------------------------------------
// GET /api/vdr
// All projects (not cancelled) with a document count, for the admin-wide
// VDR landing list. Click into one -> GET /api/vdr/:projectId.
// ---------------------------------------------------------------------------
async function getAllProjects(req, res) {
  const user = await requireLogin(req, res);
  if (!user) return;
  if (!['admin','project_manager'].includes(user.system_role)) return sendError(res, 403, 'Forbidden');

  const [rows] = await pool.execute(
    `SELECT p.id, p.name, p.technology, p.status, p.current_stage,
            (SELECT COUNT(*) FROM document_register dr WHERE dr.project_id = p.id) AS document_count
     FROM projects p
     WHERE p.status != 'cancelled'
     ORDER BY p.name`
  );
  sendJSON(res, 200, rows);
}

// ---------------------------------------------------------------------------
// GET /api/vdr/:projectId
// Full document register for one project — admin/PM can open any project's
// register here without needing a project_members row (unlike
// GET /api/projects/:id/documents, which is gated by canViewProject).
// ---------------------------------------------------------------------------
async function getOneProject(req, res, params) {
  const user = await requireLogin(req, res);
  if (!user) return;
  if (!['admin','project_manager'].includes(user.system_role)) return sendError(res, 403, 'Forbidden');

  const projectId = parseInt(params.projectId, 10);
  if (!projectId) return sendError(res, 400, 'Invalid project id');

  const [[project]] = await pool.execute(
    'SELECT id, name, technology, status FROM projects WHERE id = ?', [projectId]
  );
  if (!project) return sendError(res, 404, 'Project not found');

  const [documents] = await pool.execute(
    `SELECT
       dr.id, dr.stage_number, dr.title, dr.status, dr.file_ref, dr.notes,
       dr.uploaded_at, dr.updated_at,
       vf.folder_code, vf.name AS folder_name,
       u.full_name AS uploaded_by_name
     FROM document_register dr
     JOIN template_vdr_folders vf ON vf.id = dr.vdr_folder_id
     JOIN users u ON u.id = dr.uploaded_by
     WHERE dr.project_id = ?
     ORDER BY vf.sort_order, dr.stage_number, dr.uploaded_at DESC`,
    [projectId]
  );

  sendJSON(res, 200, { project, documents });
}

// ---------------------------------------------------------------------------
// GET /api/documents/mine
// Every document the CURRENT user uploaded, across every project — their
// personal upload footprint. Always scoped to uploaded_by = self; no query
// param can widen that.
// ---------------------------------------------------------------------------
async function getMine(req, res) {
  const user = await requireLogin(req, res);
  if (!user) return;

  const [rows] = await pool.execute(
    `SELECT
       dr.id, dr.project_id, p.name AS project_name,
       dr.stage_number, dr.title, dr.status, dr.file_ref,
       dr.uploaded_at, dr.updated_at,
       vf.folder_code, vf.name AS folder_name
     FROM document_register dr
     JOIN projects p ON p.id = dr.project_id
     JOIN template_vdr_folders vf ON vf.id = dr.vdr_folder_id
     WHERE dr.uploaded_by = ?
     ORDER BY dr.uploaded_at DESC`,
    [user.id]
  );
  sendJSON(res, 200, rows);
}

module.exports = { getAllProjects, getOneProject, getMine };
