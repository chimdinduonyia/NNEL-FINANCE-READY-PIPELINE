-- ==========================================================================
-- 001_initial_schema.sql
-- Run once against your MariaDB database as a privileged (root) user.
-- Then create the restricted app user with the GRANTs at the bottom.
-- ==========================================================================

-- -----------------------------------------------------------------------
-- USERS
-- system_role = 'admin' is the global Process Owner / Admin from the spec.
-- All other project-level roles live in project_members.
-- -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id            INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  email         VARCHAR(255)  NOT NULL,
  full_name     VARCHAR(255)  NOT NULL,
  password_hash VARCHAR(255)  NOT NULL,
  system_role   ENUM('admin','user') NOT NULL DEFAULT 'user',
  is_active     TINYINT(1)    NOT NULL DEFAULT 1,
  created_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP
                              ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------
-- PROJECTS
-- capex_usd: DECIMAL, never FLOAT — the $50M gate-routing threshold
-- must not suffer floating-point drift.
-- current_stage: highest stage the project has been promoted to (0–5).
-- template_version: which FRP template version this project was created
-- under. Allows template changes without breaking in-flight projects.
-- -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS projects (
  id               INT UNSIGNED     NOT NULL AUTO_INCREMENT,
  name             VARCHAR(255)     NOT NULL,
  description      TEXT,
  capex_usd        DECIMAL(15,2)    NOT NULL DEFAULT 0.00,
  current_stage    TINYINT UNSIGNED NOT NULL DEFAULT 0,
  status           ENUM('active','on_hold','completed','cancelled')
                                    NOT NULL DEFAULT 'active',
  template_version VARCHAR(20)      NOT NULL DEFAULT '1.0',
  created_by       INT UNSIGNED     NOT NULL,
  created_at       DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP
                                    ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  CONSTRAINT fk_projects_created_by
    FOREIGN KEY (created_by) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------
-- PROJECT_MEMBERS
-- One row = one user holding one role on one project.
-- A user may hold different roles on different projects, but only one
-- role per project (the UNIQUE key enforces this).
--
-- workstream: set only when role = 'contributor'
--   (which pillar section they are responsible for)
-- approver_authority: set only when role = 'gate_approver'
--   (determines which gate tiers they can sign off on)
-- access_expires_at: set only when role = 'observer'
--   (lender data-room access is time-limited, Stage 3+ only)
-- -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS project_members (
  id                 INT UNSIGNED NOT NULL AUTO_INCREMENT,
  project_id         INT UNSIGNED NOT NULL,
  user_id            INT UNSIGNED NOT NULL,
  role               ENUM('project_lead','contributor','gate_approver',
                          'reviewer','observer') NOT NULL,
  workstream         ENUM('technical','commercial','finance','legal')
                         NULL DEFAULT NULL,
  approver_authority ENUM('ed_cam','md_nnel','slt_mtc',
                          'nnel_board','nnpc_group')
                         NULL DEFAULT NULL,
  access_expires_at  DATETIME NULL DEFAULT NULL,
  created_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_project_members_project_user (project_id, user_id),
  CONSTRAINT fk_pm_project
    FOREIGN KEY (project_id) REFERENCES projects (id),
  CONSTRAINT fk_pm_user
    FOREIGN KEY (user_id) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------
-- PROJECT_STAGES
-- One row per (project × stage number). Tracks the lifecycle state of
-- each stage to enforce the submission lock and segregation of duties.
--
-- capex_at_submission: the CAPEX figure locked at the moment the Project
-- Lead hit "Submit for Gate Review." Gate routing uses THIS value — not
-- the current project CAPEX — so the routing cannot silently change after
-- the approver has already started reviewing.
-- -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS project_stages (
  id                  INT UNSIGNED     NOT NULL AUTO_INCREMENT,
  project_id          INT UNSIGNED     NOT NULL,
  stage_number        TINYINT UNSIGNED NOT NULL,  -- 0–5
  status              ENUM('not_started','in_progress','submitted',
                           'approved','conditional','rejected','reopened')
                           NOT NULL DEFAULT 'not_started',
  submitted_by        INT UNSIGNED     NULL DEFAULT NULL,
  submitted_at        DATETIME         NULL DEFAULT NULL,
  capex_at_submission DECIMAL(15,2)    NULL DEFAULT NULL,
  created_at          DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP
                                       ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_project_stages (project_id, stage_number),
  CONSTRAINT fk_ps_project
    FOREIGN KEY (project_id) REFERENCES projects (id),
  CONSTRAINT fk_ps_submitted_by
    FOREIGN KEY (submitted_by) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------
-- AUDIT_LOG
-- APPEND-ONLY. The app database user must only have INSERT + SELECT here.
-- Never UPDATE or DELETE — see the GRANT section below.
--
-- project_id / stage_number: NULL for system-level events (user created,
-- template updated, etc.) that are not tied to a specific project/stage.
-- action: short machine-readable verb, e.g. 'stage_submitted',
--   'gate_approved', 'stage_reopened', 'user_created'.
-- detail: JSON blob with additional context (what changed, old values,
--   rationale, condition text, etc.). Optional but encouraged.
-- -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_log (
  id           BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
  project_id   INT UNSIGNED     NULL DEFAULT NULL,
  stage_number TINYINT UNSIGNED NULL DEFAULT NULL,
  user_id      INT UNSIGNED     NOT NULL,
  action       VARCHAR(100)     NOT NULL,
  detail       TEXT             NULL DEFAULT NULL,  -- stringified JSON
  created_at   DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  CONSTRAINT fk_al_project
    FOREIGN KEY (project_id) REFERENCES projects (id),
  CONSTRAINT fk_al_user
    FOREIGN KEY (user_id) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ==========================================================================
-- DATABASE USER GRANTS
-- Run these lines as root (or a privileged admin account) after the tables
-- are created. Replace 'nnel_app', 'localhost', and the password with your
-- actual values. Replace 'nnel_frp' with your actual database name.
--
-- SECURITY NOTE: audit_log intentionally omits UPDATE and DELETE.
-- This is the DB-level enforcement of the append-only requirement from
-- the spec. Even if application code has a bug, the database will refuse
-- any attempt to alter or remove audit records.
-- ==========================================================================

-- CREATE USER IF NOT EXISTS 'nnel_app'@'localhost' IDENTIFIED BY 'REPLACE_WITH_STRONG_PASSWORD';
--
-- GRANT SELECT, INSERT, UPDATE, DELETE ON nnel_frp.users           TO 'nnel_app'@'localhost';
-- GRANT SELECT, INSERT, UPDATE, DELETE ON nnel_frp.projects        TO 'nnel_app'@'localhost';
-- GRANT SELECT, INSERT, UPDATE, DELETE ON nnel_frp.project_members TO 'nnel_app'@'localhost';
-- GRANT SELECT, INSERT, UPDATE, DELETE ON nnel_frp.project_stages  TO 'nnel_app'@'localhost';
-- GRANT SELECT, INSERT               ON nnel_frp.audit_log         TO 'nnel_app'@'localhost';
--
-- FLUSH PRIVILEGES;
