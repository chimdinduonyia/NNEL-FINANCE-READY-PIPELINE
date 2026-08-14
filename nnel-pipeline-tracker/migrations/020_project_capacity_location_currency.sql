-- ==========================================================================
-- 020_project_capacity_location_currency.sql
-- Adds capacity, location, and multi-currency CAPEX support to projects.
--
-- capex_usd remains the canonical always-USD figure used everywhere for
-- gate-routing DOA thresholds (permissions.js getRequiredAuthority) and
-- portfolio KPI aggregation -- nothing that reads capex_usd needs to change.
--
-- capex_currency + capex_amount record what the deal was actually quoted
-- in. For USD-quoted projects these mirror capex_usd. For NGN-quoted
-- projects, capex_amount holds the Naira figure and capex_usd holds an
-- explicit USD-equivalent supplied at entry time (never auto-converted --
-- see server/routes/projects.js) so the $50M threshold check always
-- compares like-for-like, on purpose, with no guessed exchange rate.
-- ==========================================================================

ALTER TABLE projects
  ADD COLUMN capex_currency ENUM('USD','NGN') NOT NULL DEFAULT 'USD' AFTER capex_usd,
  ADD COLUMN capex_amount   DECIMAL(18,2)     NULL     DEFAULT NULL  AFTER capex_currency,
  ADD COLUMN capacity       VARCHAR(100)      NULL     DEFAULT NULL  AFTER capex_amount,
  ADD COLUMN location       VARCHAR(255)      NULL     DEFAULT NULL  AFTER capacity;

-- Backfill: existing projects were always USD; their quoted amount is capex_usd itself.
UPDATE projects SET capex_amount = capex_usd WHERE capex_amount IS NULL;

ALTER TABLE projects MODIFY COLUMN capex_amount DECIMAL(18,2) NOT NULL;

-- No new GRANT statements needed -- these are new columns on the existing
-- `projects` table, which nnel_app already has full SELECT/INSERT/UPDATE/DELETE on.
