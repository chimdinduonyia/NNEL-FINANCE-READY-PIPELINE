-- ==========================================================================
-- 004_review_rounds.sql
-- Run after 003_gate_decisions.sql.
--
-- Adds review_round tracking to support the re-open change-control flow.
-- When a stage is re-opened, its review_round increments. Gate decisions
-- in previous rounds remain immutable in the table but are no longer
-- counted toward the current approval chain — ensuring a re-opened stage
-- starts a clean new round of review without destroying the history.
-- ==========================================================================

-- Add review_round to project_stages.
-- DEFAULT 1: all existing rows are treated as round 1.
ALTER TABLE project_stages
  ADD COLUMN review_round TINYINT UNSIGNED NOT NULL DEFAULT 1
  AFTER capex_at_submission;

-- Add review_round to gate_decisions.
-- DEFAULT 1: all decisions already recorded belong to round 1.
ALTER TABLE gate_decisions
  ADD COLUMN review_round TINYINT UNSIGNED NOT NULL DEFAULT 1
  AFTER chain_position;

-- Index used by canApproveGate and recordDecision to count decisions
-- for the current round quickly.
ALTER TABLE gate_decisions
  ADD INDEX idx_gd_project_stage_round (project_id, stage_number, review_round);
