-- ==========================================================================
-- 021_notifications_last_seen.sql
-- Notifications are derived from audit_log on read -- no new table, no new
-- write paths anywhere in the app. This single column is the only new
-- state: when the user last viewed their notifications, used to compute
-- an unread count. NULL means "never viewed" (everything currently
-- eligible counts as unread).
-- ==========================================================================

ALTER TABLE users
  ADD COLUMN notifications_last_seen_at DATETIME NULL DEFAULT NULL AFTER authority;

-- No new GRANT needed -- this is a column on the existing `users` table,
-- which nnel_app already has full SELECT/INSERT/UPDATE/DELETE on.
