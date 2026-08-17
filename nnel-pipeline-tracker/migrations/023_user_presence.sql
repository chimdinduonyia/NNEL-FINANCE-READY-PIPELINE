-- ==========================================================================
-- 023_user_presence.sql
-- Powers the "who's active now" avatar stack on the dashboard and on each
-- project. The frontend pings a heartbeat endpoint every 60s while the app
-- is open; "active" means a heartbeat in roughly the last 5 minutes.
-- ==========================================================================

ALTER TABLE users
  ADD COLUMN last_active_at DATETIME NULL DEFAULT NULL AFTER notifications_last_seen_at;

-- No new GRANT needed -- new column on the existing `users` table, which
-- nnel_app already has full SELECT/INSERT/UPDATE/DELETE on.
