'use strict';
/**
 * routes/users.js — User Management (admin only)
 *
 * GET    /api/users              — list all users
 * POST   /api/users              — create user
 * PATCH  /api/users/:id          — update name, email, system_role
 * PATCH  /api/users/:id/password — reset password
 * PATCH  /api/users/:id/status   — activate / deactivate
 *
 * SECURITY: every handler re-checks system_role === 'admin' server-side.
 * Passwords are never returned or logged. Every action writes to audit_log.
 */

const bcrypt   = require('bcrypt');
const pool     = require('../db');
const { requireLogin } = require('../middleware/auth');
const { sendJSON, sendError } = require('../utils/response');
const { readBody }            = require('../utils/bodyParser');
const auditLog = require('../services/auditLog');

const BCRYPT_ROUNDS = 12;

// ---------------------------------------------------------------------------
// GET /api/users
// Returns all users ordered by creation date. Password hashes are never
// included in any response from this file.
// ---------------------------------------------------------------------------
async function list(req, res) {
  const user = await requireLogin(req, res);
  if (!user) return;

  // Admins see the full user list (all fields, including inactive users).
  // Project managers need the list to add team members — they get a trimmed
  // view: active users only, no sensitive admin-only columns.
  if (!['admin', 'project_manager'].includes(user.system_role)) {
    return sendError(res, 403, 'Forbidden');
  }

  if (user.system_role === 'project_manager') {
    const [rows] = await pool.execute(
      `SELECT id, email, full_name, system_role, is_active
       FROM users
       WHERE is_active = 1
       ORDER BY full_name ASC`
    );
    return sendJSON(res, 200, rows);
  }

  const [rows] = await pool.execute(
    `SELECT id, email, full_name, system_role, is_active, workstream, authority, created_at, updated_at
     FROM users
     ORDER BY created_at ASC`
  );
  sendJSON(res, 200, rows);
}

