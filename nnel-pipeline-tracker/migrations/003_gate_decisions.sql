-- ==========================================================================
-- 003_gate_decisions.sql
-- Run after 002_working_data.sql and 002_seed_template_v1.sql.
-- Adds the append-only gate decision record and the conditions tracking table.
-- ==========================================================================

-- -----------------------------------------------------------------------
-- GATE_DECISIONS
-- Append-only. Every GO / Conditional / NO-GO recorded here — never
-- edited, never deleted. Amending a decision requires re-opening the
-- stage via the change-control flow (Step 4), which itself writes a
-- new audit_log row rather than modifying this one.
--
-- chain_position: 1-indexed position of this decision in the approval
-- chain for this stage. For single-approver gates this is always 1.
-- For Gate 1 (ED-CAM → MD-NNEL) and Gate 3 >$50M (NNEL Board →
-- NNPC Group) this tracks which link in the chain signed.
--
-- authority: mirrors the approver_authority value from project_members,
-- copied here at signing time so the record is self-contained even if
-- the member's authority is later changed.
-- -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS gate_decisions (
  id             INT UNSIGNED     NOT NULL AUTO_INCREMENT,
  project_id     INT UNSIGNED     NOT NULL,
  stage_number   TINYINT UNSIGNED NOT NULL,
  decided_by     INT UNSIGNED     NOT NULL,
  authority      ENUM('ed_cam','md_nnel','slt_mtc','nnel_board','nnpc_group') NOT NULL,
  decision       ENUM('go','conditional','no_go') NOT NULL,
  rationale      TEXT             NOT NULL,
  chain_position TINYINT UNSIGNED NOT NULL DEFAULT 1,
  created_at     DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  CONSTRAINT fk_gd_project
    FOREIGN KEY (project_id) REFERENCES projects (id),
  CONSTRAINT fk_gd_decided_by
    FOREIGN KEY (decided_by) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------
-- GATE_CONDITIONS
-- Discrete, trackable conditions attached to a Conditional decision.
-- Rows may be updated (marked closed with evidence) by the project team.
-- They may NEVER be deleted — the condition record and its closure must
-- remain part of the permanent gate record.
--
-- is_closed: flipped to 1 when the project team provides evidence that
-- the condition has been satisfied. This is what Step 4 uses to decide
-- whether the conditional gate has been fully resolved and the project
-- can advance.
-- -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS gate_conditions (
  id               INT UNSIGNED NOT NULL AUTO_INCREMENT,
  gate_decision_id INT UNSIGNED NOT NULL,
  project_id       INT UNSIGNED NOT NULL,
  stage_number     TINYINT UNSIGNED NOT NULL,
  description      TEXT         NOT NULL,
  is_closed        TINYINT(1)   NOT NULL DEFAULT 0,
  closed_by        INT UNSIGNED NULL DEFAULT NULL,
  closed_at        DATETIME     NULL DEFAULT NULL,
  evidence_note    TEXT         NULL DEFAULT NULL,
  created_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  CONSTRAINT fk_gc_decision
    FOREIGN KEY (gate_decision_id) REFERENCES gate_decisions (id),
  CONSTRAINT fk_gc_project
    FOREIGN KEY (project_id) REFERENCES projects (id),
  CONSTRAINT fk_gc_closed_by
    FOREIGN KEY (closed_by) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ==========================================================================
-- DATABASE USER GRANTS (run as root / privileged user)
-- Replace 'nnel_app'@'localhost' and 'nnel_frp' with your actual values.
--
-- SECURITY NOTE: gate_decisions intentionally omits UPDATE and DELETE —
-- this is the DB-level enforcement of the append-only rule for gate records.
-- gate_conditions omits DELETE only; UPDATE is needed to close conditions.
-- ==========================================================================

-- GRANT SELECT, INSERT                ON nnel_frp.gate_decisions  TO 'nnel_app'@'localhost';
-- GRANT SELECT, INSERT, UPDATE        ON nnel_frp.gate_conditions  TO 'nnel_app'@'localhost';
-- FLUSH PRIVILEGES;
