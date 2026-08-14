'use strict';
/**
 * routes/documents.js
 *
 * GET    /api/projects/:id/documents         — list document register
 * POST   /api/projects/:id/documents         — add an entry
 * PATCH  /api/projects/:id/documents/:docId  — update title/status/file_ref/notes
 * DELETE /api/projects/:id/documents/:docId  — delete (blocked only when submitted or approved)
 */

const pool = require('../db');
const { requireLogin } = require('../middleware/auth');
const { canViewProject, hasProjectRole, getProjectMember, getRequiredAuthority } = require('../middleware/permissions');
const { sendJSON, sendError } = require('../utils/response');
const { readBody } = require('../utils/bodyParser');
const auditLog = require('../services/auditLog');

const VALID_STATUSES = ['outstanding', 'draft', 'submitted', 'approved', 'superseded'];

// ---------------------------------------------------------------------------
// Permission helper for document writes.
// Project Lead can manage all documents.
// Contributor can add/update documents they uploaded.
// Others (approver, reviewer, observer): read-only.
// ---------------------------------------------------------------------------
async function canWriteDocument(userId, systemRole, projectId, existingDoc = null) {
  if (systemRole === 'admin') return false; // admins manage the system, not project data
  const member = await getProjectMember(projectId, userId);
  if (!member) return false;
  if (member.role === 'project_lead') return true;
  // Contributors may add or update their own entries
  if (member.role === 'contributor') {
    if (!existingDoc) return true; // creating a new doc
    return existingDoc.uploaded_by === userId;
  }
  return false;
}

// ---------------------------------------------------------------------------
// GET /api/projects/:id/documents
// Returns the full document register for this project, sorted by VDR folder.
// ---------------------------------------------------------------------------
async function list(req, res, params) {
  const user = await requireLogin(req, res);
  if (!user) return;

  const projectId = parseInt(params.id, 10);
  if (!projectId) return sendError(res, 400, 'Invalid project id');

  if (!await canViewProject(user.id, user.system_role, projectId)) {
    return sendError(res, 403, 'Forbidden');
  }

  const [rows] = await pool.execute(
    `SELECT
       dr.id,
       dr.stage_number,
       dr.title,
       dr.status,
       dr.file_ref,
       dr.notes,
       dr.uploaded_at,
       dr.updated_at,
       dr.updated_by,
       vf.folder_code,
       vf.name          AS folder_name,
       u.full_name      AS uploaded_by_name,
       dr.uploaded_by
     FROM document_register dr
     JOIN template_vdr_folders vf ON vf.id = dr.vdr_folder_id
     JOIN users u ON u.id = dr.uploaded_by
     WHERE dr.project_id = ?
     ORDER BY vf.sort_order, dr.stage_number, dr.uploaded_at`,
    [projectId]
  );

  sendJSON(res, 200, rows);
}

