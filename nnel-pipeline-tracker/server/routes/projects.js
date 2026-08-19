'use strict';
/**
 * routes/projects.js
 *
 * POST   /api/projects                        — create project (admin only)
 * GET    /api/projects                        — list all accessible projects
 * GET    /api/projects/:id                    — project detail + members + stage states
 * PATCH  /api/projects/:id                    — update basic fields (admin only)
 * POST   /api/projects/:id/members            — assign a user to this project (admin only)
 * DELETE /api/projects/:id/members/:userId    — remove a member (admin only)
 */

const pool = require('../db');
const { requireLogin } = require('../middleware/auth');
const { canViewProject, getRequiredAuthority, hasProjectRole } = require('../middleware/permissions');
const { getStageNameMapForVersionString } = require('../services/stageNames');

// PM can manage members on a project if they created it or are its project lead
async function pmCanManageProject(userId, projectId) {
  const [[proj]] = await pool.execute('SELECT created_by FROM projects WHERE id = ?', [projectId]);
  if (proj?.created_by === userId) return true;
  return hasProjectRole(projectId, userId, ['project_lead']);
}
const { sendJSON, sendError } = require('../utils/response');
const { readBody } = require('../utils/bodyParser');
const auditLog = require('../services/auditLog');
const stageService = require('../services/stageService');
const { ACTIVE_WINDOW_MS } = require('./presence');

const VALID_ROLES = ['project_lead', 'contributor', 'gate_approver', 'reviewer', 'observer'];
const VALID_WORKSTREAMS = ['technical', 'commercial', 'finance', 'legal', 'risk', 'esg', 'administrative', 'external'];
const VALID_AUTHORITIES = ['m1_nnpc', 'm2_evp', 'nnel_board', 'm3_md_nnel', 'slt_mtc', 'm4_ed_cam'];

