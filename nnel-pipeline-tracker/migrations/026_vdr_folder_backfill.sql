-- ==========================================================================
-- 026_vdr_folder_backfill.sql
--
-- Backfills the standard 10 VDR folders (same set seeded in
-- 002_seed_template_v1.sql) onto any template version that currently has
-- NONE at all. This happened to every version created via the template
-- editor's "start empty" path (POST /api/templates with no
-- source_version_id) — that path never seeded folders, which is why the
-- evidence-note modal's "VDR Folder" dropdown came up empty for documents
-- filed against those versions. Fixed going forward in createVersion()
-- (server/routes/templates.js); this migration is the one-time catch-up
-- for versions that already exist.
--
-- Only touches versions with zero existing folders (NOT EXISTS guard) —
-- versions that already have their own folder set (however many) are left
-- untouched, idempotent to re-run.
-- ==========================================================================

INSERT INTO template_vdr_folders (template_version_id, folder_code, name, sort_order)
SELECT tv.id, f.code, f.name, f.sort
FROM template_versions tv
CROSS JOIN (
  SELECT '00' AS code, 'Project Overview'          AS name, 0 AS sort UNION ALL
  SELECT '01', 'Corporate & Legal',          1 UNION ALL
  SELECT '02', 'Technical & Engineering',    2 UNION ALL
  SELECT '03', 'Environmental & Social',     3 UNION ALL
  SELECT '04', 'Commercial & Offtake',       4 UNION ALL
  SELECT '05', 'Financial Model & Returns',  5 UNION ALL
  SELECT '06', 'Permits & Regulatory',       6 UNION ALL
  SELECT '07', 'Insurance',                  7 UNION ALL
  SELECT '08', 'Land & Site',                8 UNION ALL
  SELECT '09', 'Other / Correspondence',     9
) f
WHERE NOT EXISTS (
  SELECT 1 FROM template_vdr_folders vf WHERE vf.template_version_id = tv.id
);
