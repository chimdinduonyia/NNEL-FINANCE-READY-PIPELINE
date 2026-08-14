-- ==========================================================================
-- 002_working_data.sql
-- Run after 001_initial_schema.sql.
-- Adds the template model, working-data checklist, and document register.
-- ==========================================================================

-- -----------------------------------------------------------------------
-- TEMPLATE_VERSIONS
-- Admin manages template versions centrally. Projects inherit a fixed
-- version at creation so an in-progress project is never affected by
-- template changes.
-- -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS template_versions (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  version     VARCHAR(20)  NOT NULL,
  description TEXT,
  is_active   TINYINT(1)   NOT NULL DEFAULT 1,
  created_by  INT UNSIGNED NOT NULL,
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_template_version (version),
  CONSTRAINT fk_tv_created_by
    FOREIGN KEY (created_by) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------
-- TEMPLATE_CHECKLIST_ITEMS
-- One row per checklist item in a given template version, for a given
-- stage and pillar. These rows are read-only to project team members;
-- only admin can create or update them.
--
-- pillar: the six FRP assessment dimensions. The first four ('technical',
-- 'commercial', 'finance', 'legal') map to workstream contributor roles.
-- 'environmental' and 'risk' are assessed by the Project Lead or reviewers.
--
-- item_code: human-readable reference, e.g. 'S2-F-01' (Stage 2, Finance,
-- item 01). Allows unambiguous cross-referencing in audit records.
-- -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS template_checklist_items (
  id                  INT UNSIGNED     NOT NULL AUTO_INCREMENT,
  template_version_id INT UNSIGNED     NOT NULL,
  stage_number        TINYINT UNSIGNED NOT NULL,
  pillar              ENUM('technical','commercial','finance','legal',
                           'environmental','risk') NOT NULL,
  item_code           VARCHAR(20)      NOT NULL,
  description         TEXT             NOT NULL,
  guidance            TEXT,
  is_mandatory        TINYINT(1)       NOT NULL DEFAULT 1,
  sort_order          SMALLINT         NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uq_checklist_item_code (template_version_id, item_code),
  CONSTRAINT fk_tci_version
    FOREIGN KEY (template_version_id) REFERENCES template_versions (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------
-- TEMPLATE_VDR_FOLDERS
-- Defines the Virtual Data Room folder structure (00–09) for a template
-- version. Each document in the register is tagged to one of these folders.
-- -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS template_vdr_folders (
  id                  INT UNSIGNED NOT NULL AUTO_INCREMENT,
  template_version_id INT UNSIGNED NOT NULL,
  folder_code         VARCHAR(5)   NOT NULL,
  name                VARCHAR(100) NOT NULL,
  description         TEXT,
  sort_order          SMALLINT     NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uq_vdr_folder (template_version_id, folder_code),
  CONSTRAINT fk_vdr_version
    FOREIGN KEY (template_version_id) REFERENCES template_versions (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------
-- STAGE_CHECKLIST
-- Per-project state for each template checklist item.
-- Rows are created when a stage becomes 'in_progress' (Stage 0 is
-- initialised on project creation; later stages on gate approval).
--
-- evidence_note: free-text reference provided by the team member when
-- ticking an item — a document title, link, or brief description.
-- -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS stage_checklist (
  id                INT UNSIGNED     NOT NULL AUTO_INCREMENT,
  project_id        INT UNSIGNED     NOT NULL,
  stage_number      TINYINT UNSIGNED NOT NULL,
  checklist_item_id INT UNSIGNED     NOT NULL,
  is_complete       TINYINT(1)       NOT NULL DEFAULT 0,
  evidence_note     TEXT,
  completed_by      INT UNSIGNED     NULL DEFAULT NULL,
  completed_at      DATETIME         NULL DEFAULT NULL,
  updated_at        DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP
                                     ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_stage_checklist (project_id, stage_number, checklist_item_id),
  CONSTRAINT fk_sc_project
    FOREIGN KEY (project_id) REFERENCES projects (id),
  CONSTRAINT fk_sc_item
    FOREIGN KEY (checklist_item_id) REFERENCES template_checklist_items (id),
  CONSTRAINT fk_sc_completed_by
    FOREIGN KEY (completed_by) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------
-- DOCUMENT_REGISTER
-- Single evidence and deliverables register per project.
-- Each entry is tagged to a VDR folder and carries a status so the
-- project team and approvers can see at a glance what is outstanding.
--
-- file_ref: not a stored file (no file upload in this version); records
-- a filename, SharePoint/Drive path, or external reference identifier.
-- -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS document_register (
  id            INT UNSIGNED     NOT NULL AUTO_INCREMENT,
  project_id    INT UNSIGNED     NOT NULL,
  stage_number  TINYINT UNSIGNED NULL DEFAULT NULL,
  title         VARCHAR(255)     NOT NULL,
  vdr_folder_id INT UNSIGNED     NOT NULL,
  status        ENUM('outstanding','draft','submitted','approved','superseded')
                NOT NULL DEFAULT 'outstanding',
  file_ref      VARCHAR(500)     NULL DEFAULT NULL,
  notes         TEXT,
  uploaded_by   INT UNSIGNED     NOT NULL,
  uploaded_at   DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by    INT UNSIGNED     NULL DEFAULT NULL,
  updated_at    DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP
                                 ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  CONSTRAINT fk_dr_project
    FOREIGN KEY (project_id) REFERENCES projects (id),
  CONSTRAINT fk_dr_vdr_folder
    FOREIGN KEY (vdr_folder_id) REFERENCES template_vdr_folders (id),
  CONSTRAINT fk_dr_uploaded_by
    FOREIGN KEY (uploaded_by) REFERENCES users (id),
  CONSTRAINT fk_dr_updated_by
    FOREIGN KEY (updated_by) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ==========================================================================
-- ADDITIONAL GRANTS (run as root / privileged user)
-- Grant the app user access to the new tables.
-- Replace 'nnel_app'@'localhost' and 'nnel_frp' with your actual values.
-- ==========================================================================

-- GRANT SELECT, INSERT, UPDATE, DELETE ON nnel_frp.template_versions       TO 'nnel_app'@'localhost';
-- GRANT SELECT, INSERT, UPDATE, DELETE ON nnel_frp.template_checklist_items TO 'nnel_app'@'localhost';
-- GRANT SELECT, INSERT, UPDATE, DELETE ON nnel_frp.template_vdr_folders     TO 'nnel_app'@'localhost';
-- GRANT SELECT, INSERT, UPDATE, DELETE ON nnel_frp.stage_checklist          TO 'nnel_app'@'localhost';
-- GRANT SELECT, INSERT, UPDATE, DELETE ON nnel_frp.document_register        TO 'nnel_app'@'localhost';
-- FLUSH PRIVILEGES;
