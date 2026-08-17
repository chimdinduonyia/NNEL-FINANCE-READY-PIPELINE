'use strict';
/**
 * routes/conditions.js
 *
 * GET   /api/projects/:id/stages/:stage/conditions          — list conditions (current round)
 * PATCH /api/projects/:id/stages/:stage/conditions/:condId  — close a condition with evidence
 * POST  /api/projects/:id/stages/:stage/reopen              — re-open a locked stage
 */

const pool = require('../db');
const { requireLogin } = require('../middleware/auth');
const {
  AUTHORITY_RANK,
  canViewProject,
  canReopenStage,
  getProjectMember,
  getStageState,
  getRequiredAuthority,
} = require('../middleware/permissions');
const { sendJSON, sendError } = require('../utils/response');
const { readBody } = require('../utils/bodyParser');
const auditLog = require('../services/auditLog');
const stageService = require('../services/stageService');
const { MAX_STAGE_NUMBER } = require('../constants');

// ---------------------------------------------------------------------------
// GET /api/projects/:id/stages/:stage/conditions
//
// Returns all conditions for the current review round, each tagged with
// the gate decision that created it. The UI uses this to show which
// conditions are open and which have been resolved.
// ---------------------------------------------------------------------------
async function listConditions(req, res, params) {
  const user = await requireLogin(req, res);
  if (!user) return;

  const projectId = parseInt(params.id, 10);
  const stageNumber = parseInt(params.stage, 10);
  if (!projectId || isNaN(stageNumber)) return sendError(res, 400, 'Invalid ids');

  if (!await canViewProject(user.id, user.system_role, projectId)) {
    return sendError(res, 403, 'Forbidden');
  }

  const stage = await getStageState(projectId, stageNumber);
  if (!stage) return sendError(res, 404, 'Stage not found');

  const [rows] = await pool.execute(
    `SELECT
       gc.id,
       gc.description,
       gc.is_closed,
       gc.evidence_note,
       gc.closed_at,
       gc.created_at,
       gc.gate_decision_id,
       gd.authority          AS decision_authority,
       gd.chain_position     AS decision_chain_position,
       gd.decision           AS decision_type,
       uc.full_name          AS closed_by_name
     FROM gate_conditions gc
     JOIN gate_decisions gd ON gd.id = gc.gate_decision_id
     LEFT JOIN users uc ON uc.id = gc.closed_by
     WHERE gc.project_id = ? AND gc.stage_number = ? AND gd.review_round = ?
     ORDER BY gc.is_closed, gc.id`,
    [projectId, stageNumber, stage.review_round]
  );

  sendJSON(res, 200, rows);
}