// ---------------------------------------------------------------------------
// POST /api/projects/:id/documents
// Adds an entry to the document register.
// Body: { title, folder_code, status?, stage_number?, file_ref?, notes? }
// ---------------------------------------------------------------------------
async function create(req, res, params) {
  const user = await requireLogin(req, res);
  if (!user) return;

  const projectId = parseInt(params.id, 10);
  if (!projectId) return sendError(res, 400, 'Invalid project id');

  if (!await canWriteDocument(user.id, user.system_role, projectId)) {
    return sendError(res, 403, 'Forbidden');
  }

  let body;
  try { body = await readBody(req); } catch { return sendError(res, 400, 'Invalid JSON'); }

  const { title, folder_code, status, stage_number, file_ref, notes } = body;
  if (!title || typeof title !== 'string' || title.trim().length === 0) {
    return sendError(res, 400, 'title is required');
  }
  if (!folder_code) return sendError(res, 400, 'folder_code is required');
  const docStatus = status || 'outstanding';
  if (!VALID_STATUSES.includes(docStatus)) {
    return sendError(res, 400, `status must be one of: ${VALID_STATUSES.join(', ')}`);
  }

  // Resolve the VDR folder id from the folder_code (parameterised — no injection risk)
  const [[folderRow]] = await pool.execute(
    `SELECT vf.id FROM template_vdr_folders vf
     JOIN template_versions tv ON tv.id = vf.template_version_id
     JOIN projects p ON p.template_version = tv.version AND p.id = ?
     WHERE vf.folder_code = ?`,
    [projectId, folder_code]
  );
  if (!folderRow) return sendError(res, 400, `folder_code '${folder_code}' not found in this project's template`);

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [result] = await conn.execute(
      `INSERT INTO document_register
         (project_id, stage_number, title, vdr_folder_id, status, file_ref, notes, uploaded_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        projectId,
        stage_number != null ? parseInt(stage_number, 10) : null,
        title.trim(),
        folderRow.id,
        docStatus,
        file_ref || null,
        notes || null,
        user.id,
      ]
    );
    await auditLog.log(conn, {
      userId: user.id,
      action: 'document_created',
      projectId,
      stageNumber: stage_number != null ? parseInt(stage_number, 10) : null,
      detail: { title: title.trim(), folder_code, status: docStatus },
    });
    await conn.commit();
    sendJSON(res, 201, { id: result.insertId, title: title.trim(), folder_code, status: docStatus });
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

// ---------------------------------------------------------------------------
// PATCH /api/projects/:id/documents/:docId
// Updates title, status, file_ref, or notes.
//
// Permission model for STATUS changes:
//   Admin / Project Lead   — can change any status when stage is NOT submitted/approved.
//   Gate Approver          — can ONLY set status to 'approved' while stage IS submitted
//                            (they are approving documents as part of their gate review).
// Other field changes use the standard canWriteDocument check.
// ---------------------------------------------------------------------------
async function update(req, res, params) {
  const user = await requireLogin(req, res);
  if (!user) return;

  const projectId = parseInt(params.id, 10);
  const docId     = parseInt(params.docId, 10);
  if (!projectId || !docId) return sendError(res, 400, 'Invalid ids');

  const [[doc]] = await pool.execute(
    'SELECT id, uploaded_by, status, stage_number FROM document_register WHERE id = ? AND project_id = ?',
    [docId, projectId]
  );
  if (!doc) return sendError(res, 404, 'Document not found');

  let body;
  try { body = await readBody(req); } catch { return sendError(res, 400, 'Invalid JSON'); }

  if (body.status !== undefined && !VALID_STATUSES.includes(body.status)) {
    return sendError(res, 400, `status must be one of: ${VALID_STATUSES.join(', ')}`);
  }

  const statusChanging = body.status !== undefined && body.status !== doc.status;

  if (statusChanging) {
    const isAdm = user.system_role === 'admin';
    const isPL  = await hasProjectRole(projectId, user.id, ['project_lead']);
    const isGA  = !isAdm && !isPL && await hasProjectRole(projectId, user.id, ['gate_approver']);

    if (!isAdm && !isPL && !isGA) {
      return sendError(res, 403, 'Only Project Lead, Gate Approver, or Admin can change document status');
    }

    // Look up the current stage state for submission-lock logic
    const [[proj]] = await pool.execute('SELECT current_stage FROM projects WHERE id = ?', [projectId]);
    const [[stageRow]] = await pool.execute(
      'SELECT status FROM project_stages WHERE project_id = ? AND stage_number = ?',
      [projectId, proj.current_stage]
    );
    const stageStatus = stageRow?.status;

    if (isAdm || isPL) {
      // Project team: blocked while stage is under review or already decided
      if (['submitted', 'approved'].includes(stageStatus)) {
        return sendError(res, 409,
          'Document status cannot be changed while the current stage is submitted or approved');
      }
    } else if (isGA) {
      // Gate approver: can ONLY approve documents while the stage is submitted for review
      if (stageStatus !== 'submitted') {
        return sendError(res, 409,
          'Gate approvers can only approve documents while the stage is under review');
      }
      // Gate approvers may:
      //  • 'approved'    — approve the document
      //  • 'submitted'   — undo an approval (return to awaiting review)
      //  • 'outstanding' — reject/return to the project team for revision
      // All three are reversible while the stage is still under review.
      if (!['approved', 'submitted', 'outstanding'].includes(body.status)) {
        return sendError(res, 400,
          'Gate approvers may only set document status to "approved", "submitted", or "outstanding" (returned to team)');
      }

      // SECURITY: verify this approver is in the chain for the document's stage gate.
      // A Gate 2 approver cannot review documents submitted for Gate 3.
      if (doc.stage_number !== null && doc.stage_number !== undefined) {
        const [[stageRow]] = await pool.execute(
          'SELECT capex_at_submission FROM project_stages WHERE project_id = ? AND stage_number = ?',
          [projectId, doc.stage_number]
        );
        const [[projRow]] = await pool.execute('SELECT capex_usd FROM projects WHERE id = ?', [projectId]);
        const capex    = stageRow?.capex_at_submission ?? projRow?.capex_usd ?? 0;
        const required = await getRequiredAuthority(doc.stage_number, capex, projectId);

        const [approverRows] = await pool.execute(
          'SELECT approver_authority FROM project_members WHERE project_id = ? AND user_id = ? AND role = ?',
          [projectId, user.id, 'gate_approver']
        );
        const userAuthorities = approverRows.map(r => r.approver_authority);

        if (required.length > 0 && !required.some(a => userAuthorities.includes(a))) {
          return sendError(res, 403,
            'You are not an authorised approver for this stage gate');
        }
      }
    }
  }

  // Other field changes use the existing write-permission check
  const hasOtherChanges = ['title', 'file_ref', 'notes'].some(f => body[f] !== undefined);
  if (hasOtherChanges && !await canWriteDocument(user.id, user.system_role, projectId, doc)) {
    return sendError(res, 403, 'Forbidden');
  }

  const allowed = ['title', 'status', 'file_ref', 'notes'];
  const setClauses = ['updated_by = ?', 'updated_at = NOW()'];
  const values = [user.id];

  for (const field of allowed) {
    if (body[field] !== undefined) {
      setClauses.push(`${field} = ?`);
      values.push(body[field]);
    }
  }
  if (setClauses.length <= 2) return sendError(res, 400, 'No updatable fields provided');
  values.push(docId, projectId);

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute(
      `UPDATE document_register SET ${setClauses.join(', ')} WHERE id = ? AND project_id = ?`,
      values
    );
    // Separate audit entry for status changes so old/new values are captured
    if (statusChanging) {
      await auditLog.log(conn, {
        userId: user.id, action: 'document_status_updated', projectId,
        detail: { document_id: docId, old_status: doc.status, new_status: body.status },
      });
    } else {
      await auditLog.log(conn, {
        userId: user.id, action: 'document_updated', projectId,
        detail: { document_id: docId, changes: body },
      });
    }
    await conn.commit();
    sendJSON(res, 200, { updated: true });
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

// ---------------------------------------------------------------------------
// DELETE /api/projects/:id/documents/:docId
// Hard-deletes the entry. Restricted to outstanding or draft status only —
// once a document is submitted or approved it is part of the gate record
// and cannot be erased.
// ---------------------------------------------------------------------------
async function remove(req, res, params) {
  const user = await requireLogin(req, res);
  if (!user) return;

  const projectId = parseInt(params.id, 10);
  const docId = parseInt(params.docId, 10);
  if (!projectId || !docId) return sendError(res, 400, 'Invalid ids');

  const [[doc]] = await pool.execute(
    'SELECT id, uploaded_by, status, title FROM document_register WHERE id = ? AND project_id = ?',
    [docId, projectId]
  );
  if (!doc) return sendError(res, 404, 'Document not found');

  // SECURITY: only the person who uploaded the document may delete it.
  // No exception for Project Lead or Admin — the uploader owns the correction.
  if (user.id !== doc.uploaded_by) {
    return sendError(res, 403, 'Only the user who uploaded this document can delete it');
  }

  // Submitted and approved documents are part of the gate review record
  // and cannot be deleted even by their uploader.
  if (['submitted', 'approved'].includes(doc.status)) {
    return sendError(res, 409, `Cannot delete a document that has been ${doc.status} — it is part of the gate record`);
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute(
      'DELETE FROM document_register WHERE id = ? AND project_id = ?',
      [docId, projectId]
    );
    await auditLog.log(conn, {
      userId: user.id,
      action: 'document_deleted',
      projectId,
      detail: { document_id: docId, title: doc.title },
    });
    await conn.commit();
    sendJSON(res, 200, { deleted: true });
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

module.exports = { list, create, update, remove };
