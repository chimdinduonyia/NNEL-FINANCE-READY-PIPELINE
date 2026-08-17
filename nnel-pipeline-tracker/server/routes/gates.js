'use strict';
/**
 * routes/gates.js
 *
 * POST /api/projects/:id/stages/:stage/submit     — Project Lead submits for gate review
 * POST /api/projects/:id/stages/:stage/decision   — Gate Approver records GO/Conditional/NO-GO
 * GET  /api/projects/:id/stages/:stage/decisions  — list all decisions for this stage
 * GET  /api/projects/:id/audit                    — full project audit log
 *
 * SECURITY: gate_decisions rows are never updated or deleted here.
 * The DB grant enforces this at the database level too — the app user
 * has only INSERT + SELECT on gate_decisions.
 */

const pool = require('../db');
const { requireLogin } = require('../middleware/auth');
const {
  canViewProject,
  canSubmitStage,
  canApproveGate,
  canViewAuditLog,
  getProjectMember,
  getStageState,
  getRequiredAuthority,
} = require('../middleware/permissions');
const { sendJSON, sendError } = require('../utils/response');
const { readBody } = require('../utils/bodyParser');
const auditLog = require('../services/auditLog');
const stageService = require('../services/stageService');

// ---------------------------------------------------------------------------
// POST /api/projects/:id/stages/:stage/submit
//
// The Project Lead submits the stage for gate review. This freezes the
// working data (enforced by canEditWorkingData checking status !== 'in_progress')
// and locks the CAPEX figure for gate routing.
// ---------------------------------------------------------------------------
async function submit(req, res, params) {
  const user = await requireLogin(req, res);
  if (!user) return;

  const projectId = parseInt(params.id, 10);
  const stageNumber = parseInt(params.stage, 10);
  if (!projectId || isNaN(stageNumber) || stageNumber < 0 || stageNumber > 5) {
    return sendError(res, 400, 'Invalid project id or stage number');
  }

  // SECURITY: permission check — only project_lead, stage must be in_progress
  if (!await canSubmitStage(user.id, user.system_role, projectId, stageNumber)) {
    return sendError(res, 403, 'Forbidden — you must be the Project Lead and the stage must be in progress');
  }

  // Optional submission summary written by the Project Lead
  let submissionSummary = null;
  try {
    const body = await readBody(req);
    submissionSummary = body?.submission_summary?.trim() || null;
  } catch { /* body is optional */ }

  // Read the current project CAPEX to lock it at submission
  const [[project]] = await pool.execute(
    'SELECT capex_usd FROM projects WHERE id = ?',
    [projectId]
  );
  if (!project) return sendError(res, 404, 'Project not found');

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // Lock the stage: freeze working data, record CAPEX and summary
    await conn.execute(
      `UPDATE project_stages
       SET status = 'submitted',
           submitted_by = ?,
           submitted_at = NOW(),
           capex_at_submission = ?,
           submission_summary = ?
       WHERE project_id = ? AND stage_number = ?`,
      [user.id, project.capex_usd, submissionSummary, projectId, stageNumber]
    );

    // Compute the required approvers so we can include them in the response
    const required = await getRequiredAuthority(stageNumber, project.capex_usd, projectId);

    await auditLog.log(conn, {
      userId: user.id,
      action: 'stage_submitted',
      projectId,
      stageNumber,
      detail: {
        capex_at_submission: project.capex_usd,
        required_approvers: required,
      },
    });

    await conn.commit();
    sendJSON(res, 200, {
      submitted: true,
      stage_number: stageNumber,
      capex_locked: project.capex_usd,
      required_approvers: required,
    });
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

// ---------------------------------------------------------------------------
// POST /api/projects/:id/stages/:stage/recall
//
// The original submitter pulls the stage back from review before any gate
// decision has been recorded in the current round. This un-freezes the
// working data so they can edit and re-submit.
// Blocked once any approver has recorded a decision this round.
// review_round is NOT incremented — a recall is not a new round.
// ---------------------------------------------------------------------------
async function recall(req, res, params) {
  const user = await requireLogin(req, res);
  if (!user) return;

  const projectId   = parseInt(params.id, 10);
  const stageNumber = parseInt(params.stage, 10);
  if (!projectId || isNaN(stageNumber) || stageNumber < 0 || stageNumber > 5) {
    return sendError(res, 400, 'Invalid project id or stage number');
  }

  const stage = await getStageState(projectId, stageNumber);
  if (!stage) return sendError(res, 404, 'Stage not found');
  if (stage.status !== 'submitted') {
    return sendError(res, 409, 'Stage is not currently submitted — nothing to recall');
  }

  // SECURITY: only the original submitter or admin may recall
  if (user.system_role !== 'admin' && stage.submitted_by !== user.id) {
    return sendError(res, 403, 'Forbidden — only the person who submitted can recall this submission');
  }

  // Block if any approver has already acted in the current review round
  const [[{ decisionCount }]] = await pool.execute(
    `SELECT COUNT(*) AS decisionCount FROM gate_decisions
     WHERE project_id = ? AND stage_number = ? AND review_round = ?`,
    [projectId, stageNumber, stage.review_round]
  );
  if (Number(decisionCount) > 0) {
    return sendError(res, 409,
      'A gate decision has already been recorded this round — the submission can no longer be recalled');
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    await conn.execute(
      `UPDATE project_stages
       SET status              = 'in_progress',
           submitted_by        = NULL,
           submitted_at        = NULL,
           capex_at_submission = NULL,
           submission_summary  = NULL
       WHERE project_id = ? AND stage_number = ?`,
      [projectId, stageNumber]
    );

    await auditLog.log(conn, {
      userId: user.id,
      action: 'submission_recalled',
      projectId,
      stageNumber,
      detail: { review_round: stage.review_round },
    });

    await conn.commit();
    sendJSON(res, 200, { ok: true });
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

// ---------------------------------------------------------------------------
// POST /api/projects/:id/stages/:stage/decision
//
// Gate Approver records a GO, Conditional, or NO-GO decision.
//
// For chained gates (any stage with a multi-signer chain configured in the
// template editor, e.g. Gate 1's default ED-CAM → MD-NNEL), each approver in
// the chain calls this endpoint in turn. canApproveGate() enforces the
// ordering — the second approver is blocked until the first has signed.
//
// Stage advancement:
//   GO + last in chain → stage 'approved', next stage opened
//   GO + not last      → stage stays 'submitted' (next approver in chain)
//   Conditional        → stage 'conditional', conditions recorded (closed in Step 4)
//   NO-GO              → stage 'rejected'
//
// ---------------------------------------------------------------------------
async function recordDecision(req, res, params) {
  const user = await requireLogin(req, res);
  if (!user) return;

  const projectId = parseInt(params.id, 10);
  const stageNumber = parseInt(params.stage, 10);
  if (!projectId || isNaN(stageNumber) || stageNumber < 0 || stageNumber > 5) {
    return sendError(res, 400, 'Invalid project id or stage number');
  }

  // SECURITY: this call verifies role, stage state, segregation of duties,
  // and chain ordering — all in one server-side check
  if (!await canApproveGate(user.id, user.system_role, projectId, stageNumber)) {
    return sendError(res, 403, 'Forbidden — check role, stage status, segregation of duties, and chain order');
  }

  // GOVERNANCE: all submitted documents must be reviewed (approved or returned)
  // before a gate decision can be recorded. No document may remain in 'submitted'
  // status — the approver must have expressed an opinion on every document first.
  const [[{ pendingDocs }]] = await pool.execute(
    `SELECT COUNT(*) AS pendingDocs FROM document_register
     WHERE project_id = ? AND stage_number = ? AND status = 'submitted'`,
    [projectId, stageNumber]
  );
  if (Number(pendingDocs) > 0) {
    return sendError(res, 409,
      `${pendingDocs} document${pendingDocs > 1 ? 's' : ''} in this stage ` +
      `${pendingDocs > 1 ? 'are' : 'is'} still marked "Submitted". ` +
      `Please approve or return each document before recording the gate decision.`
    );
  }

  let body;
  try { body = await readBody(req); } catch { return sendError(res, 400, 'Invalid JSON'); }

  const { decision, rationale, conditions } = body;

  // If any documents were returned to the team (outstanding), the approver
  // has indicated dissatisfaction — only NO-GO is permitted.
  if (['go', 'conditional'].includes(decision)) {
    const [[{ returnedDocs }]] = await pool.execute(
      `SELECT COUNT(*) AS returnedDocs FROM document_register
       WHERE project_id = ? AND stage_number = ? AND status = 'outstanding'`,
      [projectId, stageNumber]
    );
    if (Number(returnedDocs) > 0) {
      return sendError(res, 409,
        `${returnedDocs} document${returnedDocs > 1 ? 's' : ''} in this stage ` +
        `${returnedDocs > 1 ? 'have' : 'has'} been returned to the project team. ` +
        `You may only record NO-GO while documents remain outstanding.`
      );
    }
  }
  if (!['go', 'conditional', 'no_go'].includes(decision)) {
    return sendError(res, 400, 'decision must be "go", "conditional", or "no_go"');
  }
  if (!rationale || typeof rationale !== 'string' || rationale.trim().length === 0) {
    return sendError(res, 400, 'rationale is required');
  }
  if (decision === 'conditional') {
    if (!Array.isArray(conditions) || conditions.length === 0) {
      return sendError(res, 400, 'conditions array (with at least one item) is required for a conditional decision');
    }
    if (conditions.some(c => !c.description || typeof c.description !== 'string')) {
      return sendError(res, 400, 'each condition must have a description string');
    }
  }

  const stage    = await getStageState(projectId, stageNumber);
  const required = await getRequiredAuthority(stageNumber, stage.capex_at_submission, projectId);

  // Count only decisions in the CURRENT review round — prior-round decisions
  // must not shift the chain position after a re-open.
  const [existingDecisions] = await pool.execute(
    `SELECT id FROM gate_decisions
     WHERE project_id = ? AND stage_number = ? AND review_round = ?
     ORDER BY chain_position`,
    [projectId, stageNumber, stage.review_round]
  );
  const chainPosition = existingDecisions.length + 1;   // 1-indexed
  const isLastInChain = chainPosition >= required.length;

  // Determine the new stage status from this decision
  let newStageStatus;
  if (decision === 'no_go') {
    newStageStatus = 'in_progress'; // auto-reopen: stage goes straight back to editing
  } else if (decision === 'conditional') {
    newStageStatus = 'conditional';
  } else {
    // GO: advance stage only when the final link in the chain signs
    newStageStatus = isLastInChain ? 'approved' : 'submitted';
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // Determine the authority to record — the approver's authority level
    // derived from their position in the chain. Falls back to NULL only if
    // `required` were somehow empty (shouldn't happen for a configured or
    // defaulted stage, but the column stays nullable as a safety net).
    const recordedAuthority = required[chainPosition - 1] ?? null;

    // INSERT the gate decision. The DB grant prevents UPDATE/DELETE on this table.
    const [decisionResult] = await conn.execute(
      `INSERT INTO gate_decisions
         (project_id, stage_number, decided_by, authority, decision, rationale, chain_position, review_round)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        projectId,
        stageNumber,
        user.id,
        recordedAuthority,
        decision,
        rationale.trim(),
        chainPosition,
        stage.review_round,
      ]
    );
    const decisionId = decisionResult.insertId;

    // Record conditions for a Conditional decision (closure handled in Step 4)
    if (decision === 'conditional' && conditions) {
      for (const cond of conditions) {
        await conn.execute(
          `INSERT INTO gate_conditions
             (gate_decision_id, project_id, stage_number, description)
           VALUES (?, ?, ?, ?)`,
          [decisionId, projectId, stageNumber, cond.description.trim()]
        );
      }
    }

    // Update the stage status.
    // NO-GO: auto-reopen by incrementing review_round and clearing submission fields
    // so the project team can revise and re-submit without any manual intervention.
    if (decision === 'no_go') {
      await conn.execute(
        `UPDATE project_stages
         SET status = 'in_progress',
             review_round = review_round + 1,
             submitted_by = NULL,
             submitted_at = NULL,
             capex_at_submission = NULL
         WHERE project_id = ? AND stage_number = ?`,
        [projectId, stageNumber]
      );
    } else {
      await conn.execute(
        'UPDATE project_stages SET status = ? WHERE project_id = ? AND stage_number = ?',
        [newStageStatus, projectId, stageNumber]
      );
      if (newStageStatus === 'approved') {
        await stageService.advanceProject(conn, projectId, stageNumber);
      }
    }

    await auditLog.log(conn, {
      userId: user.id,
      action: 'gate_decision_recorded',
      projectId,
      stageNumber,
      detail: {
        decision,
        authority: recordedAuthority,
        chain_position: chainPosition,
        is_last_in_chain: isLastInChain,
        new_stage_status: newStageStatus,
        condition_count: decision === 'conditional' ? conditions.length : 0,
      },
    });

    await conn.commit();
    sendJSON(res, 201, {
      decision,
      authority: recordedAuthority,
      chain_position: chainPosition,
      is_last_in_chain: isLastInChain,
      new_stage_status: newStageStatus,
      ...(decision === 'conditional' && { conditions_recorded: conditions.length }),
    });
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

// ---------------------------------------------------------------------------
// GET /api/projects/:id/stages/:stage/decisions
//
// Returns all gate decisions for this stage in chain order, each with
// its conditions (if any). Readable by anyone who can view the project.
// ---------------------------------------------------------------------------
async function listDecisions(req, res, params) {
  const user = await requireLogin(req, res);
  if (!user) return;

  const projectId = parseInt(params.id, 10);
  const stageNumber = parseInt(params.stage, 10);
  if (!projectId || isNaN(stageNumber)) return sendError(res, 400, 'Invalid ids');

  if (!await canViewProject(user.id, user.system_role, projectId)) {
    return sendError(res, 403, 'Forbidden');
  }

  const [decisions] = await pool.execute(
    `SELECT
       gd.id,
       gd.review_round,
       gd.chain_position,
       gd.authority,
       gd.decision,
       gd.rationale,
       gd.created_at,
       u.full_name  AS decided_by_name,
       u.email      AS decided_by_email
     FROM gate_decisions gd
     JOIN users u ON u.id = gd.decided_by
     WHERE gd.project_id = ? AND gd.stage_number = ?
     ORDER BY gd.review_round, gd.chain_position, gd.created_at`,
    [projectId, stageNumber]
  );

  // Attach conditions to each decision
  const decisionsWithConditions = await Promise.all(
    decisions.map(async (d) => {
      const [conds] = await pool.execute(
        `SELECT id, description, is_closed, evidence_note, closed_at, closed_by
         FROM gate_conditions
         WHERE gate_decision_id = ?
         ORDER BY id`,
        [d.id]
      );
      return { ...d, conditions: conds };
    })
  );

  sendJSON(res, 200, decisionsWithConditions);
}

// ---------------------------------------------------------------------------
// GET /api/projects/:id/audit
//
// Full project audit log, newest first. Visible to admin, project_lead,
// and gate_approver per the spec §2 permission matrix.
// ---------------------------------------------------------------------------
async function getAuditLog(req, res, params) {
  const user = await requireLogin(req, res);
  if (!user) return;

  const projectId = parseInt(params.id, 10);
  if (!projectId) return sendError(res, 400, 'Invalid project id');

  if (!await canViewAuditLog(user.id, user.system_role, projectId)) {
    return sendError(res, 403, 'Forbidden');
  }

  const [rows] = await pool.execute(
    `SELECT
       al.id,
       al.stage_number,
       al.action,
       al.detail,
       al.created_at,
       u.full_name  AS actor_name,
       u.email      AS actor_email
     FROM audit_log al
     JOIN users u ON u.id = al.user_id
     WHERE al.project_id = ?
     ORDER BY al.created_at DESC`,
    [projectId]
  );

  // Parse the stored JSON detail strings back to objects for the response
  sendJSON(res, 200, rows.map(r => ({
    ...r,
    detail: r.detail ? JSON.parse(r.detail) : null,
  })));
}

module.exports = { submit, recall, recordDecision, listDecisions, getAuditLog };
