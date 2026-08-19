'use strict';
/**
 * routes/events.js
 *
 * GET /api/events?token=<jwt> — opens a live-update stream (SSE)
 *
 * SECURITY NOTE (read this before touching auth here): every other
 * endpoint in this app authenticates via an "Authorization: Bearer <token>"
 * header (see middleware/auth.js). This one can't — browsers' built-in
 * EventSource API (what a page uses to open an SSE stream) has no way to
 * set custom headers, only plain GET requests. The pragmatic, widely-used
 * workaround is to pass the same JWT as a query string parameter instead.
 * Trade-off worth knowing: the token then appears in this one URL (visible
 * in server access logs, browser history, etc.) rather than only in a
 * header. The connection is HTTPS in production (Railway terminates TLS),
 * so it isn't sent in the clear, and it's the same short-lived token
 * (JWT_EXPIRES_IN=8h) already used everywhere else — but it's still a
 * deliberate deviation from the header-only pattern, flagged here on
 * purpose rather than silently done.
 *
 * This endpoint never writes any data, only reads (a token verify + one
 * user lookup) and then keeps the HTTP response open indefinitely,
 * streaming small "something changed" messages pushed via
 * services/events.js. See that file for how broadcasts are targeted.
 */

require('dotenv').config();
const jwt = require('jsonwebtoken');
const pool = require('../db');
const { sendError } = require('../utils/response');
const events = require('../services/events');

const KEEPALIVE_MS = 25000; // keeps idle proxies (Railway's edge, etc.) from silently closing a quiet connection

async function stream(req, res, searchParams) {
  const token = searchParams.get('token');
  if (!token) return sendError(res, 401, 'Authentication required');

  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    return sendError(res, 401, 'Invalid or expired token');
  }

  const [rows] = await pool.execute(
    'SELECT id, system_role, is_active FROM users WHERE id = ?',
    [payload.userId]
  );
  const user = rows[0];
  if (!user || !user.is_active) return sendError(res, 401, 'Account not found or disabled');

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    // Ask any buffering proxy in front of this to pass data straight
    // through instead of holding it until the buffer fills - otherwise
    // "real-time" could sit unsent for a while.
    'X-Accel-Buffering': 'no',
  });
  res.write(': connected\n\n');

  const conn = { res, userId: user.id, systemRole: user.system_role };
  events.addConnection(conn);

  const keepalive = setInterval(() => {
    try { res.write(': ping\n\n'); } catch { /* connection is likely already gone; 'close' will clean it up */ }
  }, KEEPALIVE_MS);

  req.on('close', () => {
    clearInterval(keepalive);
    events.removeConnection(conn);
  });
}

module.exports = { stream };
