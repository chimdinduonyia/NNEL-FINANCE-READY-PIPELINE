'use strict';
/**
 * routes/auth.js — authentication endpoints
 *
 * POST /api/auth/login   — exchange email + password for a JWT
 * GET  /api/auth/me      — return the authenticated user's profile
 */

require('dotenv').config();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const pool = require('../db');
const { requireLogin } = require('../middleware/auth');
const { sendJSON, sendError } = require('../utils/response');
const { readBody } = require('../utils/bodyParser');
const auditLog = require('../services/auditLog');

/**
 * POST /api/auth/login
 *
 * Expects JSON body: { email, password }
 * Returns: { token, user: { id, email, full_name, system_role } }
 *
 * SECURITY: We use bcrypt.compare(), which is timing-safe.
 * We always run the compare even for unknown emails to avoid leaking
 * whether an account exists via a timing difference.
 */
async function login(req, res) {
  let body;
  try {
    body = await readBody(req);
  } catch {
    return sendError(res, 400, 'Invalid request body');
  }

  const { email, password } = body;

  if (!email || typeof email !== 'string' ||
      !password || typeof password !== 'string') {
    return sendError(res, 400, 'email and password are required');
  }

  // Look up the user by email. Parameterised — no SQL injection possible.
  const [rows] = await pool.execute(
    'SELECT id, email, full_name, system_role, password_hash, is_active FROM users WHERE email = ?',
    [email.trim().toLowerCase()]
  );

  const user = rows[0];

  // Always run bcrypt.compare to prevent timing attacks that reveal whether
  // an email address exists in the system.
  const dummyHash = '$2b$12$invalidhashusedfortimingnormalization000000000000000000';
  const hashToCompare = user ? user.password_hash : dummyHash;
  const passwordMatch = await bcrypt.compare(password, hashToCompare);

  if (!user || !passwordMatch || !user.is_active) {
    return sendError(res, 401, 'Invalid email or password');
  }

  const token = jwt.sign(
    { userId: user.id },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
  );

  // Audit: record the login event
  await auditLog.log(pool, {
    userId: user.id,
    action: 'user_login',
    detail: { ip: req.socket.remoteAddress },
  });

  sendJSON(res, 200, {
    token,
    user: {
      id: user.id,
      email: user.email,
      full_name: user.full_name,
      system_role: user.system_role,
    },
  });
}

/**
 * GET /api/auth/me
 *
 * Returns the currently authenticated user's profile.
 * Used by the frontend to verify a token is still valid and to
 * know the user's role before rendering the UI.
 */
async function me(req, res) {
  const user = await requireLogin(req, res);
  if (!user) return; // requireLogin already sent 401

  sendJSON(res, 200, {
    id: user.id,
    email: user.email,
    full_name: user.full_name,
    system_role: user.system_role,
  });
}

module.exports = { login, me };
