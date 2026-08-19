'use strict';
/**
 * routes/notifications.js — derived, read-only notifications
 *
 * There is no notifications table and no new write path anywhere in the
 * app. Every notification is derived, on read, from audit_log rows that
 * are already being written by the existing routes. This keeps the whole
 * feature additive: nothing that already writes to audit_log had to
 * change.
 *
 * A notification only ever goes to the person it actually concerns, never
 * to "everyone on the project" as a broadcast — e.g. adding a team member
 * notifies only that member, not the rest of the team; a stage being
 * submitted for gate review notifies only the approver whose turn it
 * currently is, not every project member. See getEligibleNotifications()
 * for the per-action targeting rules. A notification is either:
 *   1. A specific, actionable event on a project this user is a member of
 *      (their own gate decision to make, their own stage reopened, their
 *      own document approved/returned, they were added/removed, etc.)
 *   2. An admin editing this user's own account (name/email/role change,
 *      password reset, activate/deactivate) -- excludes the user's own
 *      self-service actions.
 *
 * GET  /api/notifications              — the list (capped at 50, newest first)
 * GET  /api/notifications/unread-count — lightweight count for the sidebar badge
 * POST /api/notifications/mark-seen    — records that the user has viewed their feed
 */

const pool = require('../db');
const { requireLogin } = require('../middleware/auth');
const { sendJSON, sendError } = require('../utils/response');
const { getRequiredAuthority } = require('../middleware/permissions');

// Project-scoped events where eligibility depends on the viewer's CURRENT
// role/authority on that project (checked in JS against a fresh
// project_members read - see getEligibleNotifications). Deliberately
// excludes checklist_item_updated / evidence_note_edited / document_created
// / document_updated / document_deleted / raci_cell_updated (too frequent to
// be useful) and project_updated (an edit to project details doesn't
// concern any one member personally — still fully visible in the project's
// own Audit tab).
const ROLE_CHECKED_ACTIONS = [
  'gate_decision_recorded', 'stage_submitted', 'stage_reopened',
  'submission_recalled', 'condition_closed', 'gate_conditions_resolved',
];

// Admin actions on the *viewing user's own* account.
const ACCOUNT_ACTIONS = ['user_updated', 'user_status_changed', 'user_password_reset'];

// Fetched generously and filtered down in JS afterward (see
// getEligibleNotifications) — per-user eligibility depends on chain
// position / project role / who a member-add or document-status-change
// actually targeted, none of which can be expressed as a flat SQL WHERE
// without duplicating the gate-routing logic that already lives in
// permissions.js. A flat LIMIT 50 applied *before* that filtering could
// silently drop genuinely-relevant older rows in favour of newer
// not-actually-for-you ones, so the raw candidate fetch is capped much
// higher than the 50 actually returned to the client.
const CANDIDATE_LIMIT = 300;