// ---------------------------------------------------------------------------
// POST /api/projects
// Creates a project with all 6 stage rows and initialises Stage 0's checklist.
// Wrapped in a transaction so a partial failure leaves nothing behind.
// ---------------------------------------------------------------------------
async function create(req, res) {
  const user = await requireLogin(req, res);
  if (!user) return;

  // SECURITY: admins and project managers may create projects
  if (!['admin','project_manager'].includes(user.system_role)) {
    return sendError(res, 403, 'Forbidden');
  }

  let body;
  try { body = await readBody(req); } catch { return sendError(res, 400, 'Invalid JSON'); }

  const { name, description, capex_amount, capex_currency, capex_usd_equivalent,
          capacity, location, technology, is_at_risk,
          objectives, justification, benefits, template_version_id } = body;
  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    return sendError(res, 400, 'name is required');
  }

  // CAPEX: capex_usd stays the always-USD figure used for Board/lender-facing
  // reporting (CAPEX no longer drives gate routing — see DOA_SPEC.md — but it
  // remains a governance figure people rely on). When the deal is quoted in
  // NGN, the USD-equivalent must be supplied explicitly -- never
  // auto-converted, so there's no guessed exchange rate sitting behind a
  // number the Board sees.
  const currency = capex_currency === 'NGN' ? 'NGN' : 'USD';
  const amount = parseFloat(capex_amount);
  if (isNaN(amount) || amount < 0) {
    return sendError(res, 400, 'capex_amount must be a non-negative number');
  }
  let capex;
  if (currency === 'NGN') {
    capex = parseFloat(capex_usd_equivalent);
    if (isNaN(capex) || capex < 0) {
      return sendError(res, 400,
        'A USD-equivalent CAPEX value is required when quoting in NGN, for accurate Board/lender reporting');
    }
  } else {
    capex = amount;
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // Map the project's display technology to the template_versions.technology ENUM value.
    // Falls back to 'solar_pv' so existing projects without a technology still work.
    const TECH_ENUM = { 'Solar PV': 'solar_pv', 'Biofuels': 'biofuels', 'Abatement': 'abatement' };
    const techEnum = TECH_ENUM[technology] || 'solar_pv';

    // Use the explicitly chosen template version if provided, otherwise fall back
    // to the most-recent active version for this technology.
    let tv;
    if (template_version_id) {
      const [[row]] = await conn.execute(
        'SELECT id, version FROM template_versions WHERE id = ? AND technology = ?',
        [parseInt(template_version_id, 10), techEnum]
      );
      if (!row) {
        await conn.rollback();
        return sendError(res, 400, 'Chosen template version not found for this technology');
      }
      tv = row;
    } else {
      const [tvRows] = await conn.execute(
        'SELECT id, version FROM template_versions WHERE is_active = 1 AND technology = ? ORDER BY id DESC LIMIT 1',
        [techEnum]
      );
      if (!tvRows[0]) {
        await conn.rollback();
        return sendError(res, 500, `No active template found for technology '${techEnum}'. Run the seed migrations first.`);
      }
      tv = tvRows[0];
    }

    // Insert the project row
    const [result] = await conn.execute(
      `INSERT INTO projects (name, description, capex_usd, capex_currency, capex_amount,
                            capacity, location, technology, is_at_risk,
                            objectives, justification, benefits, template_version, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [name.trim(), description || null, capex.toFixed(2), currency, amount.toFixed(2),
       capacity || null, location || null,
       technology || null, is_at_risk ? 1 : 0,
       objectives || null, justification || null, benefits || null,
       tv.version, user.id]
    );
    const projectId = result.insertId;

    // Insert one project_stage row per stage actually defined on this
    // template version (not a hardcoded 0-5 — admins can add stages via the
    // template editor, see template_stages / DOA_SPEC.md). The first stage in
    // order opens immediately (in_progress); the rest start not_started.
    const [templateStages] = await conn.execute(
      'SELECT stage_number FROM template_stages WHERE template_version_id = ? ORDER BY stage_number',
      [tv.id]
    );
    // Defensive fallback: a template version with no template_stages rows
    // (shouldn't happen post-migration-024, but don't silently create zero
    // stages if it somehow does) still gets the original fixed 6.
    const stageNumbers = templateStages.length > 0
      ? templateStages.map(s => s.stage_number)
      : [0, 1, 2, 3, 4, 5];

    for (const stage of stageNumbers) {
      await conn.execute(
        `INSERT INTO project_stages (project_id, stage_number, status)
         VALUES (?, ?, ?)`,
        [projectId, stage, stage === stageNumbers[0] ? 'in_progress' : 'not_started']
      );
    }

    // Eagerly initialise the first stage's checklist rows from the template
    await stageService.initializeStageChecklist(conn, projectId, stageNumbers[0], tv.id);

    await auditLog.log(conn, {
      userId: user.id,
      action: 'project_created',
      projectId,
      detail: { name: name.trim(), capex_usd: capex, template_version: tv.version },
    });

    await conn.commit();
    sendJSON(res, 201, { id: projectId, name: name.trim(), template_version: tv.version });
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

// ---------------------------------------------------------------------------
// GET /api/projects
// Admins see all. All other roles see only projects they are members of.
// ---------------------------------------------------------------------------
async function list(req, res) {
  const user = await requireLogin(req, res);
  if (!user) return;

  let rows;
  if (['admin','project_manager'].includes(user.system_role)) {
    // Admins and PMs see all projects
    [rows] = await pool.execute(
      `SELECT p.id, p.name, p.description, p.capex_usd, p.current_stage,
              p.status, p.template_version, p.created_at
       FROM projects p
       ORDER BY p.created_at DESC`
    );
  } else {
    [rows] = await pool.execute(
      `SELECT p.id, p.name, p.description, p.capex_usd, p.current_stage,
              p.status, p.template_version, p.created_at,
              pm.role AS my_role
       FROM projects p
       JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = ?
       ORDER BY p.created_at DESC`,
      [user.id]
    );
  }

  sendJSON(res, 200, rows);
}

// ---------------------------------------------------------------------------
// GET /api/projects/recent
// Powers the sidebar's "Recents" list — the projects this user has actually
// done something on lately, derived from audit_log (any action counts here,
// unlike the curated set notifications uses — any activity at all is a fair
// signal for "recently active on"). Restricted to projects still active and
// still visible to this user (admin/PM see everything; everyone else only
// what they're currently a member of) so a stale entry never links
// somewhere they'd get a 403.
// ---------------------------------------------------------------------------
async function getRecent(req, res) {
  const user = await requireLogin(req, res);
  if (!user) return;

  const canSeeAll = ['admin', 'project_manager'].includes(user.system_role);

  const [rows] = await pool.execute(
    `SELECT p.id, p.name, MAX(al.created_at) AS last_active
     FROM audit_log al
     JOIN projects p ON p.id = al.project_id AND p.status != 'cancelled'
     WHERE al.user_id = ?
       AND (? = 1 OR EXISTS (
         SELECT 1 FROM project_members pm WHERE pm.project_id = p.id AND pm.user_id = ?
       ))
     GROUP BY p.id, p.name
     ORDER BY last_active DESC
     LIMIT 5`,
    [user.id, canSeeAll ? 1 : 0, user.id]
  );

  sendJSON(res, 200, rows);
}

// ---------------------------------------------------------------------------
// GET /api/projects/:id/presence
// Members of this project who are currently active (see routes/presence.js
// for what "active" means and why the comparison uses an app-generated
// timestamp rather than SQL's NOW()).
// ---------------------------------------------------------------------------
async function getProjectPresence(req, res, params) {
  const user = await requireLogin(req, res);
  if (!user) return;

  const projectId = parseInt(params.id, 10);
  if (!projectId) return sendError(res, 400, 'Invalid project id');

  if (!await canViewProject(user.id, user.system_role, projectId)) {
    return sendError(res, 403, 'Forbidden');
  }

  const since = new Date(Date.now() - ACTIVE_WINDOW_MS);
  const [rows] = await pool.execute(
    `SELECT u.id, u.full_name, u.system_role, pm.role AS project_role
     FROM users u
     JOIN project_members pm ON pm.user_id = u.id AND pm.project_id = ?
     WHERE u.is_active = 1 AND u.last_active_at > ?
     ORDER BY u.full_name ASC`,
    [projectId, since]
  );
  sendJSON(res, 200, rows);
}

// ---------------------------------------------------------------------------
// GET /api/projects/:id
// Returns full project detail: basic info, members, and all 6 stage states.
// ---------------------------------------------------------------------------
async function getOne(req, res, params) {
  const user = await requireLogin(req, res);
  if (!user) return;

  const projectId = parseInt(params.id, 10);
  if (!projectId) return sendError(res, 400, 'Invalid project id');

  // SECURITY: permission check before reading any data
  if (!await canViewProject(user.id, user.system_role, projectId)) {
    return sendError(res, 403, 'Forbidden');
  }

  // Fetch project details
  const [[project]] = await pool.execute(
    `SELECT id, name, description, capex_usd, capex_currency, capex_amount,
            capacity, location, technology, is_at_risk,
            current_stage, status, template_version, created_by, created_at, updated_at,
            objectives, justification, benefits
     FROM projects WHERE id = ?`,
    [projectId]
  );
  if (!project) return sendError(res, 404, 'Project not found');

  // Fetch members with user names
  const [members] = await pool.execute(
    `SELECT pm.user_id, u.full_name, u.email, pm.role,
            pm.workstream, pm.approver_authority, pm.access_expires_at, pm.created_at,
            pm.member_authority,
            u.workstream AS user_workstream, u.authority AS user_authority
     FROM project_members pm
     JOIN users u ON u.id = pm.user_id
     WHERE pm.project_id = ?
     ORDER BY pm.created_at`,
    [projectId]
  );

  // Fetch all 6 stage states
  const [stages] = await pool.execute(
    `SELECT ps.stage_number, ps.status, ps.review_round, ps.submitted_by, ps.submitted_at,
            ps.capex_at_submission, ps.submission_summary,
            u.full_name AS submitted_by_name
     FROM project_stages ps
     LEFT JOIN users u ON u.id = ps.submitted_by
     WHERE ps.project_id = ?
     ORDER BY ps.stage_number`,
    [projectId]
  );

  // Count active checklist items per stage from the template — used to flag
  // stages that were fully deactivated so the UI can hide them and auto-advance.
  const [activeItemCounts] = await pool.execute(
    `SELECT tci.stage_number, COUNT(*) AS active_count
     FROM template_checklist_items tci
     JOIN template_versions tv ON tv.id = tci.template_version_id
     WHERE tv.version = ? AND tci.is_active = 1
     GROUP BY tci.stage_number`,
    [project.template_version]
  );
  const activeCountByStage = Object.fromEntries(
    activeItemCounts.map(r => [r.stage_number, Number(r.active_count)])
  );

  // Stage titles come from template_stages (editable per template version in
  // the template editor) rather than a hardcoded array — see DOA_SPEC.md /
  // stageNames.js.
  const stageNameMap = await getStageNameMapForVersionString(project.template_version);

  // Attach gate routing info, deactivation flag, and stage name to each stage
  const stagesWithRouting = await Promise.all(stages.map(async s => ({
    ...s,
    stage_name: stageNameMap[s.stage_number] ?? `Stage ${s.stage_number}`,
    required_approvers: await getRequiredAuthority(s.stage_number, s.capex_at_submission ?? project.capex_usd, projectId),
    is_deactivated: (activeCountByStage[s.stage_number] ?? 0) === 0,
  })));

  sendJSON(res, 200, { ...project, members, stages: stagesWithRouting });
}

// ---------------------------------------------------------------------------
// PATCH /api/projects/:id
// Allows admin to update name, description, capex_usd, or status.
// ---------------------------------------------------------------------------
async function update(req, res, params) {
  const user = await requireLogin(req, res);
  if (!user) return;

  const projectId = parseInt(params.id, 10);
  if (!projectId) return sendError(res, 400, 'Invalid project id');

  if (user.system_role === 'project_manager') {
    if (!await pmCanManageProject(user.id, projectId)) {
      return sendError(res, 403, 'Project managers can only edit projects they created or lead');
    }
  } else if (user.system_role !== 'admin') {
    return sendError(res, 403, 'Forbidden');
  }

  let body;
  try { body = await readBody(req); } catch { return sendError(res, 400, 'Invalid JSON'); }

  const setClauses = [];
  const values = [];

  // CAPEX is derived, not a simple passthrough -- capex_usd, capex_currency,
  // and capex_amount must always change together so they stay consistent.
  // Same NGN-requires-explicit-USD-equivalent rule as project creation.
  if (body.capex_amount !== undefined || body.capex_currency !== undefined) {
    const currency = body.capex_currency === 'NGN' ? 'NGN' : 'USD';
    const amount = parseFloat(body.capex_amount);
    if (isNaN(amount) || amount < 0) {
      return sendError(res, 400, 'capex_amount must be a non-negative number');
    }
    let capexUsd;
    if (currency === 'NGN') {
      capexUsd = parseFloat(body.capex_usd_equivalent);
      if (isNaN(capexUsd) || capexUsd < 0) {
        return sendError(res, 400,
          'A USD-equivalent CAPEX value is required when quoting in NGN, for accurate Board/lender reporting');
      }
    } else {
      capexUsd = amount;
    }
    setClauses.push('capex_usd = ?', 'capex_currency = ?', 'capex_amount = ?');
    values.push(capexUsd.toFixed(2), currency, amount.toFixed(2));
  }

  const allowed = ['name', 'description', 'technology', 'is_at_risk',
                   'objectives', 'justification', 'benefits', 'status',
                   'capacity', 'location'];

  for (const field of allowed) {
    if (body[field] !== undefined) {
      setClauses.push(`${field} = ?`);
      values.push(body[field]);
    }
  }
  if (setClauses.length === 0) return sendError(res, 400, 'No updatable fields provided');

  values.push(projectId);
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute(
      `UPDATE projects SET ${setClauses.join(', ')} WHERE id = ?`,
      values
    );
    await auditLog.log(conn, {
      userId: user.id,
      action: 'project_updated',
      projectId,
      detail: body,
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

// ---------------------------------------------------------------------------
// POST /api/projects/:id/members
// Assigns a user to this project with a given role.
// Body: { user_id, role, workstream?, approver_authority?, access_expires_at? }
// ---------------------------------------------------------------------------
async function addMember(req, res, params) {
  const user = await requireLogin(req, res);
  if (!user) return;

  const projectId = parseInt(params.id, 10);
  if (!projectId) return sendError(res, 400, 'Invalid project id');

  if (user.system_role === 'project_manager') {
    if (!await pmCanManageProject(user.id, projectId)) {
      return sendError(res, 403, 'Project managers can only manage members on projects they created or lead');
    }
  } else if (user.system_role !== 'admin') {
    return sendError(res, 403, 'Forbidden');
  }

  let body;
  try { body = await readBody(req); } catch { return sendError(res, 400, 'Invalid JSON'); }

  const { user_id, role, workstream, approver_authority, access_expires_at } = body;

  if (!user_id || !role) return sendError(res, 400, 'user_id and role are required');
  if (!VALID_ROLES.includes(role)) return sendError(res, 400, `role must be one of: ${VALID_ROLES.join(', ')}`);
  if (role === 'contributor' && workstream && !VALID_WORKSTREAMS.includes(workstream)) {
    return sendError(res, 400, `workstream must be one of: ${VALID_WORKSTREAMS.join(', ')}`);
  }
  if (role === 'gate_approver' && !VALID_AUTHORITIES.includes(approver_authority)) {
    return sendError(res, 400, `approver_authority required for gate_approver role: ${VALID_AUTHORITIES.join(', ')}`);
  }

  // Confirm both project and user exist.
  // Only query id here — workstream/authority columns require migration 016
  // and may not exist yet; they are set via PATCH after the initial add.
  const [[projectRow]] = await pool.execute('SELECT id FROM projects WHERE id = ?', [projectId]);
  if (!projectRow) return sendError(res, 404, 'Project not found');
  const [[targetUser]] = await pool.execute(
    'SELECT id FROM users WHERE id = ? AND is_active = 1',
    [user_id]
  );
  if (!targetUser) return sendError(res, 404, 'User not found or inactive');

  // GOVERNANCE: every project must have a Project Lead before any other
  // role can be assigned - this is what makes segregation of duties and
  // the submission/gate-approval flow meaningful in the first place. This
  // insert is an upsert (existing members can have their role changed by
  // re-adding them with a different role), so the check excludes the
  // target user's own current row: it correctly blocks both "first member
  // added isn't a lead" and "demoting the project's only lead to something
  // else", without blocking a lead being re-added as themselves.
  if (role !== 'project_lead') {
    const [[{ otherLeads }]] = await pool.execute(
      `SELECT COUNT(*) AS otherLeads FROM project_members
       WHERE project_id = ? AND role = 'project_lead' AND user_id != ?`,
      [projectId, user_id]
    );
    if (otherLeads === 0) {
      return sendError(res, 409,
        'This project has no Project Lead yet. Add a Project Lead before assigning any other role.');
    }
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute(
      `INSERT INTO project_members
         (project_id, user_id, role, workstream, approver_authority, access_expires_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         role = VALUES(role),
         workstream = VALUES(workstream),
         approver_authority = VALUES(approver_authority),
         access_expires_at = VALUES(access_expires_at)`,
      [projectId, user_id, role,
       role === 'contributor' ? workstream : null,
       role === 'gate_approver' ? approver_authority : null,
       access_expires_at || null]
    );
    await auditLog.log(conn, {
      userId: user.id,
      action: 'member_assigned',
      projectId,
      detail: { target_user_id: user_id, role, workstream, approver_authority },
    });
    await conn.commit();
    sendJSON(res, 200, { assigned: true });
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

// ---------------------------------------------------------------------------
// DELETE /api/projects/:id/members/:userId
// Removes a member from this project. Admin only.
// ---------------------------------------------------------------------------
async function removeMember(req, res, params) {
  const user = await requireLogin(req, res);
  if (!user) return;

  const projectId = parseInt(params.id, 10);
  const targetUserId = parseInt(params.userId, 10);

  if (user.system_role === 'project_manager') {
    if (!await pmCanManageProject(user.id, projectId)) {
      return sendError(res, 403, 'Project managers can only manage members on projects they created or lead');
    }
  } else if (user.system_role !== 'admin') {
    return sendError(res, 403, 'Forbidden');
  }
  if (!projectId || !targetUserId) return sendError(res, 400, 'Invalid ids');

  // GOVERNANCE: mirrors the same rule enforced on add - a project can never
  // be left without a Project Lead, so removing the only one is blocked.
  const [[targetMember]] = await pool.execute(
    'SELECT role FROM project_members WHERE project_id = ? AND user_id = ?',
    [projectId, targetUserId]
  );
  if (targetMember?.role === 'project_lead') {
    const [[{ otherLeads }]] = await pool.execute(
      `SELECT COUNT(*) AS otherLeads FROM project_members
       WHERE project_id = ? AND role = 'project_lead' AND user_id != ?`,
      [projectId, targetUserId]
    );
    if (otherLeads === 0) {
      return sendError(res, 409,
        "Cannot remove the project's only Project Lead. Assign a new Project Lead first.");
    }
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute(
      'DELETE FROM project_members WHERE project_id = ? AND user_id = ?',
      [projectId, targetUserId]
    );
    await auditLog.log(conn, {
      userId: user.id,
      action: 'member_removed',
      projectId,
      detail: { target_user_id: targetUserId },
    });
    await conn.commit();
    sendJSON(res, 200, { removed: true });
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

// ---------------------------------------------------------------------------
// DELETE /api/projects/:id
// Soft-deletes by setting status = 'cancelled'. Hard deletion is not possible
// because audit_log and gate_decisions have INSERT-only DB grants, meaning
// those rows cannot be removed — this preserves the immutable governance trail.
// The project disappears from the active portfolio but all records are kept.
// ---------------------------------------------------------------------------
async function deleteProject(req, res, params) {
  const user = await requireLogin(req, res);
  if (!user) return;
  if (user.system_role !== 'admin') return sendError(res, 403, 'Forbidden');

  const projectId = parseInt(params.id, 10);
  if (!projectId) return sendError(res, 400, 'Invalid project id');

  const [[proj]] = await pool.execute(
    'SELECT id, name, status FROM projects WHERE id = ?', [projectId]
  );
  if (!proj) return sendError(res, 404, 'Project not found');
  if (proj.status === 'cancelled') {
    return sendError(res, 409, 'Project is already cancelled');
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute(
      "UPDATE projects SET status = 'cancelled' WHERE id = ?", [projectId]
    );
    await auditLog.log(conn, {
      userId: user.id,
      action: 'project_deleted',
      projectId,
      detail: { project_name: proj.name, previous_status: proj.status },
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

// ---------------------------------------------------------------------------
// PATCH /api/projects/:id/members/:userId/:role
// Updates workstream and/or member_authority on an existing membership row.
// Admin only. Does NOT change the role (PK) — for role changes delete + re-add.
// ---------------------------------------------------------------------------
async function updateMember(req, res, params) {
  const user = await requireLogin(req, res);
  if (!user) return;

  const projectId    = parseInt(params.id, 10);
  const targetUserId = parseInt(params.userId, 10);
  const role         = params.role;
  if (!projectId || !targetUserId || !role) return sendError(res, 400, 'Invalid ids');

  if (user.system_role === 'project_manager') {
    if (!await pmCanManageProject(user.id, projectId)) {
      return sendError(res, 403, 'Project managers can only manage members on projects they created or lead');
    }
  } else if (user.system_role !== 'admin') {
    return sendError(res, 403, 'Forbidden');
  }

  let body;
  try { body = await readBody(req); } catch { return sendError(res, 400, 'Invalid JSON'); }

  const sets   = [];
  const values = [];

  if (body.workstream !== undefined) {
    sets.push('workstream = ?');
    values.push(body.workstream || null);
  }
  if (body.member_authority !== undefined) {
    sets.push('member_authority = ?');
    values.push(body.member_authority || null);
  }
  // When promoting to gate_approver via inline edit, approver_authority must be set
  if (body.approver_authority !== undefined) {
    if (body.approver_authority && !VALID_AUTHORITIES.includes(body.approver_authority)) {
      return sendError(res, 400, `approver_authority must be one of: ${VALID_AUTHORITIES.join(', ')}`);
    }
    sets.push('approver_authority = ?');
    values.push(body.approver_authority || null);
  }

  if (sets.length === 0) return sendError(res, 400, 'No updatable fields provided');
  values.push(projectId, targetUserId, role);

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute(
      `UPDATE project_members SET ${sets.join(', ')}
       WHERE project_id = ? AND user_id = ? AND role = ?`,
      values
    );
    await auditLog.log(conn, {
      userId: user.id, action: 'member_updated', projectId,
      detail: { target_user_id: targetUserId, role, changes: body },
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

module.exports = { create, list, getRecent, getProjectPresence, getOne, update, addMember, removeMember, deleteProject, updateMember };
