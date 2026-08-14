-- ==========================================================================
-- 016_user_authority_workstream.sql
-- 1. Adds organisational authority and workstream to user profiles.
-- 2. Renames gate-approver authority ENUM values to the new naming:
--      ed_cam    → m4_ed_cam   (M4 — ED-CAM)
--      md_nnel   → m3_md_nnel  (M3 — MD-NNEL)
--      nnpc_group→ m1_nnpc     (M1 — NNPC Group)
--    nnel_board and slt_mtc are unchanged.
--    m2_evp (M2 — EVP) is a NEW authority level with no old code to migrate.
-- 3. Migrates existing data in project_members and gate_decisions.
-- 4. Adds member_authority to project_members for display + per-project override.
-- ==========================================================================

-- ---- 1. User profile additions ------------------------------------------

ALTER TABLE users
  ADD COLUMN workstream VARCHAR(50)  NULL DEFAULT NULL      AFTER email,
  ADD COLUMN authority  VARCHAR(20)  NOT NULL DEFAULT 'ss'  AFTER workstream;

UPDATE users SET authority = 'ss' WHERE authority = 'ss' OR authority IS NULL;


-- ---- 2. Expand ENUMs to hold both old and new values (transition) --------

ALTER TABLE project_members
  MODIFY COLUMN approver_authority
    ENUM('ed_cam','md_nnel','slt_mtc','nnel_board','nnpc_group',
         'm1_nnpc','m2_evp','m3_md_nnel','m4_ed_cam')
    NULL DEFAULT NULL;

ALTER TABLE gate_decisions
  MODIFY COLUMN authority
    ENUM('ed_cam','md_nnel','slt_mtc','nnel_board','nnpc_group',
         'm1_nnpc','m2_evp','m3_md_nnel','m4_ed_cam')
    NULL DEFAULT NULL;


-- ---- 3. Migrate existing data -------------------------------------------

UPDATE project_members SET approver_authority = 'm4_ed_cam'  WHERE approver_authority = 'ed_cam';
UPDATE project_members SET approver_authority = 'm3_md_nnel'  WHERE approver_authority = 'md_nnel';
UPDATE project_members SET approver_authority = 'm1_nnpc'     WHERE approver_authority = 'nnpc_group';

UPDATE gate_decisions SET authority = 'm4_ed_cam'  WHERE authority = 'ed_cam';
UPDATE gate_decisions SET authority = 'm3_md_nnel'  WHERE authority = 'md_nnel';
UPDATE gate_decisions SET authority = 'm1_nnpc'     WHERE authority = 'nnpc_group';


-- ---- 4. Remove old ENUM values ------------------------------------------

ALTER TABLE project_members
  MODIFY COLUMN approver_authority
    ENUM('m1_nnpc','m2_evp','nnel_board','m3_md_nnel','slt_mtc','m4_ed_cam')
    NULL DEFAULT NULL;

ALTER TABLE gate_decisions
  MODIFY COLUMN authority
    ENUM('m1_nnpc','m2_evp','nnel_board','m3_md_nnel','slt_mtc','m4_ed_cam')
    NULL DEFAULT NULL;


-- ---- 5. Per-project member authority ------------------------------------

ALTER TABLE project_members
  ADD COLUMN member_authority VARCHAR(20) NULL DEFAULT NULL
  AFTER access_expires_at;

UPDATE project_members
  SET member_authority = approver_authority
  WHERE approver_authority IS NOT NULL;
