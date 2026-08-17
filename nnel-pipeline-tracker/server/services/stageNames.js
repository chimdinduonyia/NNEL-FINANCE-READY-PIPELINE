'use strict';
/**
 * stageNames.js — single source of truth for reading stage titles.
 *
 * Stage titles used to be hardcoded as an identical STAGE_NAMES array copied
 * into 7 different files (4 backend, 3 frontend). That's gone — titles now
 * live in template_stages, one row per stage per template version, editable
 * per version in the template editor. Every route that needs to display a
 * stage's name should go through one of these two helpers rather than
 * re-querying template_stages directly, so there's exactly one place this
 * logic lives.
 */
const pool = require('../db');

/**
 * Returns { [stage_number]: name } for a template version, by its numeric id.
 * @param {number} templateVersionId
 */
async function getStageNameMap(templateVersionId) {
  if (!templateVersionId) return {};
  const [rows] = await pool.execute(
    'SELECT stage_number, name FROM template_stages WHERE template_version_id = ? ORDER BY stage_number',
    [templateVersionId]
  );
  return Object.fromEntries(rows.map(r => [r.stage_number, r.name]));
}

/**
 * Same, but resolved from a project's locked template_version STRING (what
 * `projects.template_version` actually stores) rather than the numeric id —
 * the common case for anything working from a project row.
 * @param {string} templateVersionStr
 */
async function getStageNameMapForVersionString(templateVersionStr) {
  if (!templateVersionStr) return {};
  const [rows] = await pool.execute(
    `SELECT ts.stage_number, ts.name
     FROM template_stages ts
     JOIN template_versions tv ON tv.id = ts.template_version_id
     WHERE tv.version = ?
     ORDER BY ts.stage_number`,
    [templateVersionStr]
  );
  return Object.fromEntries(rows.map(r => [r.stage_number, r.name]));
}

module.exports = { getStageNameMap, getStageNameMapForVersionString };
