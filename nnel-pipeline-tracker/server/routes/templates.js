'use strict';
/**
 * routes/templates.js — Template management
 *
 * GET    /api/templates                          — list all versions with project counts
 * GET    /api/templates/active                   — active version for a technology
 *                                                  (?technology=solar_pv|biofuels|abatement)
 * GET    /api/templates/:versionId/items         — items grouped by stage (admin)
 * POST   /api/templates/:versionId/items         — add a new item; code is auto-generated (admin)
 * PATCH  /api/templates/:versionId/items/:itemId — edit item; auto-forks if projects exist (admin)
 * PATCH  /api/templates/:versionId/items/:itemId/status  — soft-deactivate/restore (admin)
 * DELETE /api/templates/:versionId/items/:itemId         — hard-delete; blocked if any
 *                                                          project has ever reached this item (admin)
 * POST   /api/templates/:versionId/items/:itemId/reorder — swap with adjacent item in the
 *                                                          same stage+pillar group (admin)
 *
 * ITEM CODES ARE AUTO-GENERATED, not free text (2026-08-18): "<tech letter><stage>-<pillar
 * letter>-<NN>", e.g. S2-T-03 = Solar PV, Stage 2, Technical, 3rd item in that stage+pillar
 * group. NN is always contiguous within (version, stage, pillar) — adding appends the next
 * number; deleting or reordering renumbers the whole group so there's never a gap. See
 * renumberPillarGroup() below — the one place this logic lives.
 * POST   /api/templates/:versionId/fork          — manually fork to a new active version (admin)
 * PATCH  /api/templates/:versionId/publish       — publish a draft (admin) — see is_draft below
 *
 * VERSIONING RULE: an item edit on a version that has in-flight projects
 * always creates a new version (fork) rather than mutating the original.
 * Only new projects pick up the updated version. Existing projects keep
 * their locked template_version string unchanged.
 *
 * DRAFT/PUBLISH (2026-08-17): a version created via "+ New" starts as a
 * draft (is_draft = 1) — invisible to the "+ New Project" template picker
 * (GET /api/templates?published_only=true) and never selectable for a real
 * project, so every edit to it applies in place (project_count is always 0
 * for a draft). PATCH .../publish flips is_draft to 0. Publishing does NOT
 * also set the version active — that stays the separate "Set as Active"
 * action. setActive() refuses to activate a version that's still a draft.
 */

const pool     = require('../db');
const { requireLogin } = require('../middleware/auth');
const { sendJSON, sendError } = require('../utils/response');
const { readBody }            = require('../utils/bodyParser');
const auditLog = require('../services/auditLog');
const { MAX_STAGE_NUMBER } = require('../constants');

const VALID_PILLARS = ['technical','commercial','finance','legal','environmental','risk','esg'];

// Single letter per pillar, used in the auto-generated item code. Both
// 'environmental' (legacy) and 'esg' (its replacement) use 'E' — esg
// superseded environmental/risk as the modern pillar name, so real templates
// never mix both in the same stage; if one somehow did, two groups could
// both display "E-01" (cosmetic only, item_code isn't a key anywhere).
const PILLAR_LETTER = {
  technical: 'T', commercial: 'C', finance: 'F', legal: 'L',
  environmental: 'E', risk: 'R', esg: 'E',
};
// Tech-vertical letter prefix, matching the codes every original template
// shipped with (S0-T-01 for Solar PV, B0-T-01 for Biofuels, A0-T-01 for
// Abatement — see CLAUDE.md's multi-vertical template notes).
const TECH_PREFIX = { solar_pv: 'S', biofuels: 'B', abatement: 'A' };

// ---------------------------------------------------------------------------
// Renumbers every item in one (template_version, stage, pillar) group so
// item_code and sort_order are contiguous 1..N in current sort_order order.
// The one place item_code generation logic lives — called after any delete
// or reorder within a group (add doesn't need it: a new item is always
// appended at position N+1, nothing else shifts).
// Caller is responsible for the surrounding transaction.
// ---------------------------------------------------------------------------
async function renumberPillarGroup(conn, versionId, stageNumber, pillar, techPrefix) {
  const [items] = await conn.execute(
    `SELECT id FROM template_checklist_items
     WHERE template_version_id = ? AND stage_number = ? AND pillar = ?
     ORDER BY sort_order, id`,
    [versionId, stageNumber, pillar]
  );
  const letter = PILLAR_LETTER[pillar] ?? pillar.charAt(0).toUpperCase();

  // Two passes, not one: item_code has a UNIQUE(template_version_id,
  // item_code) constraint, checked immediately per statement (no deferred
  // constraints in MySQL/InnoDB). Assigning final codes in a single pass
  // can collide with a not-yet-updated sibling still sitting on the code
  // we're about to move onto (e.g. moving item B onto "S0-C-01" while item
  // A is still sitting on "S0-C-01", waiting its turn). First move every
  // item in the group to a temp code that can't collide with anything
  // (keyed on its own id), then assign real final codes in a second pass.
  // item_code is VARCHAR(20) — keep the temp code short. "~" can't collide
  // with a real code (those always start with a tech-prefix letter).
  for (const item of items) {
    await conn.execute(
      'UPDATE template_checklist_items SET item_code = ? WHERE id = ?',
      [`~${item.id}`, item.id]
    );
  }
  for (let i = 0; i < items.length; i++) {
    const code = `${techPrefix}${stageNumber}-${letter}-${String(i + 1).padStart(2, '0')}`;
    await conn.execute(
      'UPDATE template_checklist_items SET item_code = ?, sort_order = ? WHERE id = ?',
      [code, i + 1, items[i].id]
    );
  }
}

// Standard VDR folder set — same 10 folders every original template version
// was seeded with (002/006/007_seed_template_*.sql). A version created via
// "start empty" used to get none at all, which is why the evidence-note
// modal's folder dropdown could come up empty (see migration 026). Every new
// "start empty" version now gets this set too, so that can't recur. Not
// stage/gate-specific — same folders apply across the whole project.
const DEFAULT_VDR_FOLDERS = [
  { code: '00', name: 'Project Overview' },
  { code: '01', name: 'Corporate & Legal' },
  { code: '02', name: 'Technical & Engineering' },
  { code: '03', name: 'Environmental & Social' },
  { code: '04', name: 'Commercial & Offtake' },
  { code: '05', name: 'Financial Model & Returns' },
  { code: '06', name: 'Permits & Regulatory' },
  { code: '07', name: 'Insurance' },
  { code: '08', name: 'Land & Site' },
  { code: '09', name: 'Other / Correspondence' },
];

// ---------------------------------------------------------------------------
// Version-bump helper  '1.0' → '1.1'  'biofuels-1.0' → 'biofuels-1.1'
// ---------------------------------------------------------------------------
function bumpVersion(version) {
  return version.replace(/(\d+)(?!.*\d)/, n => String(parseInt(n, 10) + 1));
}

