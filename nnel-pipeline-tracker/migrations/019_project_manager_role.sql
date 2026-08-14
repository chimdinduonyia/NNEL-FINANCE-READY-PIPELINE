-- 019_project_manager_role.sql
-- Adds the project_manager system role and a human-readable name field on
-- template_versions so PMs can label their versions meaningfully.

-- 1. Add project_manager to the system_role ENUM
ALTER TABLE users
  MODIFY COLUMN system_role ENUM('admin','project_manager','user') NOT NULL DEFAULT 'user';

-- 2. Add a human-readable name to template versions
ALTER TABLE template_versions
  ADD COLUMN name VARCHAR(100) NULL AFTER version;

-- 3. Back-fill names for the three seed versions
UPDATE template_versions SET name = 'Solar PV — Standard v1.0'   WHERE technology = 'solar_pv'  AND name IS NULL;
UPDATE template_versions SET name = 'Biofuels — Standard v1.0'   WHERE technology = 'biofuels'  AND name IS NULL;
UPDATE template_versions SET name = 'Abatement — Standard v1.0'  WHERE technology = 'abatement' AND name IS NULL;
