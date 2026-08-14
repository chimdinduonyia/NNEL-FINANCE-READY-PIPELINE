-- ==========================================================================
-- 005_project_technology.sql
-- Run after 004_review_rounds.sql.
-- Adds technology type and at-risk flag to the projects table to support
-- the portfolio-tier filters defined in the spec §4.
-- ==========================================================================

-- Technology type used for the portfolio "technology" filter.
-- Free text rather than an enum so it can hold any clean-energy technology
-- without requiring a migration when a new type is added.
ALTER TABLE projects
  ADD COLUMN technology VARCHAR(100) NULL DEFAULT NULL
  AFTER description;

-- Manual at-risk flag toggled by the Project Lead or Admin.
-- The portfolio view also auto-derives a soft "awaiting" state from
-- project_stages.status, but this flag captures judgment calls.
ALTER TABLE projects
  ADD COLUMN is_at_risk TINYINT(1) NOT NULL DEFAULT 0
  AFTER status;

-- Index to speed up the portfolio filter query.
ALTER TABLE projects
  ADD INDEX idx_projects_current_stage (current_stage),
  ADD INDEX idx_projects_technology (technology);
