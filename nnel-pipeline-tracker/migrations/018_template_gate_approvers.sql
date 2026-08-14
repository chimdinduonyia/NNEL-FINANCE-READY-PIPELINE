-- ==========================================================================
-- 018_template_gate_approvers.sql
-- Stores the configurable gate-approver chain per stage per template version.
--
-- Stages 2 and 3 are NOT stored here — their routing is governed by the
-- project's CAPEX at submission time and the hardcoded DOA thresholds.
-- All other stages (0, 1, 4, 5) can be configured here; if no rows exist
-- for a given stage the system falls back to the built-in defaults.
--
-- chain_position: 1-indexed order of signing (1 = first to sign).
-- authority:      must be one of the gate-level authority values.
-- ==========================================================================

CREATE TABLE IF NOT EXISTS template_gate_approvers (
  id                  INT UNSIGNED     NOT NULL AUTO_INCREMENT,
  template_version_id INT UNSIGNED     NOT NULL,
  stage_number        TINYINT UNSIGNED NOT NULL,
  chain_position      TINYINT UNSIGNED NOT NULL,
  authority           VARCHAR(20)      NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_gate_chain (template_version_id, stage_number, chain_position),
  CONSTRAINT fk_tga_version
    FOREIGN KEY (template_version_id) REFERENCES template_versions (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- GRANT SELECT, INSERT, UPDATE, DELETE ON nnel_frp.template_gate_approvers TO 'nnel_app'@'localhost';
-- FLUSH PRIVILEGES;