// member_assigned/member_removed/document_status_updated are matched by a
// specific target user id in their detail JSON rather than by "is this user
// currently a project member" — deliberately, because for member_removed
// the whole point of the notification is that they are NOT a member
// anymore, so a membership-based filter would silently swallow the one
// event they most need to see.
// stage_checklist_completed deliberately sits OUTSIDE the "al.user_id != ?"
// actor exclusion that applies to everything else: when the project lead is
// also the one ticking checklist items (common on smaller teams), they can
// be the actor on the very tick that completes the stage. That's still a
// genuine milestone worth confirming to them - it's not "notifying you of
// your own action" so much as "your stage is now ready to submit" - so
// self-triggered completions must not be silently dropped.
const CANDIDATE_QUERY = `
  SELECT al.id, al.project_id, al.stage_number, al.action, al.detail, al.created_at,
         al.user_id AS actor_id, u.full_name AS actor_name, u.system_role AS actor_role,
         p.name AS project_name
  FROM audit_log al
  JOIN users u ON u.id = al.user_id
  LEFT JOIN projects p ON p.id = al.project_id
  WHERE
    (al.user_id != ? AND (
      (al.project_id IN (SELECT project_id FROM project_members WHERE user_id = ?)
       AND al.action IN (${ROLE_CHECKED_ACTIONS.map(() => '?').join(',')}))
      OR (al.action = 'member_assigned' AND CAST(al.detail ->> '$.target_user_id' AS UNSIGNED) = ?)
      OR (al.action = 'member_removed'  AND CAST(al.detail ->> '$.target_user_id' AS UNSIGNED) = ?)
      OR (al.action = 'document_status_updated' AND CAST(al.detail ->> '$.uploaded_by' AS UNSIGNED) = ?)
      OR
      (al.action IN (${ACCOUNT_ACTIONS.map(() => '?').join(',')})
       AND CAST(al.detail ->> '$.target_user_id' AS UNSIGNED) = ?)
    ))
    OR (al.action = 'stage_checklist_completed'
        AND al.project_id IN (SELECT project_id FROM project_members WHERE user_id = ?))
  ORDER BY al.created_at DESC
  LIMIT ${CANDIDATE_LIMIT}
`;

function candidateParams(userId) {
  return [
    userId, userId, ...ROLE_CHECKED_ACTIONS,
    userId, userId, userId,
    ...ACCOUNT_ACTIONS, userId,
    userId,
  ];
}

// ---------------------------------------------------------------------------
// Computes the notification feed actually eligible for one user: fetches a
// generous candidate set, then applies a per-action "does this genuinely
// concern this specific person" rule. Shared by list() and unreadCount() so
// the two can never drift out of sync with each other.
// ---------------------------------------------------------------------------
async function getEligibleNotifications(userId) {
  const [rows] = await pool.execute(CANDIDATE_QUERY, candidateParams(userId));
  if (rows.length === 0) return [];

  // This user's own membership (role + approver authority) on every project
  // that appears in the candidate set, so each row can be checked against
  // "is this actually about me" without a query per row.
  const projectIds = [...new Set(rows.filter(r => r.project_id).map(r => r.project_id))];
  const myMembership = {};
  if (projectIds.length > 0) {
    const [memberRows] = await pool.execute(
      `SELECT project_id, role, approver_authority FROM project_members
       WHERE user_id = ? AND project_id IN (${projectIds.map(() => '?').join(',')})`,
      [userId, ...projectIds]
    );
    memberRows.forEach(m => { myMembership[m.project_id] = m; });
  }

  // getRequiredAuthority() hits the DB — cache per (project, stage) since
  // several candidate rows commonly share the same one.
  const chainCache = {};
  async function requiredFor(projectId, stageNumber) {
    const key = `${projectId}:${stageNumber}`;
    if (!(key in chainCache)) {
      chainCache[key] = await getRequiredAuthority(stageNumber, null, projectId);
    }
    return chainCache[key];
  }

  const eligible = [];
  for (const row of rows) {
    const detail = row.detail ? JSON.parse(row.detail) : null;
    const me = row.project_id ? myMembership[row.project_id] : null;

    let include;
    switch (row.action) {
      // A gate awaiting approval — only the approver whose turn it is right
      // now (first in the required chain), not the whole approval panel.
      case 'stage_submitted': {
        if (me?.role === 'gate_approver') {
          const required = await requiredFor(row.project_id, row.stage_number);
          include = required[0] != null && required[0] === me.approver_authority;
        } else {
          include = false;
        }
        break;
      }

      // The pending review that just vanished from the queue — only the
      // approver who would have acted next (recall is only possible before
      // any decision this round, so that's always chain position 1).
      case 'submission_recalled': {
        if (me?.role === 'gate_approver') {
          const required = await requiredFor(row.project_id, row.stage_number);
          include = required[0] != null && required[0] === me.approver_authority;
        } else {
          include = false;
        }
        break;
      }

      // A GO that isn't the last signature yet hands the gate to the NEXT
      // approver in the chain (their turn just started - notify them like a
      // fresh "awaiting approval"). Any other outcome (final GO, Conditional,
      // NO-GO) is final for this round and instead concerns the project
      // lead, whose stage it is.
      case 'gate_decision_recorded': {
        const isFinal = detail?.decision !== 'go' || detail?.is_last_in_chain;
        if (isFinal) {
          include = me?.role === 'project_lead';
        } else if (me?.role === 'gate_approver') {
          const required = await requiredFor(row.project_id, row.stage_number);
          // chain_position is 1-indexed and just completed, so that same
          // number is the next 0-indexed slot in the chain.
          const nextAuthority = required[detail?.chain_position] ?? null;
          include = nextAuthority != null && nextAuthority === me.approver_authority;
        } else {
          include = false;
        }
        break;
      }

      // Their stage got reopened - concerns the project lead who now needs
      // to revise and resubmit.
      case 'stage_reopened':
        include = me?.role === 'project_lead';
        break;

      // Every mandatory checklist item for the stage is now ticked -
      // concerns the project lead, who can now submit the stage for gate
      // review.
      case 'stage_checklist_completed':
        include = me?.role === 'project_lead';
        break;

      // Progress toward a pending re-decision - concerns the project lead
      // and whichever approver(s) are in this stage's chain.
      case 'condition_closed':
      case 'gate_conditions_resolved': {
        if (me?.role === 'project_lead') {
          include = true;
        } else if (me?.role === 'gate_approver') {
          const required = await requiredFor(row.project_id, row.stage_number);
          include = required.includes(me.approver_authority);
        } else {
          include = false;
        }
        break;
      }

      // member_assigned / member_removed / document_status_updated (matched
      // by target_user_id / uploaded_by) and ACCOUNT_ACTIONS (user_updated /
      // user_status_changed / user_password_reset, matched by target_user_id)
      // - the candidate query already restricts every one of these to the
      // specific user it's about, nothing further to check here.
      default:
        include = true;
    }

    if (include) eligible.push({ ...row, detail });
  }

  return eligible.slice(0, 50);
}

