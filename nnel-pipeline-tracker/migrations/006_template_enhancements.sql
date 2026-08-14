-- ==========================================================================
-- 006_template_enhancements.sql
-- Adds multi-vertical support to the template tables.
-- Run before 006_seed_template_biofuels_v1.sql.
-- ==========================================================================

-- 1. Add technology to template_versions so each version is tagged to
--    one of the three NNEL project verticals.
--    Default 'solar_pv' keeps the existing '1.0' version correct.
ALTER TABLE template_versions
  ADD COLUMN IF NOT EXISTS technology ENUM('solar_pv','biofuels','abatement')
    NOT NULL DEFAULT 'solar_pv'
  AFTER version;

-- Mark the existing solar PV template explicitly.
UPDATE template_versions SET technology = 'solar_pv' WHERE version = '1.0';

-- 2. Add is_active to template_checklist_items for soft-delete support.
--    Deactivating an item removes it from new-project checklists without
--    deleting historical data on in-flight projects.
ALTER TABLE template_checklist_items
  ADD COLUMN is_active TINYINT(1) NOT NULL DEFAULT 1
  AFTER sort_order;

-- 3. Extend the pillar ENUM to include 'esg' (used by the two new verticals
--    as a combined Environmental, Social & Governance pillar).
--    The legacy 'environmental' and 'risk' values remain valid so existing
--    solar-PV items are unaffected.
ALTER TABLE template_checklist_items
  MODIFY COLUMN pillar
    ENUM('technical','commercial','finance','legal',
         'environmental','risk','esg') NOT NULL;
