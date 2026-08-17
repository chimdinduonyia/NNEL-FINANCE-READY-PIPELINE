'use strict';
/**
 * routes/templates.js — Template management
 *
 * GET    /api/templates                          — list all versions with project counts
 * GET    /api/templates/active                   — active version for a technology
 *                                                  (?technology=solar_pv|biofuels|abatement)
 * GET    /api/templates/:versionId/items         — items grouped by stage (admin)
 * POST   /api/templates/:versionId/items         — add a new item (admin)
 * PATCH  /api/templates/:versionId/items/:itemId — edit item; auto-forks if projects exist (admin)
 * PATCH  /api/templates/:versionId/items/:itemId/status — soft-deactivate/restore (admin)
 * POST   /api/templates/:versionId/publish       — manually fork to a new version (admin)
 *
 * VERSIONING RULE: an item edit on a version that has in-flight projects
 * always creates a new version (fork) rather than mutating the original.
 * Only new projects pick up the updated version. Existing projects keep
 * their locked template_version string unchanged.
 */

const pool     = require('../db');
const { requireLogin } = require('../middleware/auth');
const { sendJSON, sendError } = require('../utils/response');
const { readBody }            = require('../utils/bodyParser');
const auditLog = require('../services/auditLog');
const { MAX_STAGE_NUMBER } = require('../constants');

