-- ==========================================================================
-- 027_template_immutable_standard.sql
--
-- Marks the three original seed templates (Solar PV / Biofuels / Abatement
-- "Standard") as immutable: server/routes/templates.js now forces every
-- edit or delete on a version with is_immutable = 1 to fork first — always,
-- regardless of whether any project is currently using it (the existing
-- fork-on-edit rule only forks when project_count > 0; immutable is a
-- stronger, unconditional version of that same protection). The fork lands
-- as a DRAFT (is_draft = 1, is_active = 0, source untouched), not an
-- immediately-active version like a normal fork-on-edit — an admin has to
-- deliberately publish (and separately activate) the result. The immutable
-- source version itself also can no longer be deleted at all, regardless
-- of its active/project-count state.
--
-- Matched by version string, not id — those three ('1.0', 'biofuels-1.0',
-- 'abatement-1.0') are the stable identifiers from the original seed
-- migrations (002/006/007_seed_template_*.sql) and won't collide with any
-- later fork/draft, which always bump to a new version string.
--
-- Also renames these three rows' display name to drop the em-dash
-- (2026-08-18 UI text cleanup applied everywhere else) -- purely cosmetic,
-- no functional effect.
-- ==========================================================================

ALTER TABLE template_versions
  ADD COLUMN is_immutable TINYINT(1) NOT NULL DEFAULT 0 AFTER is_draft;

UPDATE template_versions
  SET is_immutable = 1
  WHERE version IN ('1.0', 'biofuels-1.0', 'abatement-1.0');

UPDATE template_versions SET name = 'Solar PV - Standard v1.0'    WHERE version = '1.0';
UPDATE template_versions SET name = 'Biofuels - Standard v1.0'    WHERE version = 'biofuels-1.0';
UPDATE template_versions SET name = 'Abatement - Standard v1.0'   WHERE version = 'abatement-1.0';