// ---------------------------------------------------------------------------
// PATCH /api/projects/:id/stages/:stage/conditions/:condId
//
// Closes a condition with a mandatory evidence note. Once ALL conditions
// on the parent gate_decision are closed, the gate is resolved:
//
//   If the conditional decision was the LAST approver in the chain:
//     → project advances (advanceProject marks stage 'approved' and opens next)
//
//   If it was an intermediate approver in the chain:
//     → stage goes back to 'submitted' so the next chain approver can sign
//
// Permission: project_lead (any condition) or admin. Contributors are
// excluded — conditions are stage-level, not workstream-specific.
// ---------------------------------------------------------------------------
async function closeCondition(req, res, params) {
  const user = await requireLogin(req, res);
  if (!user) return;

  const projectId = parseInt(params.id, 10);
  const stageNumber = parseInt(params.stage, 10);
  const condId = parseInt(params.condId, 10);
  if (!projectId || isNaN(stageNumber) || !condId) return sendError(res, 400, 'Invalid ids');

  // Permission: admin or project_lead for this project
  let allowed = false;
  if (user.system_role === 'admin') {
    allowed = true;
  } else {
    const member = await getProjectMember(projectId, user.id);
    allowed = member?.role === 'project_lead';
  }
  if (!allowed) return sendError(res, 403, 'Forbidden — only the Project Lead or Admin can close conditions');

  let body;
  try { body = await readBody(req); } catch { return sendError(res, 400, 'Invalid JSON'); }

  if (!body.evidence_note || typeof body.evidence_note !== 'string' || body.evidence_note.trim().length === 0) {
    return sendError(res, 400, 'evidence_note is required — describe how this condition was satisfied');
  }

  // Load the condition and verify it belongs to this project/stage and is still open
  const [[cond]] = await pool.execute(
    `SELECT gc.id, gc.is_closed, gc.gate_decision_id
     FROM gate_conditions gc
     WHERE gc.id = ? AND gc.project_id = ? AND gc.stage_number = ?`,
    [condId, projectId, stageNumber]
  );
  if (!cond) return sendError(res, 404, 'Condition not found');
  if (cond.is_closed) return sendError(res, 409, 'This condition is already closed');

  // Load the parent gate decision to know its chain position
  const [[parentDecision]] = await pool.execute(
    'SELECT chain_position, review_round FROM gate_decisions WHERE id = ?',
    [cond.gate_decision_id]
  );
  if (!parentDecision) return sendError(res, 500, 'Parent gate decision not found');

  // Load stage state for CAPEX and review_round
  const stage = await getStageState(projectId, stageNumber);
  if (!stage || stage.status !== 'conditional') {
    return sendError(res, 409, 'Stage is not in conditional state');
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // Close this condition
    await conn.execute(
      `UPDATE gate_conditions
       SET is_closed = 1, closed_by = ?, closed_at = NOW(), evidence_note = ?
       WHERE id = ?`,
      [user.id, body.evidence_note.trim(), condId]
    );

    await auditLog.log(conn, {
      userId: user.id,
      action: 'condition_closed',
      projectId,
      stageNumber,
      detail: { condition_id: condId, evidence_note: body.evidence_note.trim() },
    });

    // Check if ALL conditions for the parent decision are now closed
    const [[counts]] = await conn.execute(
      `SELECT COUNT(*) AS total, SUM(is_closed) AS closed
       FROM gate_conditions
       WHERE gate_decision_id = ?`,
      [cond.gate_decision_id]
    );

    const allResolved = Number(counts.total) === Number(counts.closed);

    // Compute required chain length once — reused for both the advance logic and the response
    const requiredForConditions = allResolved
      ? await getRequiredAuthority(stageNumber, stage.capex_at_submission, projectId)
      : [];

    if (allResolved) {
      const required = requiredForConditions;
      const isLastInChain = parentDecision.chain_position >= required.length;

      if (isLastInChain) {
        // All conditions met, final approver had signed — advance the project
        await stageService.advanceProject(conn, projectId, stageNumber);

        await auditLog.log(conn, {
          userId: user.id,
          action: 'gate_conditions_resolved',
          projectId,
          stageNumber,
          detail: { outcome: 'stage_advanced', gate_decision_id: cond.gate_decision_id },
        });
      } else {
        // All conditions met, but more approvers in the chain must still sign.
        // Reset stage to 'submitted' so the next chain position can proceed.
        await conn.execute(
          "UPDATE project_stages SET status = 'submitted' WHERE project_id = ? AND stage_number = ?",
          [projectId, stageNumber]
        );

        await auditLog.log(conn, {
          userId: user.id,
          action: 'gate_conditions_resolved',
          projectId,
          stageNumber,
          detail: {
            outcome: 'chain_continues',
            gate_decision_id: cond.gate_decision_id,
            next_chain_position: parentDecision.chain_position + 1,
          },
        });
      }
    }

    await conn.commit();
    sendJSON(res, 200, {
      closed: true,
      all_conditions_resolved: allResolved,
      ...(allResolved && {
        outcome: parentDecision.chain_position >= requiredForConditions.length
          ? 'stage_advanced' : 'chain_continues',
      }),
    });
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

// ---------------------------------------------------------------------------
// POST /api/projects/:id/stages/:stage/reopen
//
// Re-opens a stage that is locked (approved / conditional / rejected).
// This is a change-control event — it is always logged and is the only
// way to amend a gate decision without violating the append-only rule.
//
// Permission: Admin always. Gate Approver only if their authority rank is
// ≥ the highest authority that signed in the most recent review round.
//
// Downstream effects:
//   - If stage was 'approved' and the next stage is 'not_started' or
//     'in_progress': rolls back the next stage and decrements current_stage.
//   - If the next stage is already 'submitted' or beyond: blocked — the
//     caller must resolve the downstream stage first.
//
// After re-open: review_round increments, status resets to 'in_progress'.
// Previous decisions remain in gate_decisions (immutable) but are ignored
// by the chain logic because they belong to the prior review_round.
// ---------------------------------------------------------------------------
async function reopenStage(req, res, params) {
  const user = await requireLogin(req, res);
  if (!user) return;

  const projectId = parseInt(params.id, 10);
  const stageNumber = parseInt(params.stage, 10);
  if (!projectId || isNaN(stageNumber) || stageNumber < 0 || stageNumber > MAX_STAGE_NUMBER) {
    return sendError(res, 400, 'Invalid project id or stage number');
  }

  // Coarse permission check: admin OR gate_approver with locked stage
  if (!await canReopenStage(user.id, user.system_role, projectId, stageNumber)) {
    return sendError(res, 403, 'Forbidden — stage must be approved/conditional/rejected, and you must be Admin or Gate Approver');
  }

  let body;
  try { body = await readBody(req); } catch { return sendError(res, 400, 'Invalid JSON'); }

  if (!body.reason || typeof body.reason !== 'string' || body.reason.trim().length === 0) {
    return sendError(res, 400, 'reason is required — state why this stage is being re-opened');
  }

  const stage = await getStageState(projectId, stageNumber);

  // Fine-grained authority check for gate_approvers
  if (user.system_role !== 'admin') {
    const member = await getProjectMember(projectId, user.id);

    // Find the highest-ranking authority that signed in the most recent review
    // round. Ranking is done in JS against AUTHORITY_RANK — the single source
    // of truth for authority order — rather than a separate SQL CASE, so this
    // can never silently disagree with the rank table used for the actual
    // comparison below. (Prior to 2026-08-17 this used its own inline SQL
    // ranking that disagreed with AUTHORITY_RANK on whether m3_md_nnel
    // outranks m4_ed_cam — see DOA_SPEC.md §1. Fixed by removing the
    // duplicate ranking entirely.)
    const [signers] = await pool.execute(
      `SELECT authority FROM gate_decisions
       WHERE project_id = ? AND stage_number = ? AND review_round = ? AND authority IS NOT NULL`,
      [projectId, stageNumber, stage.review_round]
    );
    const topSigner = signers.reduce((top, row) => {
      const rank = AUTHORITY_RANK[row.authority] ?? 0;
      return rank > (AUTHORITY_RANK[top?.authority] ?? -1) ? row : top;
    }, null);

    if (topSigner) {
      const required = AUTHORITY_RANK[topSigner.authority] ?? 0;
      const provided = AUTHORITY_RANK[member.approver_authority] ?? 0;
      if (provided < required) {
        return sendError(res, 403,
          `Insufficient authority — this gate was signed by ${topSigner.authority.replace(/_/g, '-').toUpperCase()}. ` +
          `You need equal or higher authority to re-open it.`
        );
      }
    }
  }

  // Determine the state of the next stage (only relevant if current stage was approved)
  const previousStatus = stage.status;
  let nextStageStatus = null;
  if (previousStatus === 'approved' && stageNumber < 5) {
    const [[nextStage]] = await pool.execute(
      'SELECT status FROM project_stages WHERE project_id = ? AND stage_number = ?',
      [projectId, stageNumber + 1]
    );
    nextStageStatus = nextStage?.status;

    // Block re-open if the next stage is already too far along to safely roll back
    if (nextStageStatus && ['submitted', 'approved', 'conditional', 'rejected'].includes(nextStageStatus)) {
      return sendError(res, 409,
        `Cannot re-open Stage ${stageNumber} — Stage ${stageNumber + 1} is already '${nextStageStatus}'. ` +
        `Resolve the downstream stage first.`
      );
    }
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const newRound = stage.review_round + 1;

    // Reset the stage: back to in_progress with a new review round.
    // submitted_by / submitted_at / capex_at_submission are cleared so a
    // fresh submission sets them correctly in the new round.
    await conn.execute(
      `UPDATE project_stages
       SET status = 'in_progress',
           review_round = ?,
           submitted_by = NULL,
           submitted_at = NULL,
           capex_at_submission = NULL
       WHERE project_id = ? AND stage_number = ?`,
      [newRound, projectId, stageNumber]
    );

    // Roll back the next stage if this was an approved gate
    if (previousStatus === 'approved' && stageNumber < 5) {
      await conn.execute(
        "UPDATE project_stages SET status = 'not_started' WHERE project_id = ? AND stage_number = ?",
        [projectId, stageNumber + 1]
      );
      await conn.execute(
        'UPDATE projects SET current_stage = ? WHERE id = ?',
        [stageNumber, projectId]
      );
    }

    await auditLog.log(conn, {
      userId: user.id,
      action: 'stage_reopened',
      projectId,
      stageNumber,
      detail: {
        reason: body.reason.trim(),
        previous_status: previousStatus,
        review_round_before: stage.review_round,
        review_round_after: newRound,
        next_stage_rolled_back: previousStatus === 'approved' && stageNumber < 5 &&
          ['not_started', 'in_progress'].includes(nextStageStatus ?? ''),
      },
    });

    await conn.commit();
    sendJSON(res, 200, {
      reopened: true,
      stage_number: stageNumber,
      new_review_round: newRound,
      previous_status: previousStatus,
    });
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

module.exports = { listConditions, closeCondition, reopenStage };
