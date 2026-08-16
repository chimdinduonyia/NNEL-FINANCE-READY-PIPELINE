'use strict';
/**
 * services/email.js — transactional email via Resend's HTTP API.
 *
 * Resend's API is plain JSON over HTTPS, so this uses Node's built-in
 * `https` module directly rather than adding a dependency for it.
 *
 * SECURITY: RESEND_API_KEY lives in .env only (never in code, never
 * committed). Never log the raw invite token or API key.
 */
require('dotenv').config();
const https = require('https');

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const EMAIL_FROM     = process.env.EMAIL_FROM;
const APP_BASE_URL   = process.env.APP_BASE_URL;

/**
 * Sends one email via Resend.
 *
 * Throws if RESEND_API_KEY isn't configured or Resend rejects the request
 * (bad/unverified domain, invalid recipient, etc.) — callers decide whether
 * a failed send should block whatever action triggered it.
 */
function sendEmail({ to, subject, html }) {
  return new Promise((resolve, reject) => {
    if (!RESEND_API_KEY) {
      return reject(new Error('RESEND_API_KEY is not configured'));
    }
    if (!EMAIL_FROM) {
      return reject(new Error('EMAIL_FROM is not configured'));
    }

    const payload = JSON.stringify({ from: EMAIL_FROM, to: [to], subject, html });

    const req = https.request(
      {
        hostname: 'api.resend.com',
        path: '/emails',
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${RESEND_API_KEY}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(JSON.parse(body || '{}'));
          } else {
            // Resend's error body is safe to surface — it never echoes the API key.
            reject(new Error(`Resend API error (${res.statusCode}): ${body}`));
          }
        });
      }
    );

    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

/**
 * Sends the account-invite email: admin created this person's account, they
 * follow this link to set their own password and activate it. The link
 * carries the RAW token — only the SHA-256 hash of it is ever stored in the
 * database (see routes/users.js and routes/auth.js).
 */
function sendInviteEmail({ to, fullName, token }) {
  const link = `${APP_BASE_URL}/set-password.html?token=${token}`;
  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:0 auto;">
      <div style="background:#1B6B3A;color:#fff;padding:16px 20px;border-radius:8px 8px 0 0;font-weight:bold;font-size:15px;">
        NNEL Finance-Ready Pipeline Tracker
      </div>
      <div style="border:1px solid #E5E7EB;border-top:none;padding:24px 20px;border-radius:0 0 8px 8px;">
        <p>Hi ${escapeHtml(fullName)},</p>
        <p>An administrator has created an account for you on the NNEL Finance-Ready Pipeline Tracker.</p>
        <p>Click below to set your password and activate your account. This link expires in 7 days.</p>
        <p style="text-align:center;margin:28px 0;">
          <a href="${link}" style="background:#1B6B3A;color:#fff;padding:12px 28px;border-radius:5px;text-decoration:none;font-weight:600;display:inline-block;">Set Your Password</a>
        </p>
        <p style="font-size:12px;color:#6B7280;">If the button doesn't work, copy and paste this link into your browser:<br>${link}</p>
        <p style="font-size:12px;color:#6B7280;">If you weren't expecting this, you can safely ignore this email.</p>
      </div>
    </div>`;
  return sendEmail({ to, subject: "You've been invited to the NNEL Pipeline Tracker", html });
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

module.exports = { sendEmail, sendInviteEmail };
