'use strict';
/**
 * events.js — in-process pub/sub for live page updates (Server-Sent Events)
 *
 * WHAT THIS IS FOR
 * Today, if two people have the same project open on different machines,
 * neither one sees the other's changes (a checklist tick, a gate decision,
 * a new team member) until they manually reload the page. This module lets
 * the server PUSH a tiny "something changed" signal to every browser tab
 * that has the relevant project open, so the page can quietly re-fetch and
 * re-render itself — no reload needed.
 *
 * HOW IT WORKS (plain-language)
 * A browser opens one long-lived HTTP connection to GET /api/events and
 * just keeps it open (this is what "Server-Sent Events" means — one-way,
 * server-to-browser). We keep a list of every open connection in memory,
 * tagged with who's on the other end. Whenever a route finishes a
 * state-changing write (after its transaction commits, so we never tell
 * anyone about a change that might still get rolled back), it calls
 * broadcastProjectChange() here. We loop over every open connection, check
 * whether that person is actually allowed to see the project the change
 * happened on (same canViewProject() check every other read endpoint uses —
 * this is NOT a public broadcast), and if so write a small message down
 * their open connection. The browser's native EventSource API turns that
 * into a JS event with no extra client library needed.
 *
 * WHY IN-MEMORY IS FINE HERE
 * This only works because the whole app is ONE Node process (see CLAUDE.md
 * "One deployable app") — there's no second server instance that could be
 * holding a different, out-of-sync connection list. If this app is ever
 * split across multiple instances, this module would need to move to a
 * shared pub/sub (e.g. Redis) instead — noting that clearly here so it
 * isn't missed later.
 *
 * FAILURE SAFETY
 * A broadcast is best-effort background work that happens AFTER the API
 * request it's attached to has already succeeded and committed. Nothing in
 * here is allowed to throw back into the route that triggered it — a dead
 * connection or a permission-check hiccup just gets skipped, never breaks
 * the actual HTTP response the user is waiting on.
 */

const { canViewProject } = require('../middleware/permissions');

// Each entry: { res, userId, systemRole }
const connections = new Set();

function addConnection(conn) {
  connections.add(conn);
}

function removeConnection(conn) {
  connections.delete(conn);
}

// ---------------------------------------------------------------------------
// Called by route handlers right after a state-changing transaction commits.
// action/stageNumber are optional extra context carried in the pushed
// message — the current frontend doesn't branch on them (it just triggers a
// full silent re-fetch of whatever's on screen), but they're cheap to
// include now and useful for debugging / future finer-grained handling.
// ---------------------------------------------------------------------------
// Callers deliberately do NOT await this (it runs after their own response
// has already been sent) - so the entire body is wrapped defensively.
// Nothing in here may ever surface as an unhandled rejection or throw back
// into the route that triggered it.
async function broadcastProjectChange(projectId, { action, stageNumber } = {}) {
  try {
    if (!projectId || connections.size === 0) return;

    const payload = JSON.stringify({
      project_id: projectId,
      stage_number: stageNumber ?? null,
      action: action ?? null,
      at: new Date().toISOString(),
    });

    for (const conn of connections) {
      try {
        const allowed = await canViewProject(conn.userId, conn.systemRole, projectId);
        if (!allowed) continue;
        conn.res.write(`data: ${payload}\n\n`);
      } catch {
        // A dead/broken connection shouldn't stop delivery to everyone else -
        // it gets cleaned up independently by its own 'close' listener.
      }
    }
  } catch (err) {
    console.error('broadcastProjectChange failed (non-fatal):', err);
  }
}

module.exports = { addConnection, removeConnection, broadcastProjectChange };
