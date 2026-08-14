'use strict';
/**
 * auth.js — JWT verification middleware
 *
 * SECURITY: This is the authentication boundary. Every route that touches
 * sensitive data must call requireLogin() first. If it returns null, the
 * route must immediately return — do not proceed.
 *
 * Flow:
 *   1. Read the "Authorization: Bearer <token>" header.
 *   2. Verify the token's signature and expiry using JWT_SECRET.
 *      (jsonwebtoken throws if the token is tampered with or expired.)
 *   3. Load the user record from the database to confirm the account
 *      still exists and is active. This catches deactivated accounts
 *      even if their token hasn't expired yet.
 *   4. Return the user object, or send 401 and return null.
 */

require('dotenv').config();
const jwt = require('jsonwebtoken');
const pool = require('../db');
const { sendError } = require('../utils/response');

/**
 * Verifies the request's JWT and returns the authenticated user object,
 * or sends a 401 response and returns null if authentication fails.
 *
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 * @returns {Promise<object|null>}
 */
async function requireLogin(req, res) {
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;

  if (!token) {
    sendError(res, 401, 'Authentication required');
    return null;
  }

  // Verify signature and expiry. jwt.verify() throws on any failure.
  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    sendError(res, 401, 'Invalid or expired token');
    return null;
  }

  // Re-check the database so deactivated accounts are rejected immediately,
  // even if they still hold a valid token.
  const [rows] = await pool.execute(
    'SELECT id, email, full_name, system_role, is_active FROM users WHERE id = ?',
    [payload.userId]
  );

  const user = rows[0];
  if (!user || !user.is_active) {
    sendError(res, 401, 'Account not found or disabled');
    return null;
  }

  return user;
}

module.exports = { requireLogin };
