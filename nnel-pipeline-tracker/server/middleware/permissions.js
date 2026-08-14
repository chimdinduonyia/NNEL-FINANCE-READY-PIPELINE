'use strict';
/**
 * permissions.js — server-side permission enforcement layer
 *
 * SECURITY: Every function here re-queries the database. No permission
 * decision is based on data supplied by the browser. Routes call these
 * functions before performing any work. If a function returns false, the
 * route must stop and send 403 — do not proceed.
 *
 * This file encodes the permission matrix from §2 of the spec and the
 * gate-routing DOA thresholds from §3.
 */

const pool = require('../db');

// ---------------------------------------------------------------------------
// Authority ranking (used for re-open change-control authority check)
// Higher number = higher authority per the FRP DOA hierarchy.
// ---------------------------------------------------------------------------
const AUTHORITY_RANK = Object.freeze({
  slt_mtc:    1,
  m3_md_nnel: 2,
  nnel_board: 3,
  m4_ed_cam:  2,
  m2_evp:     4,
  m1_nnpc:    5,
});

// ---------------------------------------------------------------------------
// Low-level DB helpers
// ---------------------------------------------------------------------------

/**
 * Returns the user's membership record for a project, or null if none.
 * @param {number} projectId
 * @param {number} userId
 */
async function getProjectMember(projectId, userId) {
  const [rows] = await pool.execute(
    `SELECT role, workstream, approver_authority, access_expires_at
     FROM project_members
     WHERE project_id = ? AND user_id = ?`,
    [projectId, userId]
  );
  return rows[0] || null;
}

/**
 * Returns the stage state row for a (project, stageNumber) pair, or null.
 * @param {number} projectId
 * @param {number} stageNumber
 */
async function getStageState(projectId, stageNumber) {
  const [rows] = await pool.execute(
    `SELECT status, submitted_by, capex_at_submission, review_round
     FROM project_stages
     WHERE project_id = ? AND stage_number = ?`,
    [projectId, stageNumber]
  );
  return rows[0] || null;
}

/**
 * Returns true if the user holds ANY of the given roles on the project.
 * Multi-role aware: a user may have more than one row in project_members.
 */
async function hasProjectRole(projectId, userId, roles) {
  if (!roles || roles.length === 0) return false;
  const placeholders = roles.map(() => '?').join(', ');
  const [[row]] = await pool.execute(
    `SELECT 1 FROM project_members
     WHERE project_id = ? AND user_id = ? AND role IN (${placeholders})
     LIMIT 1`,
    [projectId, userId, ...roles]
  );
  return !!row;
}

// ---------------------------------------------------------------------------
// Permission checks (one function per meaningful action)
// Each returns true (allowed) or false (denied).
// ---------------------------------------------------------------------------

/**
 * Can this user view this project?
 *
 * - Admins always can.
 * - Any project member can, with one exception:
 *   Observers only get access from Stage 3 onward (spec §2) and only
 *   while their timed access window is open.
 */
async function canViewProject(userId, systemRole, projectId) {
  if (systemRole === 'admin') return true;
  if (systemRole === 'project_manager') return true; // PMs have visibility into all projects

  const member = await getProjectMember(projectId, userId);
  if (!member) return false;

  if (member.role === 'observer') {
    // Lender/observer access is time-limited
    if (member.access_expires_at && new Date(member.access_expires_at) < new Date()) {
      return false;
    }
    // Observers may only see Stage 3+ projects (data-room only)
    const [rows] = await pool.execute(
      'SELECT current_stage FROM projects WHERE id = ?',
      [projectId]
    );
    if (!rows[0] || rows[0].current_stage < 3) return false;
  }

  return true;
}

