-- ==========================================================================
-- 017_extend_workstream_enum.sql
-- Extends the project_members.workstream ENUM to include the workstream
-- values added since the original schema:
--   risk, esg      — added with template pillar support
--   administrative — for M1–M6 decision-maker roles
--   external       — for observer / lender accounts
-- ==========================================================================

ALTER TABLE project_members
  MODIFY COLUMN workstream
    ENUM('technical','commercial','finance','legal','risk','esg','administrative','external')
    NULL DEFAULT NULL;
