'use strict';
/**
 * routes/auth.js — authentication endpoints
 *
 * POST /api/auth/login   — exchange email + password for a JWT
 * POST /api/auth/signup  — self-service account creation
 * GET  /api/auth/me      — return the authenticated user's profile
 */

require('dotenv').config();
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const pool = require('../db');
const { requireLogin } = require('../middleware/auth');
const { sendJSON, sendError } = require('../utils/response');
const { readBody } = require('../utils/bodyParser');
const auditLog = require('../services/auditLog');

const BCRYPT_ROUNDS = 12; // same work factor used everywhere else passwords are hashed

// Self-signup only offers the substantive checklist pillars — 'administrative'
// (M1-M6 decision-makers) and 'external' (lender/observer accounts) are
// assigned by an admin, not chosen by the person signing up.
const SIGNUP_WORKSTREAMS = ['technical', 'commercial', 'finance', 'legal', 'risk', 'esg'];

// Same rule used by both self-signup and invite-acceptance: 12+ chars,
// letter, number, special character. Returns an error message, or null if
// the password is fine.
function passwordStrengthError(password) {
  if (!password || typeof password !== 'string') return 'password is required';
  if (password.length < 12) return 'Password must be at least 12 characters';
  if (!/[A-Za-z]/.test(password)) return 'Password must include at least one letter';
  if (!/[0-9]/.test(password)) return 'Password must include at least one number';
  if (!/[^A-Za-z0-9]/.test(password)) return 'Password must include at least one special character';
  return null;
}

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
  // an email address exists in the system. A pending-invite account has
  // password_hash = NULL (bcrypt.compare would throw on a real null), so
  // that case also falls back to the dummy hash here.
  const dummyHash = '$2b$12$invalidhashusedfortimingnormalization000000000000000000';
  const hashToCompare = (user && user.password_hash) ? user.password_hash : dummyHash;
  const passwordMatch = await bcrypt.compare(password, hashToCompare);

  // Distinct message for "account exists but the invite hasn't been
  // accepted yet" — unlike self-signup, these accounts are admin-
  // provisioned for known people, so confirming that much is helpful
  // rather than an account-enumeration risk.
  if (user && user.password_hash === null) {
    return sendError(res, 403,
      "This account hasn't been activated yet. Check your email for an invite link, or ask an admin to resend it.");
  }

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
 * POST /api/auth/signup
 *
 * Expects JSON body: { full_name, email, password, workstream }
 * Returns: { token, user: { id, email, full_name, system_role } } — same
 * shape as login, so the frontend can sign the new account straight in.
 *
 * SECURITY:
 * - system_role is always 'user' and authority is always 'ss' here — these
 *   are hard-coded, never taken from the request body. A self-signup can
 *   never grant itself admin/project_manager or any gate-approval authority.
 * - A brand-new account has no project_members rows, so it can log in but
 *   sees an empty portfolio until a Project Lead or Admin adds it to a
 *   project (see the Team tab). Account creation itself needs no approval,
 *   but project access always does.
 * - Password rules (12+ chars, letter, number, special character) are
 *   enforced here even though the frontend also checks them — client-side
 *   validation is for the user's convenience, never the security boundary.
 */