const VALID_PILLARS = ['technical','commercial','finance','legal','environmental','risk','esg'];

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
// ---------------------------------------------------------------------------
// name is optional — if omitted the bumped version string is used as the name
async function forkVersion(conn, sourceVersionId, userId, nameOverride = null) {
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

  // Create new version row; mark it active and retire the old version
  const [result] = await conn.execute(
    `INSERT INTO template_versions (version, name, technology, description, is_active, created_by)
     VALUES (?, ?, ?, ?, 1, ?)`,
    [newVersionStr, newName, src.technology, src.description, userId]
  );
  const newVersionId = result.insertId;

  await conn.execute(
    'UPDATE template_versions SET is_active = 0 WHERE id = ?',
    [sourceVersionId]
  );

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
// GET /api/templates
// ---------------------------------------------------------------------------
async function listVersions(req, res) {
  const user = await requireLogin(req, res);
  if (!user) return;
  if (!['admin','project_manager'].includes(user.system_role)) return sendError(res, 403, 'Forbidden');

  const [rows] = await pool.execute(
    `SELECT tv.id, tv.version, tv.name, tv.technology, tv.description, tv.is_active,
            tv.created_at, tv.created_by, u.full_name AS created_by_name,
            (SELECT COUNT(*) FROM projects p
             WHERE p.template_version = tv.version
               AND p.status NOT IN ('completed','cancelled')) AS project_count
     FROM template_versions tv
     LEFT JOIN users u ON u.id = tv.created_by
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
    'SELECT id, version, technology, description, is_active FROM template_versions WHERE id = ?',
    [versionId]
  );
  if (!tv) return sendError(res, 404, 'Template version not found');

  const [items] = await pool.execute(
    `SELECT id, stage_number, pillar, item_code, description, guidance,
            is_mandatory, sort_order, is_active
     FROM template_checklist_items
     WHERE template_version_id = ?
     ORDER BY stage_number, sort_order, item_code`,
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
    project_count: cnt,
    next_version:  bumpVersion(tv.version),
    stages:        Object.values(byStage),
  });
}

// ---------------------------------------------------------------------------
// POST /api/templates/:versionId/items
// Adds a new checklist item. Always modifies in-place on the specified
// version (adding new items to an in-use version is safe — existing
// stage_checklist rows are unaffected; only new project initialisations
// will pick up the new item).
// ---------------------------------------------------------------------------
async function addItem(req, res, params) {
  const user = await requireLogin(req, res);
  if (!user) return;
  if (!['admin','project_manager'].includes(user.system_role)) return sendError(res, 403, 'Forbidden');

  const versionId = parseInt(params.versionId, 10);
  if (!versionId) return sendError(res, 400, 'Invalid versionId');

  let body;
  try { body = await readBody(req); } catch { return sendError(res, 400, 'Invalid JSON'); }

  const { stage_number, pillar, item_code, description, guidance, is_mandatory, sort_order } = body;

  if (!Number.isInteger(Number(stage_number)) || stage_number < 0 || stage_number > MAX_STAGE_NUMBER) {
    return sendError(res, 400, `stage_number (0–${MAX_STAGE_NUMBER}) is required`);
  }
  if (!VALID_PILLARS.includes(pillar)) {
    return sendError(res, 400, `pillar must be one of: ${VALID_PILLARS.join(', ')}`);
  }
  if (!item_code || !description) {
    return sendError(res, 400, 'item_code and description are required');
  }

  // Confirm the version exists
  const [[tv]] = await pool.execute(
    'SELECT version FROM template_versions WHERE id = ?', [versionId]
  );
  if (!tv) return sendError(res, 404, 'Template version not found');

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [result] = await conn.execute(
      `INSERT INTO template_checklist_items
         (template_version_id, stage_number, pillar, item_code, description,
          guidance, is_mandatory, sort_order, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      [versionId, stage_number, pillar, item_code.trim(),
       description.trim(), guidance || null,
       is_mandatory !== false ? 1 : 0,
       sort_order ?? 0]
    );
    await auditLog.log(conn, {
      userId: user.id,
      action: 'template_item_added',
      detail: { version_id: versionId, version: tv.version, item_code: item_code.trim() },
    });
    await conn.commit();
    sendJSON(res, 201, { id: result.insertId, item_code: item_code.trim() });
  } catch (err) {
    await conn.rollback();
    if (err.code === 'ER_DUP_ENTRY') {
      return sendError(res, 409, `Item code '${item_code}' already exists in this template version`);
    }
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
    'SELECT version FROM template_versions WHERE id = ?', [versionId]
  );

  const cnt = await projectCount(tv.version);

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    let targetVersionId = versionId;
    let forked = false;
    let newVersion = null;

    if (cnt > 0) {
      // Fork: create a new version, apply the edit there
      const fork = await forkVersion(conn, versionId, user.id);
      targetVersionId = fork.id;
      newVersion      = fork.version;
      forked          = true;

      await auditLog.log(conn, {
        userId: user.id,
        action: 'template_version_created',
        detail: { source_version_id: versionId, source_version: tv.version, new_version: newVersion, reason: 'edit_with_active_projects' },
      });
    }

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
    'SELECT version FROM template_versions WHERE id = ?', [versionId]
  );

  const cnt = await projectCount(tv.version);

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    let targetVersionId = versionId;
    let forked = false;
    let newVersion = null;

    if (cnt > 0) {
      const fork = await forkVersion(conn, versionId, user.id);
      targetVersionId = fork.id;
      newVersion      = fork.version;
      forked          = true;
      await auditLog.log(conn, {
        userId: user.id,
        action: 'template_version_created',
        detail: { source_version_id: versionId, source_version: tv.version, new_version: newVersion, reason: 'status_change_with_active_projects' },
      });
    }

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

// ---------------------------------------------------------------------------
// POST /api/templates/:versionId/publish
// Manually creates a new version as a fork of an existing one.
// Used when the admin wants to prepare a new version proactively.
// ---------------------------------------------------------------------------
async function publishVersion(req, res, params) {
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

  const [[tv]] = await pool.execute('SELECT version FROM template_versions WHERE id = ?', [versionId]);
  if (!tv) return sendError(res, 404, 'Template version not found');

  const cnt = await projectCount(tv.version);

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    let targetVersionId = versionId;
    let forked = false;

    if (cnt > 0) {
      const fork = await forkVersion(conn, versionId, user.id);
      targetVersionId = fork.id;
      forked = true;
      await auditLog.log(conn, {
        userId: user.id, action: 'template_version_created',
        detail: { reason: 'gate_approver_change', new_version: fork.version },
      });
    }

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
    sendJSON(res, 200, { updated: true, forked, new_version_id: forked ? targetVersionId : null });
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
    'SELECT version FROM template_versions WHERE id = ?', [versionId]
  );
  if (!tv) return sendError(res, 404, 'Template version not found');

  const cnt = await projectCount(tv.version);
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    let targetVersionId = versionId;
    let forked = false;
    let newVersion = null;

    if (cnt > 0) {
      const fork = await forkVersion(conn, versionId, user.id);
      targetVersionId = fork.id;
      newVersion      = fork.version;
      forked          = true;
      await auditLog.log(conn, {
        userId: user.id, action: 'template_version_created',
        detail: { reason: 'stage_status_change', new_version: newVersion },
      });
    }

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

  const [[tv]] = await pool.execute('SELECT version FROM template_versions WHERE id = ?', [versionId]);
  if (!tv) return sendError(res, 404, 'Template version not found');

  const [[stageRow]] = await pool.execute(
    'SELECT id FROM template_stages WHERE template_version_id = ? AND stage_number = ?',
    [versionId, stageNumber]
  );
  if (!stageRow) return sendError(res, 404, 'Stage not found in this template version');

  const cnt = await projectCount(tv.version);
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    let targetVersionId = versionId;
    let forked = false;
    let newVersion = null;

    if (cnt > 0) {
      const fork = await forkVersion(conn, versionId, user.id);
      targetVersionId = fork.id;
      newVersion      = fork.version;
      forked          = true;
      await auditLog.log(conn, {
        userId: user.id, action: 'template_version_created',
        detail: { reason: 'stage_rename', new_version: newVersion },
      });
    }

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

  const [[tv]] = await pool.execute('SELECT version FROM template_versions WHERE id = ?', [versionId]);
  if (!tv) return sendError(res, 404, 'Template version not found');

  const cnt = await projectCount(tv.version);
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    let targetVersionId = versionId;
    let forked = false;
    let newVersion = null;

    if (cnt > 0) {
      const fork = await forkVersion(conn, versionId, user.id);
      targetVersionId = fork.id;
      newVersion      = fork.version;
      forked          = true;
      await auditLog.log(conn, {
        userId: user.id, action: 'template_version_created',
        detail: { reason: 'stage_added', new_version: newVersion },
      });
    }

    const [[{ maxStage }]] = await conn.execute(
      'SELECT MAX(stage_number) AS maxStage FROM template_stages WHERE template_version_id = ?',
      [targetVersionId]
    );
    const nextStage = maxStage == null ? 0 : maxStage + 1;
    if (nextStage > MAX_STAGE_NUMBER) {
      await conn.rollback();
      return sendError(res, 400,
        `Cannot add another stage — this template already has the maximum of ${MAX_STAGE_NUMBER + 1} stages`);
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

  const [[tv]] = await pool.execute('SELECT version FROM template_versions WHERE id = ?', [versionId]);
  if (!tv) return sendError(res, 404, 'Template version not found');

  const cnt = await projectCount(tv.version);
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    let targetVersionId = versionId;
    let forked = false;
    let newVersion = null;

    if (cnt > 0) {
      const fork = await forkVersion(conn, versionId, user.id);
      targetVersionId = fork.id;
      newVersion      = fork.version;
      forked          = true;
      await auditLog.log(conn, {
        userId: user.id, action: 'template_version_created',
        detail: { reason: 'stage_reorder', new_version: newVersion },
      });
    }

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

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute(
      'DELETE FROM template_gate_approvers WHERE template_version_id = ? AND stage_number = ?',
      [versionId, stageNumber]
    );
    await auditLog.log(conn, {
      userId: user.id, action: 'template_gate_approvers_cleared',
      detail: { version_id: versionId, stage_number: stageNumber },
    });
    await conn.commit();
    sendJSON(res, 200, { cleared: true });
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
      // Fork an existing version with the provided name
      const fork = await forkVersion(conn, parseInt(source_version_id, 10), user.id, name.trim());
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
        `INSERT INTO template_versions (version, name, technology, is_active, created_by)
         VALUES (?, ?, ?, 0, ?)`,
        [baseVersion, name.trim(), technology, user.id]
      );
      newVersionId  = result.insertId;
      newVersionStr = baseVersion;
    }

    await auditLog.log(conn, {
      userId: user.id, action: 'template_version_created',
      detail: { new_version_id: newVersionId, version: newVersionStr, name: name.trim(), technology, source_version_id: source_version_id || null },
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
    'SELECT id, version, technology FROM template_versions WHERE id = ?', [versionId]
  );
  if (!tv) return sendError(res, 404, 'Template version not found');

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
    `SELECT tv.id, tv.version, tv.name, tv.technology, tv.is_active, tv.created_by,
            u.full_name AS created_by_name
     FROM template_versions tv
     LEFT JOIN users u ON u.id = tv.created_by
     WHERE tv.id = ?`,
    [versionId]
  );
  if (!tv) return sendError(res, 404, 'Template version not found');

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

    // Delete in dependency order
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
  publishVersion, createVersion, setActive, deleteVersion,
  getGateApprovers, setGateApprovers, clearGateApprovers,
  renameStage, addStage, reorderStage,
};
