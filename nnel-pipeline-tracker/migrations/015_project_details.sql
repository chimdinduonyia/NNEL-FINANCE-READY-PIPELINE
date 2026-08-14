-- ==========================================================================
-- 015_project_details.sql
-- Adds structured narrative fields to the projects table so that
-- objectives, justification, and expected benefits can be recorded
-- at project creation and edited by admin at any time.
-- ==========================================================================

ALTER TABLE projects
  ADD COLUMN objectives    TEXT NULL DEFAULT NULL AFTER description,
  ADD COLUMN justification TEXT NULL DEFAULT NULL AFTER objectives,
  ADD COLUMN benefits      TEXT NULL DEFAULT NULL AFTER justification;