async function signup(req, res) {
  let body;
  try {
    body = await readBody(req);
  } catch {
    return sendError(res, 400, 'Invalid request body');
  }

  const { full_name, email, password, workstream } = body;

  if (!full_name || typeof full_name !== 'string' || !full_name.trim()) {
    return sendError(res, 400, 'full_name is required');
  }
  if (!email || typeof email !== 'string' || !email.trim()) {
    return sendError(res, 400, 'email is required');
  }
  const pwError = passwordStrengthError(password);
  if (pwError) return sendError(res, 400, pwError);
  if (!workstream || !SIGNUP_WORKSTREAMS.includes(workstream)) {
    return sendError(res, 400, `workstream must be one of: ${SIGNUP_WORKSTREAMS.join(', ')}`);
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
  let userId;
  try {
    await conn.beginTransaction();
    const [result] = await conn.execute(
      `INSERT INTO users (email, full_name, password_hash, system_role, workstream, authority)
       VALUES (?, ?, ?, 'user', ?, 'ss')`,
      [normalEmail, full_name.trim(), passwordHash, workstream]
    );
    userId = result.insertId;
    await auditLog.log(conn, {
      userId,
      action: 'user_signed_up',
      detail: { email: normalEmail, workstream },
    });
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }

  const token = jwt.sign(
    { userId },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
  );

  sendJSON(res, 201, {
    token,
    user: {
      id: userId,
      email: normalEmail,
      full_name: full_name.trim(),
      system_role: 'user',
    },
  });
}

// ---------------------------------------------------------------------------
// GET /api/auth/invite/:token
// Public — lets the set-password page confirm the token is real before
// showing the form, and greet the invitee by name. A flat 404 either way
// (invalid, expired, or already-used token) so nothing is distinguishable
// to a stranger poking at the URL.
//
// NOTE: expiry is compared against a timestamp generated here in Node
// (an app-supplied `new Date()`), not SQL's NOW()/UTC_TIMESTAMP() — this
// database's clock is known to run about an hour behind true UTC (see
// RAILWAY_DEPLOY.md), while invite_expires_at itself was written using the
// app's own correct clock (mysql2 converts the JS Date client-side, it
// never asks the DB server what time it is). Comparing against the DB's
// clock would silently extend every invite's real validity window by
// however far that skew happens to be.
// ---------------------------------------------------------------------------
async function getInvite(req, res, params) {
  const rawToken = params.token;
  if (!rawToken) return sendError(res, 400, 'Invalid invite link');

  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

  const [[invitee]] = await pool.execute(
    `SELECT full_name, email FROM users
     WHERE invite_token_hash = ? AND invite_expires_at > ? AND password_hash IS NULL`,
    [tokenHash, new Date()]
  );
  if (!invitee) return sendError(res, 404, 'This invite link is invalid or has expired');

  sendJSON(res, 200, { full_name: invitee.full_name, email: invitee.email });
}

// ---------------------------------------------------------------------------
// POST /api/auth/accept-invite
// Public. Body: { token, password }
// Sets the account's own password, clears the invite, and logs them
// straight in (same response shape as login/signup) — no extra step.
// ---------------------------------------------------------------------------
async function acceptInvite(req, res) {
  let body;
  try { body = await readBody(req); } catch { return sendError(res, 400, 'Invalid request body'); }

  const { token, password } = body;
  if (!token || typeof token !== 'string') return sendError(res, 400, 'token is required');

  const pwError = passwordStrengthError(password);
  if (pwError) return sendError(res, 400, pwError);

  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

  const [[invitee]] = await pool.execute(
    `SELECT id, email, full_name, system_role FROM users
     WHERE invite_token_hash = ? AND invite_expires_at > ? AND password_hash IS NULL`,
    [tokenHash, new Date()]
  );
  if (!invitee) return sendError(res, 404, 'This invite link is invalid or has expired');

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute(
      `UPDATE users SET password_hash = ?, invite_token_hash = NULL, invite_expires_at = NULL
       WHERE id = ?`,
      [passwordHash, invitee.id]
    );
    await auditLog.log(conn, {
      userId: invitee.id,
      action: 'user_invite_accepted',
      detail: { email: invitee.email },
    });
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }

  const jwtToken = jwt.sign(
    { userId: invitee.id },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
  );

  sendJSON(res, 200, {
    token: jwtToken,
    user: {
      id: invitee.id,
      email: invitee.email,
      full_name: invitee.full_name,
      system_role: invitee.system_role,
    },
  });
}

/**
 * GET /api/auth/me
 *
 * Returns the currently authenticated user's profile.
 * Used by the frontend to verify a token is still valid and to
 * know the user's role before rendering the UI.
 *
 * is_gate_approver: true if this user holds the gate_approver role on any
 * project (a project-level role, not a system_role) -- the frontend uses
 * this to decide whether to show the "Approval Requests" sidebar link.
 */
async function me(req, res) {
  const user = await requireLogin(req, res);
  if (!user) return; // requireLogin already sent 401

  const [[approverRow]] = await pool.execute(
    `SELECT 1 FROM project_members WHERE user_id = ? AND role = 'gate_approver' LIMIT 1`,
    [user.id]
  );

  sendJSON(res, 200, {
    id: user.id,
    email: user.email,
    full_name: user.full_name,
    system_role: user.system_role,
    is_gate_approver: !!approverRow,
  });
}

module.exports = { login, signup, getInvite, acceptInvite, me, passwordStrengthError };