// ---------------------------------------------------------------------------
// POST /api/users
// Creates a new user account. Hashes the password before storing.
// Returns 409 if the email is already taken.
// ---------------------------------------------------------------------------
async function create(req, res) {
  const user = await requireLogin(req, res);
  if (!user) return;
  if (user.system_role !== 'admin') return sendError(res, 403, 'Forbidden');

  let body;
  try { body = await readBody(req); } catch { return sendError(res, 400, 'Invalid JSON'); }

  const { full_name, email, password, system_role, workstream, authority } = body;

  if (!full_name || typeof full_name !== 'string' || !full_name.trim()) {
    return sendError(res, 400, 'full_name is required');
  }
  if (!email || typeof email !== 'string' || !email.trim()) {
    return sendError(res, 400, 'email is required');
  }
  if (!password || typeof password !== 'string') {
    return sendError(res, 400, 'password is required');
  }
  if (password.length < 12) {
    return sendError(res, 400, 'Password must be at least 12 characters');
  }
  if (!['admin', 'project_manager', 'user'].includes(system_role)) {
    return sendError(res, 400, 'system_role must be "admin", "project_manager", or "user"');
  }

  const normalEmail = email.trim().toLowerCase();

  // SECURITY: check uniqueness before hashing (bcrypt is intentionally slow)
  const [[existing]] = await pool.execute(
    'SELECT id FROM users WHERE email = ?',
    [normalEmail]
  );
  if (existing) return sendError(res, 409, 'A user with this email address already exists');

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [result] = await conn.execute(
      `INSERT INTO users (email, full_name, password_hash, system_role, workstream, authority)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [normalEmail, full_name.trim(), passwordHash, system_role,
       workstream || null, authority || 'ss']
    );
    await auditLog.log(conn, {
      userId: user.id,
      action: 'user_created',
      detail: { new_user_id: result.insertId, email: normalEmail, system_role },
    });
    await conn.commit();
    sendJSON(res, 201, {
      id: result.insertId,
      email: normalEmail,
      full_name: full_name.trim(),
      system_role,
    });
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

// ---------------------------------------------------------------------------
// PATCH /api/users/:id
// Updates name, email, and/or system_role. Returns 409 on duplicate email.
// ---------------------------------------------------------------------------
async function update(req, res, params) {
  const user = await requireLogin(req, res);
  if (!user) return;
  if (user.system_role !== 'admin') return sendError(res, 403, 'Forbidden');

  const targetId = parseInt(params.id, 10);
  if (!targetId) return sendError(res, 400, 'Invalid user id');

  let body;
  try { body = await readBody(req); } catch { return sendError(res, 400, 'Invalid JSON'); }

  if (body.system_role !== undefined && !['admin', 'user'].includes(body.system_role)) {
    return sendError(res, 400, 'system_role must be "admin", "project_manager", or "user"');
  }

  const setClauses = [];
  const values     = [];

  if (body.full_name !== undefined) {
    setClauses.push('full_name = ?');
    values.push(body.full_name.toString().trim());
  }
  if (body.email !== undefined) {
    const normalEmail = body.email.toString().trim().toLowerCase();
    const [[dup]] = await pool.execute(
      'SELECT id FROM users WHERE email = ? AND id != ?',
      [normalEmail, targetId]
    );
    if (dup) return sendError(res, 409, 'A user with this email address already exists');
    setClauses.push('email = ?');
    values.push(normalEmail);
  }
  if (body.system_role !== undefined) {
    setClauses.push('system_role = ?');
    values.push(body.system_role);
  }
  if (body.workstream !== undefined) {
    setClauses.push('workstream = ?');
    values.push(body.workstream || null);
  }
  if (body.authority !== undefined) {
    setClauses.push('authority = ?');
    values.push(body.authority || 'ss');
  }

  if (setClauses.length === 0) return sendError(res, 400, 'No updatable fields provided');

  values.push(targetId);
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [result] = await conn.execute(
      `UPDATE users SET ${setClauses.join(', ')} WHERE id = ?`,
      values
    );
    if (result.affectedRows === 0) {
      await conn.rollback();
      return sendError(res, 404, 'User not found');
    }
    await auditLog.log(conn, {
      userId: user.id,
      action: 'user_updated',
      detail: { target_user_id: targetId, fields: Object.keys(body) },
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
// PATCH /api/users/:id/password
// Resets a user's password. Only the new hash is stored — the new password
// is never logged anywhere.
// ---------------------------------------------------------------------------
async function resetPassword(req, res, params) {
  const user = await requireLogin(req, res);
  if (!user) return;
  if (user.system_role !== 'admin') return sendError(res, 403, 'Forbidden');

  const targetId = parseInt(params.id, 10);
  if (!targetId) return sendError(res, 400, 'Invalid user id');

  let body;
  try { body = await readBody(req); } catch { return sendError(res, 400, 'Invalid JSON'); }

  const { new_password } = body;
  if (!new_password || typeof new_password !== 'string' || new_password.length < 12) {
    return sendError(res, 400, 'new_password must be at least 12 characters');
  }

  const passwordHash = await bcrypt.hash(new_password, BCRYPT_ROUNDS);
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [result] = await conn.execute(
      'UPDATE users SET password_hash = ? WHERE id = ?',
      [passwordHash, targetId]
    );
    if (result.affectedRows === 0) {
      await conn.rollback();
      return sendError(res, 404, 'User not found');
    }
    // SECURITY: do not log the password or hash — record only that a reset occurred
    await auditLog.log(conn, {
      userId: user.id,
      action: 'user_password_reset',
      detail: { target_user_id: targetId },
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
// PATCH /api/users/:id/status
// Sets is_active to true or false. Rows are never deleted — deactivation
// prevents login while preserving audit history. Admins cannot deactivate
// their own account to prevent lockout.
// ---------------------------------------------------------------------------
async function setStatus(req, res, params) {
  const user = await requireLogin(req, res);
  if (!user) return;
  if (user.system_role !== 'admin') return sendError(res, 403, 'Forbidden');

  const targetId = parseInt(params.id, 10);
  if (!targetId) return sendError(res, 400, 'Invalid user id');

  if (targetId === user.id) {
    return sendError(res, 409, 'You cannot change the status of your own account');
  }

  let body;
  try { body = await readBody(req); } catch { return sendError(res, 400, 'Invalid JSON'); }

  if (typeof body.is_active !== 'boolean') {
    return sendError(res, 400, 'is_active (boolean) is required');
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [result] = await conn.execute(
      'UPDATE users SET is_active = ? WHERE id = ?',
      [body.is_active ? 1 : 0, targetId]
    );
    if (result.affectedRows === 0) {
      await conn.rollback();
      return sendError(res, 404, 'User not found');
    }
    await auditLog.log(conn, {
      userId: user.id,
      action: 'user_status_changed',
      detail: { target_user_id: targetId, is_active: body.is_active },
    });
    await conn.commit();
    sendJSON(res, 200, { updated: true, is_active: body.is_active });
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

module.exports = { list, create, update, resetPassword, setStatus };
