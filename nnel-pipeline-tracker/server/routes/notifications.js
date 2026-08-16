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
 * A notification is either:
 *   1. A curated set of "worth knowing about" events on a project this
 *      user is a member of (gate decisions, stage submissions/reopens,
 *      team changes, conditions closed, document approvals, project
 *      detail edits) -- deliberately excludes high-frequency, low-signal
 *      events like individual checklist ticks.
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

// Project-scoped events worth surfacing as a notification. Deliberately
// excludes checklist_item_updated / evidence_note_edited / document_created /
// document_updated / document_deleted / raci_cell_updated -- too frequent to
// be useful as notifications, they're still fully visible in the project's
// own Audit tab.
const PROJECT_ACTIONS = [
  'gate_decision_recorded', 'stage_submitted', 'stage_reopened', 'submission_recalled',
  'member_assigned', 'member_removed', 'condition_closed', 'gate_conditions_resolved',
  'project_updated', 'document_status_updated',
];

// Admin actions on the *viewing user's own* account.
const ACCOUNT_ACTIONS = ['user_updated', 'user_status_changed', 'user_password_reset'];

const NOTIFY_QUERY = `
  SELECT al.id, al.project_id, al.stage_number, al.action, al.detail, al.created_at,
         al.user_id AS actor_id, u.full_name AS actor_name,
         p.name AS project_name
  FROM audit_log al
  JOIN users u ON u.id = al.user_id
  LEFT JOIN projects p ON p.id = al.project_id
  WHERE al.user_id != ?
    AND (
      (al.project_id IN (SELECT project_id FROM project_members WHERE user_id = ?)
       AND al.action IN (${PROJECT_ACTIONS.map(() => '?').join(',')}))
      OR
      (al.action IN (${ACCOUNT_ACTIONS.map(() => '?').join(',')})
       AND CAST(al.detail ->> '$.target_user_id' AS UNSIGNED) = ?)
    )
  ORDER BY al.created_at DESC
  LIMIT 50
`;

function queryParams(userId) {
  return [userId, userId, ...PROJECT_ACTIONS, ...ACCOUNT_ACTIONS, userId];
}

// ---------------------------------------------------------------------------
// GET /api/notifications
// ---------------------------------------------------------------------------
async function list(req, res) {
  const user = await requireLogin(req, res);
  if (!user) return;

  const [rows] = await pool.execute(NOTIFY_QUERY, queryParams(user.id));

  const [[{ last_seen }]] = await pool.execute(
    'SELECT notifications_last_seen_at AS last_seen FROM users WHERE id = ?',
    [user.id]
  );

  sendJSON(res, 200, {
    last_seen_at: last_seen,
    items: rows.map(r => ({
      ...r,
      detail: r.detail ? JSON.parse(r.detail) : null,
    })),
  });
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

  const countQuery = `
    SELECT COUNT(*) AS c FROM (${NOTIFY_QUERY}) AS eligible
    WHERE ? IS NULL OR eligible.created_at > ?
  `;
  const [[{ c }]] = await pool.execute(
    countQuery,
    [...queryParams(user.id), last_seen, last_seen]
  );

  sendJSON(res, 200, { count: c });
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
