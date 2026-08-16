-- ==========================================================================
-- 022_user_invite_flow.sql
-- Admin-created accounts no longer get a password set by the admin.
-- Instead the account is created with no password at all, an invite email
-- goes out with a one-time link, and the account can't log in until the
-- user follows that link and sets their own password.
--
-- invite_token_hash stores a SHA-256 hash of the raw token, never the raw
-- token itself -- same principle as never storing a plaintext password, so
-- a database compromise doesn't hand out usable invite links directly. The
-- raw token only ever exists in the email itself and in memory server-side
-- for the moment it's generated.
-- ==========================================================================

ALTER TABLE users
  MODIFY COLUMN password_hash VARCHAR(255) NULL,
  ADD COLUMN invite_token_hash CHAR(64)  NULL DEFAULT NULL AFTER password_hash,
  ADD COLUMN invite_expires_at DATETIME  NULL DEFAULT NULL AFTER invite_token_hash;

-- Quick lookup when a token comes in on the accept-invite endpoint.
CREATE INDEX idx_users_invite_token_hash ON users (invite_token_hash);

-- No new GRANT needed -- these are new columns/index on the existing
-- `users` table, which nnel_app already has full SELECT/INSERT/UPDATE/DELETE on.
