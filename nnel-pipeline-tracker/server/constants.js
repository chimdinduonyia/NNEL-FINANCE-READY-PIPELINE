'use strict';
/**
 * constants.js — small shared values used by more than one route/service file.
 *
 * MAX_STAGE_NUMBER is NOT a business rule — it's just a sanity ceiling so
 * obviously-bad input (a typo, a stray negative number) gets rejected before
 * touching the database. The real authority on which stages exist for a given
 * project or template version is the project_stages / template_stages tables
 * themselves; a stage number that passes this check but doesn't actually
 * exist there still gets rejected downstream as "not found".
 *
 * Historically every stage-number bound in this codebase was hardcoded to 5
 * (a fixed 6-stage pipeline, 0-5). Admins can now add stages via the template
 * editor (see DOA_SPEC.md / template_stages), so that fixed bound had to
 * become a generous ceiling instead — kept here so it's defined exactly once.
 */
const MAX_STAGE_NUMBER = 30;

module.exports = { MAX_STAGE_NUMBER };
