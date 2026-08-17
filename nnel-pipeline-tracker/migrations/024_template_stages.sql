-- ==========================================================================
-- 024_template_stages.sql
--
-- First real representation of a "stage" as an entity. Until now a stage was
-- purely an implicit integer (0-5) scattered across ~7 tables, with names
-- hardcoded in 7 separate frontend/backend files. This table gives every
-- template version its own named, ordered list of stages, so the template
-- editor can rename, add, and reorder stages per version without touching
-- code — see DOA_SPEC.md and CLAUDE.md's "lightweight templates" notes for
-- the background.
--
-- One row per stage per template version (mirrors the existing pattern used
-- by template_checklist_items and template_gate_approvers — no foreign key
-- from those tables to this one, they just share the same stage_number
-- within a template_version_id, consistent with how the rest of the schema
-- already works).
--
-- stage_number stays the anchor everything else keys off (checklist items,
-- gate approvers, project_stages, gate_decisions, document_register, audit
-- log). Renaming a stage never changes its number. Reordering (added in a
-- later step) recomputes stage_number for every row scoped to one template
-- version — safe only because of the existing fork-on-edit rule: an
-- in-flight project is always locked to the template_version it started on,
-- so reordering only ever touches a version with zero projects using it.
-- ==========================================================================

CREATE TABLE IF NOT EXISTS template_stages (
  id                   INT UNSIGNED     NOT NULL AUTO_INCREMENT,
  template_version_id  INT UNSIGNED     NOT NULL,
  stage_number         TINYINT UNSIGNED NOT NULL,
  name                 VARCHAR(100)     NOT NULL,
  created_at           DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_template_stage (template_version_id, stage_number),
  CONSTRAINT fk_ts_version
    FOREIGN KEY (template_version_id) REFERENCES template_versions (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---- Seed every EXISTING template version (active or not) with today's ----
-- ---- hardcoded stage names, so nothing changes visibly until the ----------
-- ---- frontend/backend are switched over to read from this table. ---------
-- Historical/inactive versions get seeded too — old projects locked to
-- those versions still need stage names for their read-only history views.

-- The SELECT is wrapped in its own derived table (`combined`) before the
-- ON DUPLICATE KEY UPDATE. Without this wrapper, MySQL's parser reads the
-- CROSS JOIN's alias immediately followed by "ON DUPLICATE..." as an attempt
-- to supply a join condition for the CROSS JOIN itself (MySQL treats CROSS
-- JOIN as accepting an ON clause, same as INNER JOIN) and fails with a syntax
-- error right before "KEY UPDATE" -- a genuine MySQL parser gotcha, not a
-- typo. Wrapping the join in a derived table removes the ambiguity.
INSERT INTO template_stages (template_version_id, stage_number, name)
SELECT * FROM (
  SELECT tv.id AS template_version_id, s.stage_number, s.name
  FROM template_versions tv
  CROSS JOIN (
    SELECT 0 AS stage_number, 'Opportunity Screening'  AS name UNION ALL
    SELECT 1, 'Preliminary Assessment' UNION ALL
    SELECT 2, 'Full Feasibility' UNION ALL
    SELECT 3, 'Financial Close / FID' UNION ALL
    SELECT 4, 'First Disbursement' UNION ALL
    SELECT 5, 'COD / Commissioning'
  ) s
) AS combined
ON DUPLICATE KEY UPDATE name = template_stages.name;   -- no-op if already seeded (idempotent re-run)

-- GRANT SELECT, INSERT, UPDATE, DELETE ON nnel_frp.template_stages TO 'nnel_app'@'localhost';
-- FLUSH PRIVILEGES;