/**
 * Can this user edit working data for a specific stage?
 *
 * - Project Lead: yes, if the stage is currently 'in_progress' (not frozen).
 * - Contributor: yes, but ONLY their assigned workstream section, and only
 *   while the stage is 'in_progress'.
 * - All others: no. This includes Admins — they manage users/templates,
 *   not project working data.
 *
 * @param {number} userId
 * @param {string} systemRole
 * @param {number} projectId
 * @param {number} stageNumber
 * @param {string|null} workstream  The workstream section being edited.
 *                                  Required when the caller is a contributor.
 */
async function canEditWorkingData(userId, systemRole, projectId, stageNumber, workstream) {
  // Admins do not edit project data — they manage the system
  if (systemRole === 'admin') return false;

  const member = await getProjectMember(projectId, userId);
  if (!member) return false;

  // Submission lock: once a stage is submitted (or past), data is frozen
  const stage = await getStageState(projectId, stageNumber);
  if (!stage || stage.status !== 'in_progress') return false;

  if (member.role === 'project_lead') return true;

  if (member.role === 'contributor') {
    // Contributors are scoped to their assigned workstream only
    if (!workstream) return false;
    return member.workstream === workstream;
  }

  return false;
}

/**
 * Can this user submit this stage for gate review?
 *
 * - Only the Project Lead can submit.
 * - The stage must be 'in_progress' (not already submitted or decided).
 */
async function canSubmitStage(userId, systemRole, projectId, stageNumber) {
  if (systemRole === 'admin') return false;

  const member = await getProjectMember(projectId, userId);
  if (!member || member.role !== 'project_lead') return false;

  const stage = await getStageState(projectId, stageNumber);
  if (!stage || stage.status !== 'in_progress') return false;

  return true;
}

/**
 * Can this user record a gate decision (GO / Conditional / NO-GO)?
 *
 * Rules enforced here:
 *   1. User must be a gate_approver on this project.
 *   2. The stage must currently be in 'submitted' state.
 *   3. Segregation of duties: the approver cannot be the same person who
 *      submitted the stage (spec §2, non-negotiable boundary #1).
 *   4. Chain ordering: the user's authority must match the NEXT unsigned
 *      position in the chain (not just any position). This prevents
 *      MD-NNEL from signing Gate 1 before ED-CAM has done so.
 */
async function canApproveGate(userId, systemRole, projectId, stageNumber) {
  if (systemRole === 'admin') return false;

  const stage = await getStageState(projectId, stageNumber);
  if (!stage || stage.status !== 'submitted') return false;

  // SECURITY: segregation of duties always applies — submitter cannot be the approver
  if (stage.submitted_by === userId) return false;

  // Standard gates: user must be a gate_approver
  const member = await getProjectMember(projectId, userId);
  if (!member || member.role !== 'gate_approver') return false;

  const required = await getRequiredAuthority(stageNumber, stage.capex_at_submission, projectId);
  if (required.length === 0) return false;

  // SECURITY: chain ordering — count only decisions from the CURRENT review round.
  // Decisions from previous rounds (before a re-open) must not count toward
  // the new round's chain, otherwise the chain position would always be full.
  const [signed] = await pool.execute(
    `SELECT id FROM gate_decisions
     WHERE project_id = ? AND stage_number = ? AND review_round = ?
     ORDER BY chain_position`,
    [projectId, stageNumber, stage.review_round]
  );
  const nextIndex = signed.length; // 0-based index into required[]
  if (nextIndex >= required.length) return false; // all positions already signed

  return member.approver_authority === required[nextIndex];
}

/**
 * Can this user re-open a stage that has been decided (approved/conditional/rejected)?
 *
 * - Admins can always re-open (all re-opens are logged regardless).
 * - Gate Approvers can re-open if their authority is >= the authority that
 *   originally approved the stage. This "equal-or-higher" check is done
 *   in the re-open service (Step 4), not here — this function just confirms
 *   the user has a gate_approver role on the project.
 */
