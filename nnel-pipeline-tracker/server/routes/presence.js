'use strict';
/**
 * routes/presence.js — "who's active right now"
 *
 * No new concept beyond a timestamp: the frontend calls the heartbeat
 * endpoint once on load and then every 60s for as long as the app is open
 * (see api.js startPresenceHeartbeat). "Active" means a heartbeat within
 * the last ACTIVE_WINDOW_MS — comfortably more than one missed beat so a
 * backgrounded tab or a brief network hiccup doesn't flicker someone
 * offline.
 *
 * POST /api/presence/heartbeat — record "I'm here" for the calling user
 * GET  /api/presence/active    — everyone currently active, portal-wide
 *
 * (Project-scoped presence lives in routes/projects.js getProjectPresence,
 * since it needs the same canViewProject check every other project read
 * uses.)
 */

const pool = require('../db');
const { requireLogin } = require('../middleware/auth');
const { sendJSON } = require('../utils/response');

const ACTIVE_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

async function heartbeat(req, res) {
  const user = await requireLogin(req, res);
  if (!user) return;

  // App-generated timestamp, not SQL's NOW()/UTC_TIMESTAMP() — this
  // database's clock runs about an hour behind true UTC (see
  // RAILWAY_DEPLOY.md). Reading it back with the same app-generated clock
  // (see getActive/getProjectPresence) keeps the comparison correct
  // regardless of that skew.
  await pool.execute(
    'UPDATE users SET last_active_at = ? WHERE id = ?',
    [new Date(), user.id]
  );
  sendJSON(res, 200, { ok: true });
}

async function getActive(req, res) {
  const user = await requireLogin(req, res);
  if (!user) return;

  const since = new Date(Date.now() - ACTIVE_WINDOW_MS);
  const [rows] = await pool.execute(
    `SELECT id, full_name, system_role
     FROM users
     WHERE is_active = 1 AND last_active_at > ?
     ORDER BY full_name ASC`,
    [since]
  );
  sendJSON(res, 200, rows);
}

module.exports = { heartbeat, getActive, ACTIVE_WINDOW_MS };