// ---------------------------------------------------------------------------
// Fork a template version (clone all active items into a new version row).
// Returns the new template_versions row.
// Caller is responsible for the surrounding transaction.
//
// opts.asDraft (default false): every existing call site is the fork-on-edit
// safety net (protecting in-flight projects from an edit to a version
// they're using) and must keep behaving exactly as before — new version
// immediately active, old one retired, is_draft = 0. The ONE place that
// passes asDraft: true is createVersion()'s "copy items from" path, where
// the whole point is a working copy nobody sees yet: is_active stays 0, the
// source version is left alone, and is_draft = 1 until an explicit Publish.
// ---------------------------------------------------------------------------
// name is optional — if omitted the bumped version string is used as the name
async function forkVersion(conn, sourceVersionId, userId, nameOverride = null, opts = {}) {
  const { asDraft = false } = opts;

  const [[src]] = await conn.execute(
    'SELECT version, name, technology, description FROM template_versions WHERE id = ?',
    [sourceVersionId]
  );
  if (!src) throw new Error('Source template version not found');

  // Find the first available version string by incrementing until free.
  // This prevents collisions when the template has been forked multiple times
  // from the same source without promoting the intermediate versions.
  let newVersionStr = bumpVersion(src.version);
  for (let attempts = 0; attempts < 50; attempts++) {
    const [[taken]] = await conn.execute(
      'SELECT id FROM template_versions WHERE version = ?', [newVersionStr]
    );
    if (!taken) break;
    newVersionStr = bumpVersion(newVersionStr);
  }

  const newName = nameOverride || `${src.name || src.version} (edited)`;

  // Create new version row. Fork-on-edit (asDraft=false, the default): mark
  // it active immediately and retire the source, per the original spec'd
  // behaviour. Draft copy (asDraft=true): stays inactive and undrafted-only-
  // on-publish; the source is left exactly as it was.
  const [result] = await conn.execute(
    `INSERT INTO template_versions (version, name, technology, description, is_active, is_draft, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [newVersionStr, newName, src.technology, src.description, asDraft ? 0 : 1, asDraft ? 1 : 0, userId]
  );
  const newVersionId = result.insertId;

  if (!asDraft) {
    await conn.execute(
      'UPDATE template_versions SET is_active = 0 WHERE id = ?',
      [sourceVersionId]
    );
  }

  // Clone all active items to the new version (same codes, same content)
  await conn.execute(
    `INSERT INTO template_checklist_items
       (template_version_id, stage_number, pillar, item_code, description,
        guidance, is_mandatory, sort_order, is_active)
     SELECT ?, stage_number, pillar, item_code, description,
            guidance, is_mandatory, sort_order, is_active
     FROM template_checklist_items
     WHERE template_version_id = ?`,
    [newVersionId, sourceVersionId]
  );

  // Clone stage definitions (names + numbers) — see template_stages /
  // DOA_SPEC.md. Without this, a fork would silently lose any renamed or
  // added stages and fall back to nothing at all for that version.
  await conn.execute(
    `INSERT INTO template_stages (template_version_id, stage_number, name)
     SELECT ?, stage_number, name
     FROM template_stages
     WHERE template_version_id = ?`,
    [newVersionId, sourceVersionId]
  );

  // Clone VDR folders
  await conn.execute(
    `INSERT INTO template_vdr_folders
       (template_version_id, folder_code, name, description, sort_order)
     SELECT ?, folder_code, name, description, sort_order
     FROM template_vdr_folders
     WHERE template_version_id = ?`,
    [newVersionId, sourceVersionId]
  );

  return { id: newVersionId, version: newVersionStr, technology: src.technology };
}

// ---------------------------------------------------------------------------
// Check how many active projects are using a template version
// ---------------------------------------------------------------------------
async function projectCount(versionStr) {
  const [[row]] = await pool.execute(
    "SELECT COUNT(*) AS cnt FROM projects WHERE template_version = ? AND status NOT IN ('completed','cancelled')",
    [versionStr]
  );
  return Number(row.cnt);
}

// ---------------------------------------------------------------------------
// Decides whether an edit to `tv` needs to fork before applying, and does it
// if so. Two independent reasons to fork (migration 027):
//   - tv.is_immutable: the three original standard templates (Solar PV /
//     Biofuels / Abatement "Standard v1.0") can never be edited in place,
//     full stop — always forks to a new DRAFT, regardless of usage. An
//     admin has to deliberately publish (and separately activate) the
//     result; it never silently becomes the live default.
//   - project_count(tv.version) > 0: the existing fork-on-edit safety net —
//     forks to a new ACTIVE version, same as it always has.
// tv must include at least { id, version, is_immutable }.
// Returns { targetVersionId, forked, newVersion } — caller applies its
// actual edit to targetVersionId either way, and returns forked/newVersion
// to the client the same way every endpoint here already does.
// ---------------------------------------------------------------------------
async function forkIfNeeded(conn, tv, userId, reason) {
  if (tv.is_immutable) {
    const fork = await forkVersion(conn, tv.id, userId, null, { asDraft: true });
    await auditLog.log(conn, {
      userId, action: 'template_version_created',
      detail: { source_version_id: tv.id, reason: `${reason}_on_immutable_standard`, new_version: fork.version },
    });
    return { targetVersionId: fork.id, forked: true, newVersion: fork.version };
  }
  const cnt = await projectCount(tv.version);
  if (cnt > 0) {
    const fork = await forkVersion(conn, tv.id, userId);
    await auditLog.log(conn, {
      userId, action: 'template_version_created',
      detail: { source_version_id: tv.id, reason, new_version: fork.version },
    });
    return { targetVersionId: fork.id, forked: true, newVersion: fork.version };
  }
  return { targetVersionId: tv.id, forked: false, newVersion: null };
}

// ---------------------------------------------------------------------------
// GET /api/templates
// ---------------------------------------------------------------------------
async function listVersions(req, res) {
  const user = await requireLogin(req, res);
  if (!user) return;
  if (!['admin','project_manager'].includes(user.system_role)) return sendError(res, 403, 'Forbidden');

  // ?published_only=true — used by the "+ New Project" template picker, so
  // a draft nobody has published yet can never be selected for a real
  // project. The template editor itself calls this without the flag, since
  // it needs to see (and open) drafts to work on them.
  const url = new URL(req.url, 'http://localhost');
  const publishedOnly = url.searchParams.get('published_only') === 'true';

  const [rows] = await pool.execute(
    `SELECT tv.id, tv.version, tv.name, tv.technology, tv.description, tv.is_active, tv.is_draft, tv.is_immutable,
            tv.created_at, tv.created_by, u.full_name AS created_by_name,
            (SELECT COUNT(*) FROM projects p
             WHERE p.template_version = tv.version
               AND p.status NOT IN ('completed','cancelled')) AS project_count
     FROM template_versions tv
     LEFT JOIN users u ON u.id = tv.created_by
     ${publishedOnly ? 'WHERE tv.is_draft = 0' : ''}
     ORDER BY tv.technology, tv.id DESC`
  );
  sendJSON(res, 200, rows);
}

// ---------------------------------------------------------------------------
// GET /api/templates/active
// Optional ?technology=solar_pv|biofuels|abatement
// Without param defaults to solar_pv (backwards-compatible).
// ---------------------------------------------------------------------------
async function getActive(req, res) {
  const user = await requireLogin(req, res);
  if (!user) return;

  const url  = new URL(req.url, 'http://localhost');
  const tech = url.searchParams.get('technology') || 'solar_pv';

  const [[tv]] = await pool.execute(
    'SELECT id, version, description FROM template_versions WHERE is_active = 1 AND technology = ? ORDER BY id DESC LIMIT 1',
    [tech]
  );
  if (!tv) return sendError(res, 404, `No active template found for technology '${tech}'`);

  const [folders] = await pool.execute(
    `SELECT folder_code, name, description
     FROM template_vdr_folders
     WHERE template_version_id = ?
     ORDER BY sort_order`,
    [tv.id]
  );

  sendJSON(res, 200, { version: tv.version, description: tv.description, vdr_folders: folders });
}

// ---------------------------------------------------------------------------
// GET /api/templates/:versionId/items
// Returns items grouped by stage number. Active and inactive items included
// (admin sees both; inactive items are flagged so the editor can display them).
// Also includes the project_count so the UI can show the fork warning.
// ---------------------------------------------------------------------------
async function getItems(req, res, params) {
  const user = await requireLogin(req, res);
  if (!user) return;
  if (!['admin','project_manager'].includes(user.system_role)) return sendError(res, 403, 'Forbidden');

  const versionId = parseInt(params.versionId, 10);
  if (!versionId) return sendError(res, 400, 'Invalid versionId');

  const [[tv]] = await pool.execute(
    'SELECT id, version, technology, description, is_active, is_draft, is_immutable FROM template_versions WHERE id = ?',
    [versionId]
  );
  if (!tv) return sendError(res, 404, 'Template version not found');

  // pillar comes before sort_order here because sort_order is now scoped
  // per (stage, pillar) group (see renumberPillarGroup) — two different
  // pillars can both have an item at sort_order 1, so sorting by sort_order
  // first would interleave pillars instead of keeping each group together.
  const [items] = await pool.execute(
    `SELECT id, stage_number, pillar, item_code, description, guidance,
            is_mandatory, sort_order, is_active
     FROM template_checklist_items
     WHERE template_version_id = ?
     ORDER BY stage_number, pillar, sort_order, item_code`,
    [versionId]
  );

  // Stages themselves are data now (template_stages), not a hardcoded 0-5 —
  // admins can rename, add, and reorder them per version in this editor.
  const [stageRows] = await pool.execute(
    'SELECT id, stage_number, name FROM template_stages WHERE template_version_id = ? ORDER BY stage_number',
    [versionId]
  );

  // Group items by stage
  const byStage = {};
  stageRows.forEach(s => {
    byStage[s.stage_number] = {
      id: s.id, stage_number: s.stage_number, stage_name: s.name, items: [],
    };
  });
  items.forEach(item => {
    if (byStage[item.stage_number]) byStage[item.stage_number].items.push(item);
  });

  const cnt = await projectCount(tv.version);

  sendJSON(res, 200, {
    version_id:    tv.id,
    version:       tv.version,
    technology:    tv.technology,
    description:   tv.description,
    is_active:     tv.is_active,
    is_draft:      !!tv.is_draft,
    is_immutable:  !!tv.is_immutable,
    project_count: cnt,
    next_version:  bumpVersion(tv.version),
    stages:        Object.values(byStage),
  });
}

// ---------------------------------------------------------------------------
// POST /api/templates/:versionId/items
// Adds a new checklist item, appended at the end of its stage+pillar group.
// item_code is auto-generated (see PILLAR_LETTER/TECH_PREFIX/
// renumberPillarGroup up top) — the caller supplies stage_number, pillar,
// description, guidance, is_mandatory only.
// Always modifies in-place on the specified version (adding new items to an
// in-use version is safe — existing stage_checklist rows are unaffected;
// only new project initialisations will pick up the new item).
// ---------------------------------------------------------------------------
async function addItem(req, res, params) {
  const user = await requireLogin(req, res);
  if (!user) return;
  if (!['admin','project_manager'].includes(user.system_role)) return sendError(res, 403, 'Forbidden');

  const versionId = parseInt(params.versionId, 10);
  if (!versionId) return sendError(res, 400, 'Invalid versionId');

  let body;
  try { body = await readBody(req); } catch { return sendError(res, 400, 'Invalid JSON'); }

  const { stage_number, pillar, description, guidance, is_mandatory } = body;

  if (!Number.isInteger(Number(stage_number)) || stage_number < 0 || stage_number > MAX_STAGE_NUMBER) {
    return sendError(res, 400, `stage_number (0–${MAX_STAGE_NUMBER}) is required`);
  }
  if (!VALID_PILLARS.includes(pillar)) {
    return sendError(res, 400, `pillar must be one of: ${VALID_PILLARS.join(', ')}`);
  }
  if (!description || !description.trim()) {
    return sendError(res, 400, 'description is required');
  }

  // Confirm the version exists and get its technology (for the code prefix)
  const [[tv]] = await pool.execute(
    'SELECT id, version, technology, is_immutable FROM template_versions WHERE id = ?', [versionId]
  );
  if (!tv) return sendError(res, 404, 'Template version not found');
  const techPrefix = TECH_PREFIX[tv.technology] ?? 'S';

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // addItem doesn't fork for the ordinary in-use case (adding a new item
    // is always safe — existing stage_checklist rows are unaffected). The
    // one exception is an immutable standard template, which forks to a
    // draft unconditionally — see forkIfNeeded().
    const { targetVersionId, forked, newVersion } = tv.is_immutable
      ? await forkIfNeeded(conn, tv, user.id, 'item_add')
      : { targetVersionId: versionId, forked: false, newVersion: null };

    // Position = last in the group. No renumbering needed for an append —
    // nothing else shifts.
    const [[{ maxSort }]] = await conn.execute(
      `SELECT MAX(sort_order) AS maxSort FROM template_checklist_items
       WHERE template_version_id = ? AND stage_number = ? AND pillar = ?`,
      [targetVersionId, stage_number, pillar]
    );
    const position = (maxSort ?? 0) + 1;
    const letter = PILLAR_LETTER[pillar] ?? pillar.charAt(0).toUpperCase();
    const itemCode = `${techPrefix}${stage_number}-${letter}-${String(position).padStart(2, '0')}`;

    const [result] = await conn.execute(
      `INSERT INTO template_checklist_items
         (template_version_id, stage_number, pillar, item_code, description,
          guidance, is_mandatory, sort_order, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      [targetVersionId, stage_number, pillar, itemCode,
       description.trim(), guidance || null,
       is_mandatory !== false ? 1 : 0,
       position]
    );
    await auditLog.log(conn, {
      userId: user.id,
      action: 'template_item_added',
      detail: { version_id: targetVersionId, version: tv.version, item_code: itemCode, forked },
    });
    await conn.commit();
    sendJSON(res, 201, { id: result.insertId, item_code: itemCode, forked, new_version_id: forked ? targetVersionId : null, new_version: newVersion });
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

// ---------------------------------------------------------------------------
// PATCH /api/templates/:versionId/items/:itemId
// Edits description, guidance, pillar, is_mandatory, or sort_order.
//
// VERSIONING: if any active projects use this version, the endpoint forks
// the version automatically, applies the edit to the forked copy, and
// returns { forked: true, new_version_id, new_version } so the UI can
// redirect to the new version without the admin needing to do anything.
// ---------------------------------------------------------------------------
async function editItem(req, res, params) {
  const user = await requireLogin(req, res);
  if (!user) return;
  if (!['admin','project_manager'].includes(user.system_role)) return sendError(res, 403, 'Forbidden');

  const versionId = parseInt(params.versionId, 10);
  const itemId    = parseInt(params.itemId, 10);
  if (!versionId || !itemId) return sendError(res, 400, 'Invalid ids');

  let body;
  try { body = await readBody(req); } catch { return sendError(res, 400, 'Invalid JSON'); }

  // Validate updatable fields
  if (body.pillar !== undefined && !VALID_PILLARS.includes(body.pillar)) {
    return sendError(res, 400, `pillar must be one of: ${VALID_PILLARS.join(', ')}`);
  }

  const allowed = ['description', 'guidance', 'pillar', 'is_mandatory', 'sort_order'];
  const sets = [];
  const vals = [];
  for (const f of allowed) {
    if (body[f] !== undefined) { sets.push(`${f} = ?`); vals.push(body[f]); }
  }
  if (sets.length === 0) return sendError(res, 400, 'No updatable fields provided');

  // Confirm item belongs to this version
  const [[item]] = await pool.execute(
    'SELECT item_code FROM template_checklist_items WHERE id = ? AND template_version_id = ?',
    [itemId, versionId]
  );
  if (!item) return sendError(res, 404, 'Item not found in this template version');

  const [[tv]] = await pool.execute(
    'SELECT id, version, is_immutable FROM template_versions WHERE id = ?', [versionId]
  );

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const { targetVersionId, forked, newVersion } = await forkIfNeeded(conn, tv, user.id, 'item_edit');

    // Apply the edit (to forked copy or in-place)
    vals.push(targetVersionId, item.item_code);
    await conn.execute(
      `UPDATE template_checklist_items SET ${sets.join(', ')}
       WHERE template_version_id = ? AND item_code = ?`,
      vals
    );

    await auditLog.log(conn, {
      userId: user.id,
      action: 'template_item_edited',
      detail: { version_id: targetVersionId, item_code: item.item_code, changes: body, forked },
    });

    await conn.commit();
    sendJSON(res, 200, { updated: true, forked, new_version_id: forked ? targetVersionId : null, new_version: newVersion });
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

// ---------------------------------------------------------------------------
// PATCH /api/templates/:versionId/items/:itemId/status
// Soft-deactivates (is_active=0) or restores (is_active=1) an item.
// Same fork logic as editItem.
// ---------------------------------------------------------------------------
async function setItemStatus(req, res, params) {
  const user = await requireLogin(req, res);
  if (!user) return;
  if (!['admin','project_manager'].includes(user.system_role)) return sendError(res, 403, 'Forbidden');

  const versionId = parseInt(params.versionId, 10);
  const itemId    = parseInt(params.itemId, 10);
  if (!versionId || !itemId) return sendError(res, 400, 'Invalid ids');

  let body;
  try { body = await readBody(req); } catch { return sendError(res, 400, 'Invalid JSON'); }
  if (typeof body.is_active !== 'boolean') {
    return sendError(res, 400, 'is_active (boolean) is required');
  }

  const [[item]] = await pool.execute(
    'SELECT item_code FROM template_checklist_items WHERE id = ? AND template_version_id = ?',
    [itemId, versionId]
  );
  if (!item) return sendError(res, 404, 'Item not found in this template version');

  const [[tv]] = await pool.execute(
    'SELECT id, version, is_immutable FROM template_versions WHERE id = ?', [versionId]
  );

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const { targetVersionId, forked, newVersion } = await forkIfNeeded(conn, tv, user.id, 'item_status_change');

    await conn.execute(
      `UPDATE template_checklist_items SET is_active = ?
       WHERE template_version_id = ? AND item_code = ?`,
      [body.is_active ? 1 : 0, targetVersionId, item.item_code]
    );

    await auditLog.log(conn, {
      userId: user.id,
      action: 'template_item_status_changed',
      detail: { version_id: targetVersionId, item_code: item.item_code, is_active: body.is_active, forked },
    });

    await conn.commit();
    sendJSON(res, 200, { updated: true, forked, new_version_id: forked ? targetVersionId : null, new_version: newVersion });
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * DELETE /api/templates/:versionId/items/:itemId
 * Hard-deletes a checklist item and renumbers the rest of its stage+pillar
 * group to close the gap (e.g. deleting the 2nd of 4 items makes the old
 * 3rd become the new 2nd, etc.).
 *
 * SAFETY: blocked if any project has ever reached this item — a
 * stage_checklist row referencing it exists (created eagerly whenever a
 * project opens that stage, whether or not the item's been ticked — see
 * stageService.initializeStageChecklist). Deleting it would break that
 * project's checklist history (stage_checklist.checklist_item_id has a FK
 * on this table with no cascade). Disable it instead once it's been used;
 * only ever-unused items can be hard-deleted.
 *
 * Same fork-on-edit rule as every other item edit on top of that.
 */
async function deleteItem(req, res, params) {
  const user = await requireLogin(req, res);
  if (!user) return;
  if (!['admin','project_manager'].includes(user.system_role)) return sendError(res, 403, 'Forbidden');

  const versionId = parseInt(params.versionId, 10);
  const itemId    = parseInt(params.itemId, 10);
  if (!versionId || !itemId) return sendError(res, 400, 'Invalid ids');

  const [[item]] = await pool.execute(
    'SELECT item_code, stage_number, pillar FROM template_checklist_items WHERE id = ? AND template_version_id = ?',
    [itemId, versionId]
  );
  if (!item) return sendError(res, 404, 'Item not found in this template version');

  const [[{ usageCount }]] = await pool.execute(
    'SELECT COUNT(*) AS usageCount FROM stage_checklist WHERE checklist_item_id = ?',
    [itemId]
  );
  if (Number(usageCount) > 0) {
    return sendError(res, 409,
      `Cannot delete - ${usageCount} project stage${usageCount > 1 ? 's have' : ' has'} already used this item. Disable it instead.`);
  }

  const [[tv]] = await pool.execute(
    'SELECT id, version, technology, is_immutable FROM template_versions WHERE id = ?', [versionId]
  );
  if (!tv) return sendError(res, 404, 'Template version not found');
  const techPrefix = TECH_PREFIX[tv.technology] ?? 'S';

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const { targetVersionId, forked, newVersion } = await forkIfNeeded(conn, tv, user.id, 'item_delete');

    // Match by item_code, not id — a fork clones the row with a new id but
    // the same code (same pattern editItem/setItemStatus already use).
    await conn.execute(
      'DELETE FROM template_checklist_items WHERE template_version_id = ? AND item_code = ?',
      [targetVersionId, item.item_code]
    );

    await renumberPillarGroup(conn, targetVersionId, item.stage_number, item.pillar, techPrefix);

    await auditLog.log(conn, {
      userId: user.id, action: 'template_item_deleted',
      detail: { version_id: targetVersionId, item_code: item.item_code, forked },
    });

    await conn.commit();
    sendJSON(res, 200, { deleted: true, forked, new_version_id: forked ? targetVersionId : null, new_version: newVersion });
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * POST /api/templates/:versionId/items/bulk-delete
 * Body: { item_ids: [12, 13, 14] }
 *
 * Same rule as the single-item DELETE, applied to a whole selection at
 * once: all-or-nothing (if ANY selected item has ever been reached by a
 * project, the whole batch is rejected with the list of which ones — never
 * silently deletes the rest), one fork decision for the batch (not one per
 * item), then renumbers every (stage, pillar) group touched by the
 * selection — a selection can span multiple groups if items from different
 * pillars/stages were selected together.
 */
async function bulkDeleteItems(req, res, params) {
  const user = await requireLogin(req, res);
  if (!user) return;
  if (!['admin','project_manager'].includes(user.system_role)) return sendError(res, 403, 'Forbidden');

  const versionId = parseInt(params.versionId, 10);
  if (!versionId) return sendError(res, 400, 'Invalid versionId');

  let body;
  try { body = await readBody(req); } catch { return sendError(res, 400, 'Invalid JSON'); }
  const itemIds = Array.isArray(body.item_ids) ? body.item_ids.map(n => parseInt(n, 10)).filter(Number.isInteger) : [];
  if (itemIds.length === 0) return sendError(res, 400, 'item_ids must be a non-empty array');

  const placeholders = itemIds.map(() => '?').join(',');
  const [items] = await pool.execute(
    `SELECT id, item_code, stage_number, pillar FROM template_checklist_items
     WHERE template_version_id = ? AND id IN (${placeholders})`,
    [versionId, ...itemIds]
  );
  if (items.length === 0) return sendError(res, 404, 'None of the selected items belong to this template version');

  // SAFETY: same as the single-item delete — reject the whole batch if any
  // selected item has ever been reached by a project.
  const [usageRows] = await pool.execute(
    `SELECT checklist_item_id, COUNT(*) AS n FROM stage_checklist
     WHERE checklist_item_id IN (${items.map(() => '?').join(',')})
     GROUP BY checklist_item_id`,
    items.map(i => i.id)
  );
  if (usageRows.length > 0) {
    const usedCodes = items
      .filter(i => usageRows.some(u => u.checklist_item_id === i.id))
      .map(i => i.item_code);
    return sendError(res, 409,
      `Cannot delete - ${usedCodes.length} of the selected item${usedCodes.length > 1 ? 's have' : ' has'} already been ` +
      `used by a project (${usedCodes.join(', ')}). Deselect ${usedCodes.length > 1 ? 'them' : 'it'} and disable instead, ` +
      `or delete the rest separately.`);
  }

  const [[tv]] = await pool.execute(
    'SELECT id, version, technology, is_immutable FROM template_versions WHERE id = ?', [versionId]
  );
  if (!tv) return sendError(res, 404, 'Template version not found');
  const techPrefix = TECH_PREFIX[tv.technology] ?? 'S';

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const { targetVersionId, forked, newVersion } = await forkIfNeeded(conn, tv, user.id, 'item_bulk_delete');

    // Match by item_code, not id — same reasoning as the single-item delete.
    const codes = items.map(i => i.item_code);
    await conn.execute(
      `DELETE FROM template_checklist_items
       WHERE template_version_id = ? AND item_code IN (${codes.map(() => '?').join(',')})`,
      [targetVersionId, ...codes]
    );

    // Renumber every distinct (stage, pillar) group the selection touched.
    const groups = new Map(); // "stage|pillar" -> { stage_number, pillar }
    items.forEach(i => groups.set(`${i.stage_number}|${i.pillar}`, { stage_number: i.stage_number, pillar: i.pillar }));
    for (const { stage_number, pillar } of groups.values()) {
      await renumberPillarGroup(conn, targetVersionId, stage_number, pillar, techPrefix);
    }

    await auditLog.log(conn, {
      userId: user.id, action: 'template_items_bulk_deleted',
      detail: { version_id: targetVersionId, count: items.length, item_codes: codes, forked },
    });

    await conn.commit();
    sendJSON(res, 200, {
      deleted: true, count: items.length, forked,
      new_version_id: forked ? targetVersionId : null, new_version: newVersion,
    });
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * POST /api/templates/:versionId/items/:itemId/reorder
 * Body: { direction: 'up' | 'down' }
 *
 * Swaps this item with its adjacent neighbour within the same stage+pillar
 * group, then renumbers the whole group so codes stay contiguous — moving
 * the 4th item up makes it S2-T-03 and the old 3rd becomes S2-T-04.
 *
 * Unlike delete, reordering doesn't remove anything, so it's safe even for
 * an item projects have already used — stage_checklist keys off the
 * numeric id, not the code, so a renumber never touches those rows.
 * Historical audit-log entries keep whatever code an item had AT THE TIME
 * it was logged — normal audit-trail behaviour, not something this needs
 * to (or should) retroactively rewrite.
 *
 * Same fork-on-edit rule as every other item edit.
 */
async function reorderItem(req, res, params) {
  const user = await requireLogin(req, res);
  if (!user) return;
  if (!['admin','project_manager'].includes(user.system_role)) return sendError(res, 403, 'Forbidden');

  const versionId = parseInt(params.versionId, 10);
  const itemId    = parseInt(params.itemId, 10);
  if (!versionId || !itemId) return sendError(res, 400, 'Invalid ids');

  let body;
  try { body = await readBody(req); } catch { return sendError(res, 400, 'Invalid JSON'); }
  if (!['up','down'].includes(body.direction)) {
    return sendError(res, 400, "direction must be 'up' or 'down'");
  }

  const [[item]] = await pool.execute(
    'SELECT item_code, stage_number, pillar FROM template_checklist_items WHERE id = ? AND template_version_id = ?',
    [itemId, versionId]
  );
  if (!item) return sendError(res, 404, 'Item not found in this template version');

  const [[tv]] = await pool.execute(
    'SELECT id, version, technology, is_immutable FROM template_versions WHERE id = ?', [versionId]
  );
  if (!tv) return sendError(res, 404, 'Template version not found');
  const techPrefix = TECH_PREFIX[tv.technology] ?? 'S';

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const { targetVersionId, forked, newVersion } = await forkIfNeeded(conn, tv, user.id, 'item_reorder');

    const [groupItems] = await conn.execute(
      `SELECT id, item_code, sort_order FROM template_checklist_items
       WHERE template_version_id = ? AND stage_number = ? AND pillar = ?
       ORDER BY sort_order, id`,
      [targetVersionId, item.stage_number, item.pillar]
    );
    const idx = groupItems.findIndex(g => g.item_code === item.item_code);
    if (idx === -1) {
      await conn.rollback();
      return sendError(res, 404, 'Item not found in this template version');
    }
    const neighborIdx = body.direction === 'up' ? idx - 1 : idx + 1;
    if (neighborIdx < 0 || neighborIdx >= groupItems.length) {
      await conn.rollback();
      return sendError(res, 400, `Already at the ${body.direction === 'up' ? 'top' : 'bottom'} of this group`);
    }

    // Swap sort_order directly — no sentinel needed, sort_order carries no
    // uniqueness constraint (unlike the stage-number swap in reorderStage).
    const a = groupItems[idx];
    const b = groupItems[neighborIdx];
    await conn.execute('UPDATE template_checklist_items SET sort_order = ? WHERE id = ?', [b.sort_order, a.id]);
    await conn.execute('UPDATE template_checklist_items SET sort_order = ? WHERE id = ?', [a.sort_order, b.id]);

    await renumberPillarGroup(conn, targetVersionId, item.stage_number, item.pillar, techPrefix);

    await auditLog.log(conn, {
      userId: user.id, action: 'template_item_reordered',
      detail: { version_id: targetVersionId, stage_number: item.stage_number, pillar: item.pillar, direction: body.direction, forked },
    });

    await conn.commit();
    sendJSON(res, 200, { updated: true, forked, new_version_id: forked ? targetVersionId : null, new_version: newVersion });
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

// ---------------------------------------------------------------------------
// POST /api/templates/:versionId/fork
// Manually creates a new version as a fork of an existing one, immediately
// active (same fork-on-edit semantics as an in-place edit would trigger).
// Used when the admin wants to prepare a new active version proactively,
// without waiting for an edit to trigger it. NOT the same thing as
// publishDraft() below — this always forks a whole new version; that one
// just flips is_draft on a version that already exists.
// (Route used to be POST .../publish before the 2026-08-17 draft/publish
// feature claimed that name for something more literal.)
// ---------------------------------------------------------------------------
async function manualFork(req, res, params) {
  const user = await requireLogin(req, res);
  if (!user) return;
  if (!['admin','project_manager'].includes(user.system_role)) return sendError(res, 403, 'Forbidden');

  const versionId = parseInt(params.versionId, 10);
  if (!versionId) return sendError(res, 400, 'Invalid versionId');

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const fork = await forkVersion(conn, versionId, user.id);
    await auditLog.log(conn, {
      userId: user.id,
      action: 'template_version_created',
      detail: { source_version_id: versionId, new_version: fork.version, reason: 'manual_publish' },
    });
    await conn.commit();
    sendJSON(res, 201, { new_version_id: fork.id, new_version: fork.version });
  } catch (err) {
    await conn.rollback();
    if (err.message.includes('already exists')) return sendError(res, 409, err.message);
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * PATCH /api/templates/:versionId/publish
 * Publishes a draft: flips is_draft to 0 so it starts appearing in the
 * "+ New Project" template picker. Deliberately does NOT also set it
 * active — that stays the separate "Set as Active" action (owner's
 * explicit choice, 2026-08-17), so publishing a draft can never silently
 * swap out what new projects get by default.
 */
async function publishDraft(req, res, params) {
  const user = await requireLogin(req, res);
  if (!user) return;
  if (!['admin','project_manager'].includes(user.system_role)) return sendError(res, 403, 'Forbidden');

  const versionId = parseInt(params.versionId, 10);
  if (!versionId) return sendError(res, 400, 'Invalid versionId');

  const [[tv]] = await pool.execute(
    'SELECT id, version, name, technology, is_draft FROM template_versions WHERE id = ?', [versionId]
  );
  if (!tv) return sendError(res, 404, 'Template version not found');
  if (!tv.is_draft) return sendError(res, 400, 'This version is already published.');

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute('UPDATE template_versions SET is_draft = 0 WHERE id = ?', [versionId]);
    await auditLog.log(conn, {
      userId: user.id, action: 'template_draft_published',
      detail: { version_id: versionId, version: tv.version, name: tv.name, technology: tv.technology },
    });
    await conn.commit();
    sendJSON(res, 200, { published: true });
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

// ---------------------------------------------------------------------------
// Gate approver configuration — every stage (0–5) is admin-configurable.
//
// CHANGED 2026-08-17: Stages 2 and 3 used to be excluded here because their
// routing was governed by hardcoded CAPEX thresholds. That routing has been
// removed (see DOA_SPEC.md) — admins now configure every gate's approver
// chain the same way, trusted to follow NNEL's real FRP procedure themselves.
// ---------------------------------------------------------------------------
const GATE_AUTHORITY_VALUES = ['m1_nnpc','m2_evp','nnel_board','m3_md_nnel','slt_mtc','m4_ed_cam'];

/**
 * GET /api/templates/:versionId/gate-approvers
 * Returns the configured chains for all non-CAPEX stages.
 */
async function getGateApprovers(req, res, params) {
  const user = await requireLogin(req, res);
  if (!user) return;
  if (!['admin','project_manager'].includes(user.system_role)) return sendError(res, 403, 'Forbidden');

  const versionId = parseInt(params.versionId, 10);
  const [rows] = await pool.execute(
    `SELECT stage_number, chain_position, authority
     FROM template_gate_approvers
     WHERE template_version_id = ?
     ORDER BY stage_number, chain_position`,
    [versionId]
  );

  // Group by stage
  const byStage = {};
  rows.forEach(r => {
    if (!byStage[r.stage_number]) byStage[r.stage_number] = [];
    byStage[r.stage_number].push({ chain_position: r.chain_position, authority: r.authority });
  });
  sendJSON(res, 200, byStage);
}

/**
 * POST /api/templates/:versionId/gate-approvers
 * Adds or replaces the entire chain for one stage. Forks if projects use this version.
 * Body: { stage_number, chain: ['m4_ed_cam', 'm3_md_nnel'] }
 */
async function setGateApprovers(req, res, params) {
  const user = await requireLogin(req, res);
  if (!user) return;
  if (!['admin','project_manager'].includes(user.system_role)) return sendError(res, 403, 'Forbidden');

  const versionId = parseInt(params.versionId, 10);
  let body;
  try { body = await readBody(req); } catch { return sendError(res, 400, 'Invalid JSON'); }

  const { stage_number, chain } = body;
  if (!Array.isArray(chain) || chain.length === 0) {
    return sendError(res, 400, 'chain must be a non-empty array of authority values');
  }
  if (chain.some(a => !GATE_AUTHORITY_VALUES.includes(a))) {
    return sendError(res, 400, `Each chain entry must be one of: ${GATE_AUTHORITY_VALUES.join(', ')}`);
  }

  const [[tv]] = await pool.execute('SELECT id, version, is_immutable FROM template_versions WHERE id = ?', [versionId]);
  if (!tv) return sendError(res, 404, 'Template version not found');

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const { targetVersionId, forked, newVersion } = await forkIfNeeded(conn, tv, user.id, 'gate_approver_change');

    // Replace existing chain for this stage
    await conn.execute(
      'DELETE FROM template_gate_approvers WHERE template_version_id = ? AND stage_number = ?',
      [targetVersionId, stage_number]
    );
    for (let i = 0; i < chain.length; i++) {
      await conn.execute(
        'INSERT INTO template_gate_approvers (template_version_id, stage_number, chain_position, authority) VALUES (?,?,?,?)',
        [targetVersionId, stage_number, i + 1, chain[i]]
      );
    }
    await auditLog.log(conn, {
      userId: user.id, action: 'template_gate_approvers_updated',
      detail: { version_id: targetVersionId, stage_number, chain, forked },
    });
    await conn.commit();
    sendJSON(res, 200, { updated: true, forked, new_version_id: forked ? targetVersionId : null, new_version: newVersion });
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * PATCH /api/templates/:versionId/stages/:stage/status
 * Bulk-deactivates or restores every checklist item in a stage.
 * Follows the same version-fork rule as individual item edits.
 */
async function setStageStatus(req, res, params) {
  const user = await requireLogin(req, res);
  if (!user) return;
  if (!['admin','project_manager'].includes(user.system_role)) return sendError(res, 403, 'Forbidden');

  const versionId   = parseInt(params.versionId, 10);
  const stageNumber = parseInt(params.stage, 10);
  if (!versionId || isNaN(stageNumber)) return sendError(res, 400, 'Invalid ids');

  let body;
  try { body = await readBody(req); } catch { return sendError(res, 400, 'Invalid JSON'); }
  if (typeof body.is_active !== 'boolean') {
    return sendError(res, 400, 'is_active (boolean) is required');
  }

  const [[tv]] = await pool.execute(
    'SELECT id, version, is_immutable FROM template_versions WHERE id = ?', [versionId]
  );
  if (!tv) return sendError(res, 404, 'Template version not found');

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const { targetVersionId, forked, newVersion } = await forkIfNeeded(conn, tv, user.id, 'stage_status_change');

    await conn.execute(
      `UPDATE template_checklist_items SET is_active = ?
       WHERE template_version_id = ? AND stage_number = ?`,
      [body.is_active ? 1 : 0, targetVersionId, stageNumber]
    );

    await auditLog.log(conn, {
      userId: user.id, action: 'template_stage_status_changed',
      detail: { version_id: targetVersionId, stage_number: stageNumber, is_active: body.is_active, forked },
    });

    await conn.commit();
    sendJSON(res, 200, { updated: true, forked, new_version_id: forked ? targetVersionId : null, new_version: newVersion });
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * PATCH /api/templates/:versionId/stages/:stage/name
 * Renames a stage. Same fork-on-edit rule as every other template edit — if
 * the version has active projects, forks first and applies the rename to
 * the new version so existing projects keep seeing the name they started
 * with.
 */
async function renameStage(req, res, params) {
  const user = await requireLogin(req, res);
  if (!user) return;
  if (!['admin','project_manager'].includes(user.system_role)) return sendError(res, 403, 'Forbidden');

  const versionId   = parseInt(params.versionId, 10);
  const stageNumber = parseInt(params.stage, 10);
  if (!versionId || isNaN(stageNumber)) return sendError(res, 400, 'Invalid ids');

  let body;
  try { body = await readBody(req); } catch { return sendError(res, 400, 'Invalid JSON'); }
  const name = body.name?.trim();
  if (!name) return sendError(res, 400, 'name is required');
  if (name.length > 100) return sendError(res, 400, 'name must be 100 characters or fewer');

  const [[tv]] = await pool.execute('SELECT id, version, is_immutable FROM template_versions WHERE id = ?', [versionId]);
  if (!tv) return sendError(res, 404, 'Template version not found');

  const [[stageRow]] = await pool.execute(
    'SELECT id FROM template_stages WHERE template_version_id = ? AND stage_number = ?',
    [versionId, stageNumber]
  );
  if (!stageRow) return sendError(res, 404, 'Stage not found in this template version');

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const { targetVersionId, forked, newVersion } = await forkIfNeeded(conn, tv, user.id, 'stage_rename');

    await conn.execute(
      'UPDATE template_stages SET name = ? WHERE template_version_id = ? AND stage_number = ?',
      [name, targetVersionId, stageNumber]
    );

    await auditLog.log(conn, {
      userId: user.id, action: 'template_stage_renamed',
      detail: { version_id: targetVersionId, stage_number: stageNumber, name, forked },
    });

    await conn.commit();
    sendJSON(res, 200, { updated: true, forked, new_version_id: forked ? targetVersionId : null, new_version: newVersion });
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * POST /api/templates/:versionId/stages
 * Adds a new stage, appended after the highest existing stage_number — never
 * inserted mid-sequence, so existing stage numbers stay a stable anchor for
 * everything that already references them (checklist items, gate approvers,
 * and — for projects already using this version — project_stages,
 * gate_decisions, document_register). Body: { name }.
 * Same fork-on-edit rule: forks first if the version has active projects.
 */
async function addStage(req, res, params) {
  const user = await requireLogin(req, res);
  if (!user) return;
  if (!['admin','project_manager'].includes(user.system_role)) return sendError(res, 403, 'Forbidden');

  const versionId = parseInt(params.versionId, 10);
  if (!versionId) return sendError(res, 400, 'Invalid versionId');

  let body;
  try { body = await readBody(req); } catch { return sendError(res, 400, 'Invalid JSON'); }
  const name = body.name?.trim();
  if (!name) return sendError(res, 400, 'name is required');
  if (name.length > 100) return sendError(res, 400, 'name must be 100 characters or fewer');

  const [[tv]] = await pool.execute('SELECT id, version, is_immutable FROM template_versions WHERE id = ?', [versionId]);
  if (!tv) return sendError(res, 404, 'Template version not found');

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const { targetVersionId, forked, newVersion } = await forkIfNeeded(conn, tv, user.id, 'stage_added');

    const [[{ maxStage }]] = await conn.execute(
      'SELECT MAX(stage_number) AS maxStage FROM template_stages WHERE template_version_id = ?',
      [targetVersionId]
    );
    const nextStage = maxStage == null ? 0 : maxStage + 1;
    if (nextStage > MAX_STAGE_NUMBER) {
      await conn.rollback();
      return sendError(res, 400,
        `Cannot add another stage - this template already has the maximum of ${MAX_STAGE_NUMBER + 1} stages`);
    }

    await conn.execute(
      'INSERT INTO template_stages (template_version_id, stage_number, name) VALUES (?, ?, ?)',
      [targetVersionId, nextStage, name]
    );

    await auditLog.log(conn, {
      userId: user.id, action: 'template_stage_added',
      detail: { version_id: targetVersionId, stage_number: nextStage, name, forked },
    });

    await conn.commit();
    sendJSON(res, 201, { stage_number: nextStage, forked, new_version_id: forked ? targetVersionId : null, new_version: newVersion });
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * POST /api/templates/:versionId/stages/:stage/reorder
 * Body: { direction: 'up' | 'down' }
 *
 * Swaps this stage with its adjacent neighbour in the stage order. Follows
 * the same fork-on-edit rule as everything else — the swap always lands on
 * a version with zero projects using it (either it already had none, or the
 * fork just created a fresh one), so it can never renumber a stage that an
 * in-flight project's project_stages / gate_decisions / document_register
 * rows already reference by number. Those project-instance tables are never
 * touched by this endpoint — only the three template-scoped tables below.
 */
async function reorderStage(req, res, params) {
  const user = await requireLogin(req, res);
  if (!user) return;
  if (!['admin','project_manager'].includes(user.system_role)) return sendError(res, 403, 'Forbidden');

  const versionId   = parseInt(params.versionId, 10);
  const stageNumber = parseInt(params.stage, 10);
  if (!versionId || isNaN(stageNumber)) return sendError(res, 400, 'Invalid ids');

  let body;
  try { body = await readBody(req); } catch { return sendError(res, 400, 'Invalid JSON'); }
  if (!['up','down'].includes(body.direction)) {
    return sendError(res, 400, "direction must be 'up' or 'down'");
  }

  const [[tv]] = await pool.execute('SELECT id, version, is_immutable FROM template_versions WHERE id = ?', [versionId]);
  if (!tv) return sendError(res, 404, 'Template version not found');

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const { targetVersionId, forked, newVersion } = await forkIfNeeded(conn, tv, user.id, 'stage_reorder');

    const [stageRows] = await conn.execute(
      'SELECT stage_number FROM template_stages WHERE template_version_id = ? ORDER BY stage_number',
      [targetVersionId]
    );
    const numbers = stageRows.map(r => r.stage_number);
    const idx = numbers.indexOf(stageNumber);
    if (idx === -1) {
      await conn.rollback();
      return sendError(res, 404, 'Stage not found in this template version');
    }
    const neighborIdx = body.direction === 'up' ? idx - 1 : idx + 1;
    if (neighborIdx < 0 || neighborIdx >= numbers.length) {
      await conn.rollback();
      return sendError(res, 400,
        `Stage ${stageNumber} is already at the ${body.direction === 'up' ? 'top' : 'bottom'}`);
    }
    const a = stageNumber;
    const b = numbers[neighborIdx];

    // SECURITY NOTE re: table names interpolated below — these three strings
    // come from a fixed local array, never from request input, so this is
    // not a SQL-injection vector; every actual VALUE in these statements
    // still goes through a `?` placeholder. MySQL simply has no placeholder
    // syntax for identifiers (table/column names), so a literal table name
    // is the only way to run the same statement shape against all three
    // tables without hand-duplicating it three times.
    //
    // A direct two-step swap (a->b, b->a) would collide with each table's
    // own UNIQUE(template_version_id, stage_number, ...) constraint
    // mid-transaction, so this goes through a temporary sentinel value
    // instead: a -> SENTINEL -> (old b's slot), b -> a's old slot.
    // TINYINT UNSIGNED's max (255) is a safe sentinel — MAX_STAGE_NUMBER
    // (30) guarantees no real stage number will ever reach it.
    const SENTINEL = 255;
    const tables = ['template_stages', 'template_checklist_items', 'template_gate_approvers'];
    for (const table of tables) {
      await conn.execute(
        `UPDATE ${table} SET stage_number = ? WHERE template_version_id = ? AND stage_number = ?`,
        [SENTINEL, targetVersionId, a]
      );
      await conn.execute(
        `UPDATE ${table} SET stage_number = ? WHERE template_version_id = ? AND stage_number = ?`,
        [a, targetVersionId, b]
      );
      await conn.execute(
        `UPDATE ${table} SET stage_number = ? WHERE template_version_id = ? AND stage_number = ?`,
        [b, targetVersionId, SENTINEL]
      );
    }

    await auditLog.log(conn, {
      userId: user.id, action: 'template_stage_reordered',
      detail: { version_id: targetVersionId, swapped: [a, b], direction: body.direction, forked },
    });

    await conn.commit();
    sendJSON(res, 200, {
      updated: true, swapped: [a, b], forked,
      new_version_id: forked ? targetVersionId : null, new_version: newVersion,
    });
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * DELETE /api/templates/:versionId/gate-approvers/:stage
 * Clears the entire configured chain for a stage (reverts to system defaults).
 */
async function clearGateApprovers(req, res, params) {
  const user = await requireLogin(req, res);
  if (!user) return;
  if (!['admin','project_manager'].includes(user.system_role)) return sendError(res, 403, 'Forbidden');

  const versionId   = parseInt(params.versionId, 10);
  const stageNumber = parseInt(params.stage, 10);

  const [[tv]] = await pool.execute('SELECT id, version, is_immutable FROM template_versions WHERE id = ?', [versionId]);
  if (!tv) return sendError(res, 404, 'Template version not found');

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // This previously had no fork-on-edit check at all (pre-2026-08-18 gap —
    // clearing a chain on an in-use version applied straight to it, unlike
    // setGateApprovers). Fixed here as part of adding the immutable-standard
    // protection, since it's the same class of oversight.
    const { targetVersionId, forked, newVersion } = await forkIfNeeded(conn, tv, user.id, 'gate_approver_clear');

    await conn.execute(
      'DELETE FROM template_gate_approvers WHERE template_version_id = ? AND stage_number = ?',
      [targetVersionId, stageNumber]
    );
    await auditLog.log(conn, {
      userId: user.id, action: 'template_gate_approvers_cleared',
      detail: { version_id: targetVersionId, stage_number: stageNumber, forked },
    });
    await conn.commit();
    sendJSON(res, 200, { cleared: true, forked, new_version_id: forked ? targetVersionId : null, new_version: newVersion });
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * POST /api/templates
 * Creates a new named template version, either from scratch (empty items)
 * or as a copy of an existing version (source_version_id in body).
 * Body: { name, technology, source_version_id? }
 */
async function createVersion(req, res) {
  const user = await requireLogin(req, res);
  if (!user) return;
  if (!['admin','project_manager'].includes(user.system_role)) return sendError(res, 403, 'Forbidden');

  let body;
  try { body = await readBody(req); } catch { return sendError(res, 400, 'Invalid JSON'); }

  const { name, technology, source_version_id } = body;
  if (!name || !name.trim()) return sendError(res, 400, 'name is required');
  const VALID_TECHS = ['solar_pv','biofuels','abatement'];
  if (!VALID_TECHS.includes(technology)) {
    return sendError(res, 400, `technology must be one of: ${VALID_TECHS.join(', ')}`);
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    let newVersionId, newVersionStr;

    if (source_version_id) {
      // Fork an existing version with the provided name — a draft copy, not
      // the fork-on-edit safety fork: stays inactive, source untouched, only
      // becomes usable when explicitly published. Already inherits the
      // source's VDR folders (forkVersion clones them) so nothing further
      // to seed here.
      const fork = await forkVersion(conn, parseInt(source_version_id, 10), user.id, name.trim(), { asDraft: true });
      newVersionId  = fork.id;
      newVersionStr = fork.version;
    } else {
      // Create a fresh empty version
      const [[latest]] = await conn.execute(
        'SELECT version FROM template_versions WHERE technology = ? ORDER BY id DESC LIMIT 1',
        [technology]
      );
      // Derive a base version string: e.g. 'solar_pv' → 'solar-pv-1.0'
      const techBase = technology.replace(/_/g, '-');
      let baseVersion = latest ? bumpVersion(latest.version) : `${techBase}-1.0`;

      // Scan forward until we find a free slot
      for (let attempts = 0; attempts < 50; attempts++) {
        const [[exists]] = await conn.execute(
          'SELECT id FROM template_versions WHERE version = ?', [baseVersion]
        );
        if (!exists) break;
        baseVersion = bumpVersion(baseVersion);
      }

      const [result] = await conn.execute(
        `INSERT INTO template_versions (version, name, technology, is_active, is_draft, created_by)
         VALUES (?, ?, ?, 0, 1, ?)`,
        [baseVersion, name.trim(), technology, user.id]
      );
      newVersionId  = result.insertId;
      newVersionStr = baseVersion;

      // Seed the standard VDR folder set — see DEFAULT_VDR_FOLDERS comment.
      for (const f of DEFAULT_VDR_FOLDERS) {
        await conn.execute(
          'INSERT INTO template_vdr_folders (template_version_id, folder_code, name, sort_order) VALUES (?, ?, ?, ?)',
          [newVersionId, f.code, f.name, DEFAULT_VDR_FOLDERS.indexOf(f)]
        );
      }
    }

    await auditLog.log(conn, {
      userId: user.id, action: 'template_version_created',
      detail: { new_version_id: newVersionId, version: newVersionStr, name: name.trim(), technology, source_version_id: source_version_id || null, is_draft: true },
    });

    await conn.commit();
    sendJSON(res, 201, { id: newVersionId, version: newVersionStr, name: name.trim() });
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * PATCH /api/templates/:versionId/activate
 * Sets this version as the active template for its technology vertical.
 * Deactivates all other versions for the same technology.
 */
async function setActive(req, res, params) {
  const user = await requireLogin(req, res);
  if (!user) return;
  if (!['admin','project_manager'].includes(user.system_role)) return sendError(res, 403, 'Forbidden');

  const versionId = parseInt(params.versionId, 10);
  if (!versionId) return sendError(res, 400, 'Invalid versionId');

  const [[tv]] = await pool.execute(
    'SELECT id, version, technology, is_draft FROM template_versions WHERE id = ?', [versionId]
  );
  if (!tv) return sendError(res, 404, 'Template version not found');
  if (tv.is_draft) {
    return sendError(res, 409, 'This version is still a draft - publish it before setting it active.');
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute(
      'UPDATE template_versions SET is_active = 0 WHERE technology = ?', [tv.technology]
    );
    await conn.execute(
      'UPDATE template_versions SET is_active = 1 WHERE id = ?', [versionId]
    );
    await auditLog.log(conn, {
      userId: user.id, action: 'template_version_activated',
      detail: { version_id: versionId, version: tv.version, technology: tv.technology },
    });
    await conn.commit();
    sendJSON(res, 200, { activated: true });
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * DELETE /api/templates/:versionId
 * Permanently deletes a template version and all its items.
 *
 * Rules:
 *  - Admin can delete any version.
 *  - Project managers can only delete versions they created.
 *  - Blocked if any projects (active or otherwise) reference this version —
 *    deleting would orphan those projects' checklists.
 *  - The active version for its technology cannot be deleted (must deactivate
 *    another version as active first).
 */
async function deleteVersion(req, res, params) {
  const user = await requireLogin(req, res);
  if (!user) return;
  if (!['admin','project_manager'].includes(user.system_role)) {
    return sendError(res, 403, 'Forbidden');
  }

  const versionId = parseInt(params.versionId, 10);
  if (!versionId) return sendError(res, 400, 'Invalid versionId');

  const [[tv]] = await pool.execute(
    `SELECT tv.id, tv.version, tv.name, tv.technology, tv.is_active, tv.is_immutable, tv.created_by,
            u.full_name AS created_by_name
     FROM template_versions tv
     LEFT JOIN users u ON u.id = tv.created_by
     WHERE tv.id = ?`,
    [versionId]
  );
  if (!tv) return sendError(res, 404, 'Template version not found');

  // The three original standard templates can never be deleted, full stop —
  // regardless of active/project-count state (migration 027).
  if (tv.is_immutable) {
    return sendError(res, 409, 'This is one of the original standard templates and cannot be deleted.');
  }

  // SECURITY: PMs may only delete versions they created
  if (user.system_role === 'project_manager' && tv.created_by !== user.id) {
    return sendError(res, 403, 'You can only delete template versions you created');
  }

  // Block deletion of the active version
  if (tv.is_active) {
    return sendError(res, 409,
      'Cannot delete the active template version. Set another version as active first.');
  }

  // Block if any projects reference this version (active or completed)
  const [[{ projectCount }]] = await pool.execute(
    'SELECT COUNT(*) AS projectCount FROM projects WHERE template_version = ?',
    [tv.version]
  );
  if (Number(projectCount) > 0) {
    return sendError(res, 409,
      `Cannot delete: ${projectCount} project${projectCount > 1 ? 's' : ''} ` +
      `${projectCount > 1 ? 'are' : 'is'} using this template version.`
    );
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // Delete in dependency order. template_stages must be cleared here too —
    // it has a FOREIGN KEY on template_versions with no ON DELETE CASCADE, so
    // leaving it out (as this endpoint did until 2026-08-17) makes the final
    // DELETE below throw a constraint-violation 500 on any version that has
    // stages defined, which is now every version.
    await conn.execute(
      'DELETE FROM template_gate_approvers WHERE template_version_id = ?', [versionId]
    );
    await conn.execute(
      'DELETE FROM template_checklist_items WHERE template_version_id = ?', [versionId]
    );
    await conn.execute(
      'DELETE FROM template_vdr_folders WHERE template_version_id = ?', [versionId]
    );
    await conn.execute(
      'DELETE FROM template_stages WHERE template_version_id = ?', [versionId]
    );
    await conn.execute(
      'DELETE FROM template_versions WHERE id = ?', [versionId]
    );

    await auditLog.log(conn, {
      userId: user.id, action: 'template_version_deleted',
      detail: { version_id: versionId, version: tv.version, name: tv.name, technology: tv.technology },
    });

    await conn.commit();
    sendJSON(res, 200, { deleted: true });
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

module.exports = {
  listVersions, getActive, getItems, addItem, editItem, setItemStatus, setStageStatus,
  deleteItem, reorderItem, bulkDeleteItems,
  manualFork, publishDraft, createVersion, setActive, deleteVersion,
  getGateApprovers, setGateApprovers, clearGateApprovers,
  renameStage, addStage, reorderStage,
};