async function canReopenStage(userId, systemRole, projectId, stageNumber) {
  if (systemRole === 'admin') return true;

  const member = await getProjectMember(projectId, userId);
  if (!member || member.role !== 'gate_approver') return false;

  const stage = await getStageState(projectId, stageNumber);
  // Can only re-open stages that have reached a decided state
  if (!stage) return false;
  return ['approved', 'conditional', 'rejected'].includes(stage.status);
}

/**
 * Can this user view the project's audit log?
 *
 * Per the permission matrix: Admin, Project Lead, Gate Approver only.
 */
async function canViewAuditLog(userId, systemRole, projectId) {
  if (systemRole === 'admin') return true;
  // PMs have visibility into all projects including their audit logs
  if (systemRole === 'project_manager') return true;
  // Any project team member can view the audit trail for their project
  const member = await getProjectMember(projectId, userId);
  return !!member;
}

/**
 * Can this user attach an independent certification artifact?
 *
 * Only Independent Reviewers on this project may certify.
 */
async function canAttachCertification(userId, systemRole, projectId) {
  if (systemRole === 'admin') return false;

  const member = await getProjectMember(projectId, userId);
  if (!member) return false;
  return member.role === 'reviewer';
}

// ---------------------------------------------------------------------------
// Gate-routing DOA thresholds (spec §3)
// Returns an array of approver_authority values that are valid for this gate.
// ---------------------------------------------------------------------------

/**
 * Returns the ordered list of authority levels required to sign a gate.
 *
 * CAPEX-governed gates (2 and 3) always use the hardcoded DOA thresholds
 * regardless of any template configuration — this is non-negotiable because
 * the thresholds define which authority body has constitutional sign-off power
 * based on the project's financial size.
 *
 * All other gates (0, 1, 4, 5) first look up the template configuration for
 * the project, then fall back to the built-in defaults if no configuration
 * exists. Passing projectId is optional — callers that only need a display
 * hint (e.g. before a project exists) may omit it.
 *
 * @param {number}      stageNumber   0–5
 * @param {number|null} capexUSD      CAPEX locked at submission (for gates 2 & 3)
 * @param {number|null} [projectId]   Optional — used to look up template config
 * @returns {Promise<string[]>}       Ordered authority array
 */
async function getRequiredAuthority(stageNumber, capexUSD, projectId = null) {
  const capex = Number(capexUSD) || 0;

  // ---- CAPEX-governed gates: always use hardcoded thresholds ----
  if (stageNumber === 2) {
    return capex < 50_000_000 ? ['slt_mtc'] : ['nnel_board'];
  }
  if (stageNumber === 3) {
    if (capex <= 50_000_000) return ['nnel_board'];
    return ['nnel_board', 'm1_nnpc'];
  }

  // ---- Template-configurable gates (0, 1, 4, 5) ----
  // Try DB config first if a projectId is available
  if (projectId) {
    try {
      const [rows] = await pool.execute(
        `SELECT ga.authority
         FROM template_gate_approvers ga
         JOIN template_versions tv ON tv.id = ga.template_version_id
         JOIN projects p ON p.template_version = tv.version AND p.id = ?
         WHERE ga.stage_number = ?
         ORDER BY ga.chain_position`,
        [projectId, stageNumber]
      );
      if (rows.length > 0) return rows.map(r => r.authority);
    } catch {
      // table may not exist yet (migration not run) — fall through to defaults
    }
  }

  // Built-in defaults (used when no template config is found)
  switch (stageNumber) {
    case 0: return ['m3_md_nnel'];
    case 1: return ['m4_ed_cam', 'm3_md_nnel'];
    case 4: return ['m3_md_nnel'];
    case 5: return ['m4_ed_cam'];
    default: return [];
  }
}

module.exports = {
  AUTHORITY_RANK,
  hasProjectRole,
  getProjectMember,
  getStageState,
  canViewProject,
  canEditWorkingData,
  canSubmitStage,
  canApproveGate,
  canReopenStage,
  canViewAuditLog,
  canAttachCertification,
  getRequiredAuthority,
};