// ---------------------------------------------------------------------------
// GET /api/notifications
// ---------------------------------------------------------------------------
async function list(req, res) {
  const user = await requireLogin(req, res);
  if (!user) return;

  const items = await getEligibleNotifications(user.id);

  const [[{ last_seen }]] = await pool.execute(
    'SELECT notifications_last_seen_at AS last_seen FROM users WHERE id = ?',
    [user.id]
  );

  sendJSON(res, 200, { last_seen_at: last_seen, items });
}

// ---------------------------------------------------------------------------
// GET /api/notifications/unread-count
// Same eligibility rules as list(), just a COUNT — kept separate so every
// page can cheaply show a sidebar badge without pulling the full feed.
// ---------------------------------------------------------------------------
async function unreadCount(req, res) {
  const user = await requireLogin(req, res);
  if (!user) return;

  const [[{ last_seen }]] = await pool.execute(
    'SELECT notifications_last_seen_at AS last_seen FROM users WHERE id = ?',
    [user.id]
  );

  const items = await getEligibleNotifications(user.id);
  const count = last_seen
    ? items.filter(n => new Date(n.created_at) > new Date(last_seen)).length
    : items.length;

  sendJSON(res, 200, { count });
}

// ---------------------------------------------------------------------------
// POST /api/notifications/mark-seen
// Personal UI-state only (not a governance event), so this deliberately
// does not write to audit_log.
// ---------------------------------------------------------------------------
async function markSeen(req, res) {
  const user = await requireLogin(req, res);
  if (!user) return;

  await pool.execute(
    'UPDATE users SET notifications_last_seen_at = UTC_TIMESTAMP() WHERE id = ?',
    [user.id]
  );
  sendJSON(res, 200, { marked: true });
}

module.exports = { list, unreadCount, markSeen };
