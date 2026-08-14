-- ==========================================================================
-- 014_stage_submission_summary.sql
-- Adds a free-text summary field to project_stages so the Project Lead can
-- record key outputs and decisions when submitting a stage for gate review.
-- This summary is displayed in the gate history and feeds into the memo.
-- ==========================================================================

ALTER TABLE project_stages
  ADD COLUMN submission_summary TEXT NULL DEFAULT NULL
  AFTER capex_at_submission;
