/* templates.js - Template Editor page (admin only) */
'use strict';

const PILLAR_OPTIONS = [
  { value:'technical',    label:'Technical' },
  { value:'commercial',   label:'Commercial' },
  { value:'finance',      label:'Finance' },
  { value:'legal',        label:'Legal' },
  { value:'esg',          label:'ESG' },
  { value:'environmental',label:'Environmental (legacy)' },
  { value:'risk',         label:'Risk (legacy)' },
];
const PILLAR_LABEL = Object.fromEntries(PILLAR_OPTIONS.map(p => [p.value, p.label]));

let activeTech      = 'solar_pv';
let activeVersionId = null; // which version is open in the editor
let templateData    = null; // current GET /api/templates/:id/items response
let gateConfig      = {};   // { stageNumber: [{chain_position, authority}, …] }
let editingItemId   = null;
let editingStageNum = null; // stage_number currently being renamed inline, or null
let currentUser     = null;
let allVersions     = [];   // all template versions (refreshed on loadTemplate)
let currentTechVersions = []; // versions for the active tech, as last rendered - 
                               // see renderTemplate()'s techVersions param default
const expandedAddItemPanels   = new Set(); // stage_numbers with "+ Add item" panel open
const expandedGateChainPanels = new Set(); // stage_numbers with "Gate Approver Chain" panel open
const selectedItemIds = new Set(); // checklist item ids currently checked for bulk delete

// Small icon set for item-row actions - kept here rather than api.icons
// since these are specific to this editor (eye/eye-off for disable/restore,
// bin for delete, pencil for edit - all icons now, was three text buttons).
const ICON_EYE = `<svg width="15" height="15" viewBox="0 0 15 15" fill="none"><path d="M1 7.5S3.5 3 7.5 3s6.5 4.5 6.5 4.5-2.5 4.5-6.5 4.5S1 7.5 1 7.5Z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><circle cx="7.5" cy="7.5" r="2" stroke="currentColor" stroke-width="1.3"/></svg>`;
const ICON_EYE_OFF = `<svg width="15" height="15" viewBox="0 0 15 15" fill="none"><path d="M1 7.5S3.5 3 7.5 3s6.5 4.5 6.5 4.5-2.5 4.5-6.5 4.5S1 7.5 1 7.5Z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><circle cx="7.5" cy="7.5" r="2" stroke="currentColor" stroke-width="1.3"/><line x1="2" y1="13" x2="13" y2="2" stroke="currentColor" stroke-width="1.3" stroke-linecap="square"/></svg>`;
const ICON_TRASH = `<svg width="13" height="13" viewBox="0 0 13 13" fill="none" style="vertical-align:middle;"><rect x="1" y="3" width="11" height="1.5" fill="currentColor" rx="0.5"/><rect x="4.5" y="1" width="4" height="1.5" fill="currentColor" rx="0.5"/><path d="M2.5 4.5L3 11.5H10L10.5 4.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="square" fill="none"/><line x1="6.5" y1="6" x2="6.5" y2="10" stroke="currentColor" stroke-width="1.3" stroke-linecap="square"/><line x1="4.5" y1="6" x2="4.5" y2="10" stroke="currentColor" stroke-width="1.3" stroke-linecap="square"/><line x1="8.5" y1="6" x2="8.5" y2="10" stroke="currentColor" stroke-width="1.3" stroke-linecap="square"/></svg>`;
const ICON_PENCIL = `<svg width="13" height="13" viewBox="0 0 14 14" fill="none"><path d="M9.5 2 12 4.5 5 11.5 2 12l.5-3L9.5 2Z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
const ICON_CHEVRON = `<svg width="12" height="12" viewBox="0 0 14 14" fill="none" class="chevron-icon"><polyline points="3.5,5.5 7,9 10.5,5.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="square" stroke-linejoin="miter"/></svg>`;

// Looks up a stage's current name from the loaded template data.
function stageNameOf(stageNumber) {
  return templateData?.stages?.find(s => s.stage_number === stageNumber)?.stage_name ?? `Stage ${stageNumber}`;
}

const GATE_AUTH_OPTIONS = [
  { value: 'm1_nnpc',    label: 'M1: NNPC Group' },
  { value: 'm2_evp',     label: 'M2: EVP' },
  { value: 'nnel_board', label: 'NNEL Board' },
  { value: 'm3_md_nnel', label: 'M3: MD-NNEL' },
  { value: 'slt_mtc',    label: 'SLT-MTC' },
  { value: 'm4_ed_cam',  label: 'M4: ED-CAM' },
];
const GATE_AUTH_LABEL = Object.fromEntries(GATE_AUTH_OPTIONS.map(a => [a.value, a.label]));
// CHANGED 2026-08-17: CAPEX-threshold routing removed (see DOA_SPEC.md) - every
// stage 0-5 is now an admin-configurable gate-approver chain, same as the rest.

document.addEventListener('DOMContentLoaded', async () => {
  currentUser = await api.getMe();
  if (!currentUser) return;
  if (!['admin','project_manager'].includes(currentUser.system_role)) { window.location.href = '/'; return; }

  api.initSidebar(currentUser);

  // Tech tab switcher
  document.getElementById('tech-tabs').addEventListener('click', e => {
    const tab = e.target.closest('.template-tab');
    if (!tab) return;
    document.querySelectorAll('.template-tab').forEach(t => t.classList.toggle('active', t === tab));
    activeTech = tab.dataset.tech;
    loadTemplate();
  });

  loadTemplate();
});

// ---------------------------------------------------------------------------
// loadTemplate - fetches version list for the active technology, renders the
// version history panel, then opens the active version (or the last selected).
async function loadTemplate() {
  const el = document.getElementById('template-content');
  el.innerHTML = '<div class="loading">Loading…</div>';
  editingItemId = null;

  try { allVersions = await api.get('/api/templates'); }
  catch (err) { el.innerHTML = `<div class="error-msg">${api.fmt.escape(err.message)}</div>`; return; }

  const techVersions = allVersions.filter(v => v.technology === activeTech);

  // Default to the active version, or the first available
  const defaultVersion = techVersions.find(v => v.is_active) || techVersions[0];
  if (!defaultVersion) {
    el.innerHTML = `<div class="empty">No templates found for this vertical. Create one below.</div>
      ${renderCreateVersionBtn()}`;
    wireCreateVersionBtn(el);
    return;
  }

  // If the previously-open version is still in this technology, keep it open
  const openId = (activeVersionId && techVersions.find(v => v.id === activeVersionId))
    ? activeVersionId
    : defaultVersion.id;

  await loadVersion(openId, el, techVersions);
}

// Refreshes the editor after a mutation, without the full-page reload/
// flicker that re-fetching the whole version list (loadTemplate) causes.
// Most edits (save an item, toggle a status, reorder, gate-chain changes)
// stay on the same version - loadVersion(activeVersionId) re-fetches just
// that version's items/gate-config, reusing the already-cached version list
// instead of hitting GET /api/templates again. Only a genuine fork (a new
// version was just created to protect in-flight projects) needs the fuller
// loadTemplate(), since the sidebar's version list itself changed.
async function reload(result) {
  if (result?.forked) {
    activeVersionId = result.new_version_id;
    await loadTemplate();
  } else {
    await loadVersion(activeVersionId);
  }
}

// Picks the right explanation for why a fork just happened, based on the
// version that was open when the action was taken (call this BEFORE
// reload() swaps templateData out for the new one). Two independent
// triggers for a fork - see forkIfNeeded() server-side.
function forkReasonText() {
  return templateData?.is_immutable
    ? "created as a new draft, since this is a standard template that can't be edited directly"
    : 'created to protect existing projects using it';
}

async function loadVersion(versionId, el, techVersions) {
  if (!el) el = document.getElementById('template-content');
  if (!techVersions) {
    techVersions = allVersions.filter(v => v.technology === activeTech);
  }
  activeVersionId = versionId;
  editingItemId = null;
  editingStageNum = null;

  try { templateData = await api.get(`/api/templates/${versionId}/items`); }
  catch (err) { el.innerHTML = `<div class="error-msg">${api.fmt.escape(err.message)}</div>`; return; }

  try {
    const gc = await api.get(`/api/templates/${versionId}/gate-approvers`);
    gateConfig = gc ?? {};
  } catch { gateConfig = {}; }

  currentTechVersions = techVersions;
  renderTemplate(el, techVersions);
}

function renderCreateVersionBtn() {
  return `<div style="margin-top:16px;">
    <button class="btn btn-primary btn-sm" id="create-version-btn">+ Create New Template Version</button>
  </div>`;
}

function wireCreateVersionBtn(el) {
  el.querySelector('#create-version-btn')?.addEventListener('click', openCreateVersionModal);
}

// ---------------------------------------------------------------------------
// techVersions defaults to the last-loaded list (currentTechVersions) rather
// than an empty array - several call sites re-render after a purely local
// UI change (cancel an inline edit, close a row) and don't have a fresh
// version list handy. Passing [] there used to blank the whole Version
// History pane even though nothing about the versions actually changed.
function renderTemplate(el, techVersions = currentTechVersions) {
  const d = templateData;
  const hasProjects = d.project_count > 0;

  const bannerClass = d.is_immutable ? 'immutable' : d.is_draft ? 'draft' : (hasProjects ? 'warn' : 'safe');
  const bannerMsg   = d.is_immutable
    ? `<strong>🔒 Standard template</strong> - this original version can't be edited directly. Any change
       (add, edit, delete, reorder) creates a new draft automatically, leaving this one untouched.`
    : d.is_draft
    ? `<strong>Draft</strong> - not visible in the "+ New Project" template picker yet. Make all the changes you
       need, then publish when it's ready.`
    : hasProjects
    ? `<strong>${d.project_count} active project${d.project_count > 1 ? 's' : ''}</strong> using <strong>${api.fmt.escape(d.name || d.version)}</strong>.
       Saving any change will create a new version. Existing projects are unaffected.`
    : `<strong>${api.fmt.escape(d.name || d.version)}</strong> · No active projects yet. Changes apply directly to this version.`;

  // Global Publish button, top right of the whole page - only while a draft
  // is open. Publishing only makes it selectable (see DRAFT/PUBLISH note in
  // server/routes/templates.js) - it does not also set it active.
  const headerActionsEl = document.getElementById('editor-header-actions');
  if (headerActionsEl) {
    headerActionsEl.innerHTML = d.is_draft
      ? `<button class="btn btn-primary" id="publish-draft-btn">Publish</button>`
      : '';
    headerActionsEl.querySelector('#publish-draft-btn')?.addEventListener('click', handlePublishDraft);
  }

  // Version history panel - drafts and published versions grouped under
  // their own headings, so it's obvious at a glance which versions are
  // still work-in-progress (no "Publish" button shows for anything already
  // published - including versions that predate the draft/publish feature
  // and were backfilled to published so nothing already in use disappeared).
  const drafts    = techVersions.filter(v => v.is_draft);
  const published = techVersions.filter(v => !v.is_draft);
  const versionHistory =
    (drafts.length ? `<div class="version-history-group-heading">Drafts</div>${drafts.map(renderVersionRow).join('')}` : '') +
    (published.length ? `<div class="version-history-group-heading">Published</div>${published.map(renderVersionRow).join('')}` : '');

  function renderVersionRow(v) {
    const isOpen   = v.id === activeVersionId;
    const isActive = v.is_active;

    // Bin icon: visible to the creator of this version, or to any admin.
    // Never shown for an immutable standard template — server always
    // rejects deleting one, so don't offer a button that can only error.
    // Active versions are blocked server-side too - shown here but the modal
    // will display the server's error if they attempt to delete an active version.
    const canDelete = !v.is_immutable && (
      currentUser?.system_role === 'admin' ||
      (currentUser?.system_role === 'project_manager' && v.created_by === currentUser?.id));

    const binSvg = `<svg width="13" height="13" viewBox="0 0 13 13" fill="none" style="vertical-align:middle;">
      <rect x="1" y="3" width="11" height="1.5" fill="currentColor" rx="0.5"/>
      <rect x="4.5" y="1" width="4" height="1.5" fill="currentColor" rx="0.5"/>
      <path d="M2.5 4.5L3 11.5H10L10.5 4.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="square" fill="none"/>
      <line x1="6.5" y1="6" x2="6.5" y2="10" stroke="currentColor" stroke-width="1.3" stroke-linecap="square"/>
      <line x1="4.5" y1="6" x2="4.5" y2="10" stroke="currentColor" stroke-width="1.3" stroke-linecap="square"/>
      <line x1="8.5" y1="6" x2="8.5" y2="10" stroke="currentColor" stroke-width="1.3" stroke-linecap="square"/>
    </svg>`;

    return `<div class="version-history-item ${isOpen ? 'open' : ''}" data-vid="${v.id}"
               style="padding:10px 14px;cursor:pointer;border-bottom:1px solid var(--border);
                      ${isOpen ? 'background:var(--green-50);border-left:3px solid var(--green-700);' : 'border-left:3px solid transparent;'}">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:4px;">
        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;flex:1;min-width:0;">
          <span style="font-weight:700;font-size:13px;">${api.fmt.escape(v.name || v.version)}</span>
          ${v.is_immutable ? '<span class="badge badge-blue" style="font-size:10px;" title="Original standard template - edits fork a new draft">🔒 Standard</span>' : ''}
          ${v.is_draft ? '<span class="badge badge-amber" style="font-size:10px;">Draft</span>' : ''}
          ${isActive ? '<span class="badge badge-green" style="font-size:10px;">Active</span>' : ''}
          ${isOpen   ? '<span class="badge badge-blue" style="font-size:10px;">Editing</span>' : ''}
        </div>
        ${canDelete ? `<button class="btn btn-ghost btn-sm delete-version-btn"
          data-vid="${v.id}" data-vname="${api.fmt.escape(v.name || v.version)}"
          style="color:var(--red-700);padding:2px 5px;flex-shrink:0;" title="Delete this version">${binSvg}</button>` : ''}
      </div>
      <div style="font-size:11px;color:var(--text-muted);margin-top:3px;">
        v${api.fmt.escape(v.version)} · Created by ${api.fmt.escape(v.created_by_name || '?')} · ${api.fmt.date(v.created_at)}
        · ${v.project_count} project${v.project_count !== 1 ? 's' : ''}
      </div>
      ${!isActive && !v.is_draft ? `<button class="btn btn-ghost btn-sm set-active-btn" data-vid="${v.id}"
         style="margin-top:6px;font-size:11px;color:var(--green-700);">Set as Active</button>` : ''}
      ${v.is_draft ? `<span class="text-muted text-sm" style="display:block;margin-top:6px;font-size:11px;">Publish to make selectable</span>` : ''}
    </div>`;
  }

  const stageNumbers = d.stages.map(s => s.stage_number);
  const stagesHtml = d.stages.map((s, i) =>
    renderStage(s, gateConfig[s.stage_number] ?? [], i === 0, i === d.stages.length - 1)
  ).join('');

  // Prune any selected ids that no longer exist in the freshly-loaded data
  // (e.g. after a delete/reorder elsewhere), so the bulk-action bar's count
  // never lags reality.
  const allItemIds = new Set(d.stages.flatMap(s => s.items.map(i => i.id)));
  for (const id of selectedItemIds) { if (!allItemIds.has(id)) selectedItemIds.delete(id); }

  const bulkBarHtml = selectedItemIds.size > 0 ? `
    <div class="flex items-center justify-between" style="background:var(--gray-900);color:#fff;padding:10px 16px;border-radius:var(--radius);margin-bottom:16px;">
      <span style="font-size:13px;font-weight:600;">${selectedItemIds.size} item${selectedItemIds.size > 1 ? 's' : ''} selected</span>
      <div class="flex gap-8">
        <button class="btn btn-ghost btn-sm" id="bulk-clear-btn" style="color:#fff;">Clear</button>
        <button class="btn btn-danger btn-sm" id="bulk-delete-btn">Delete Selected</button>
      </div>
    </div>` : '';

  el.innerHTML = `
    <div style="display:grid;grid-template-columns:260px 1fr;gap:0;align-items:start;">
      <div style="border-right:1px solid var(--border);min-height:400px;">
        <div style="padding:12px 14px;border-bottom:2px solid var(--border);display:flex;align-items:center;justify-content:space-between;">
          <strong style="font-size:13px;">Version History</strong>
          <button class="btn btn-primary btn-sm" id="create-version-btn" style="font-size:11px;padding:4px 10px;">+ New</button>
        </div>
        ${versionHistory || '<div style="padding:16px;font-size:13px;color:var(--text-muted);">No versions yet.</div>'}
      </div>
      <div style="padding:0 0 0 20px;">
        <div class="version-banner ${bannerClass}" style="margin-bottom:16px;">ℹ️ ${bannerMsg}</div>
        ${bulkBarHtml}
    ${stagesHtml}
        <div style="margin:16px 0 24px;">
          <button class="btn btn-ghost btn-sm" id="add-stage-btn">+ Add Stage</button>
          <span class="text-muted text-sm" style="margin-left:8px;">
            Appended after Stage ${stageNumbers[stageNumbers.length - 1] ?? 0} - stage numbers stay a stable
            anchor, so a new stage always goes at the end (reorder it afterwards if needed).
          </span>
        </div>
      </div>
    </div>`;

  // Wire up version history clicks
  el.querySelectorAll('.version-history-item').forEach(item => {
    item.addEventListener('click', e => {
      if (e.target.closest('button')) return;
      loadVersion(parseInt(item.dataset.vid, 10));
    });
  });

  // Wire up delete-version bin buttons
  el.querySelectorAll('.delete-version-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation(); // don't open the version in editor
      openDeleteVersionModal(parseInt(btn.dataset.vid, 10), btn.dataset.vname);
    });
  });

  // Wire up Set Active buttons
  el.querySelectorAll('.set-active-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Set this as the active template? New projects will use this version.')) return;
      btn.disabled = true;
      try {
        await api.patch(`/api/templates/${btn.dataset.vid}/activate`, {});
        await loadTemplate();
      } catch (err) {
        alert('Error: ' + err.message);
        btn.disabled = false;
      }
    });
  });

  // Wire up + New version button
  el.querySelector('#create-version-btn')?.addEventListener('click', openCreateVersionModal);

  // Wire up accordions (click anywhere on header except buttons/inputs - 
  // the rename control lives inside the header, so a click to edit the
  // title must not also toggle the section open/closed)
  el.querySelectorAll('.stage-header').forEach(h => {
    h.addEventListener('click', e => {
      if (e.target.closest('button') || e.target.closest('input')) return;
      const body = h.nextElementSibling;
      body.classList.toggle('hidden');
    });
  });

  // Wire up stage deactivate/restore buttons
  el.querySelectorAll('.stage-status-btn').forEach(btn => {
    btn.addEventListener('click', () => handleStageStatus(btn));
  });

  // Wire up stage rename controls
  el.querySelectorAll('.stage-name-edit-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      editingStageNum = parseInt(btn.dataset.stage, 10);
      renderTemplate(el);
      // innerHTML-injected `autofocus` is unreliable across browsers - focus explicitly
      el.querySelector(`.stage-name-input[data-stage="${editingStageNum}"]`)?.focus();
    });
  });
  el.querySelectorAll('.stage-name-cancel').forEach(btn => {
    btn.addEventListener('click', () => {
      editingStageNum = null;
      renderTemplate(el);
    });
  });
  el.querySelectorAll('.stage-name-save').forEach(btn => {
    btn.addEventListener('click', () => handleRenameStage(parseInt(btn.dataset.stage, 10)));
  });
  el.querySelectorAll('.stage-name-input').forEach(input => {
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); handleRenameStage(parseInt(input.dataset.stage, 10)); }
      if (e.key === 'Escape') { editingStageNum = null; renderTemplate(el); }
    });
  });

  // Wire up stage reorder (^v) buttons
  el.querySelectorAll('.stage-reorder-btn').forEach(btn => {
    btn.addEventListener('click', () => handleReorderStage(btn));
  });

  // Wire up + Add Stage button
  el.querySelector('#add-stage-btn')?.addEventListener('click', openAddStageModal);

  // Wire up all item-level buttons
  el.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', e => handleAction(e.currentTarget));
  });

  // Wire up item reorder (^v) buttons
  el.querySelectorAll('.item-reorder-btn').forEach(btn => {
    btn.addEventListener('click', () => reorderItem(parseInt(btn.dataset.itemId, 10), btn.dataset.dir));
  });

  // Wire up multi-select: per-item checkboxes, per-stage "select all", and
  // the bulk-action bar's Clear/Delete buttons.
  el.querySelectorAll('.item-select-cb').forEach(cb => {
    cb.addEventListener('change', () => {
      const id = parseInt(cb.dataset.itemId, 10);
      if (cb.checked) selectedItemIds.add(id); else selectedItemIds.delete(id);
      renderTemplate(el);
    });
  });
  el.querySelectorAll('.select-all-in-stage').forEach(cb => {
    cb.addEventListener('change', () => {
      const stageNum = parseInt(cb.dataset.stage, 10);
      const stage = templateData.stages.find(s => s.stage_number === stageNum);
      (stage?.items ?? []).filter(i => i.is_active).forEach(i => {
        if (cb.checked) selectedItemIds.add(i.id); else selectedItemIds.delete(i.id);
      });
      renderTemplate(el);
    });
  });
  el.querySelector('#bulk-clear-btn')?.addEventListener('click', () => {
    selectedItemIds.clear();
    renderTemplate(el);
  });
  el.querySelector('#bulk-delete-btn')?.addEventListener('click', handleBulkDelete);

  // Wire up the "+ Add item to Stage X" / "Gate Approver Chain" collapsible
  // headers - toggle open state, remember it per stage so it survives the
  // next lightweight reload().
  el.querySelectorAll('.add-item-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const stageNum = parseInt(btn.dataset.panelId.replace('add-item-', ''), 10);
      if (expandedAddItemPanels.has(stageNum)) expandedAddItemPanels.delete(stageNum);
      else expandedAddItemPanels.add(stageNum);
      renderTemplate(el);
    });
  });
  el.querySelectorAll('.gate-chain-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const stageNum = parseInt(btn.dataset.panelId.replace('gate-chain-', ''), 10);
      if (expandedGateChainPanels.has(stageNum)) expandedGateChainPanels.delete(stageNum);
      else expandedGateChainPanels.add(stageNum);
      renderTemplate(el);
    });
  });

  // Wire up add-item forms
  el.querySelectorAll('.add-item-form').forEach(form => {
    form.addEventListener('submit', e => handleAddItem(e));
  });

  // Wire up gate-chain controls
  el.querySelectorAll('.gate-add-btn').forEach(btn => {
    btn.addEventListener('click', () => handleGateAdd(btn));
  });
  el.querySelectorAll('.gate-remove-btn').forEach(btn => {
    btn.addEventListener('click', () => handleGateRemove(btn));
  });
  el.querySelectorAll('.gate-clear-btn').forEach(btn => {
    btn.addEventListener('click', () => handleGateClear(btn));
  });
}

// ---------------------------------------------------------------------------
function renderStage(stage, chain = [], isFirst = false, isLast = false) {
  const activeItems   = stage.items.filter(i => i.is_active);
  const inactiveItems = stage.items.filter(i => !i.is_active);
  const allItems      = [...activeItems, ...inactiveItems];

  // Reorder (^v) is scoped to each item's own (stage, pillar) group - item
  // codes renumber within that group, not across the whole stage - so
  // first/last-in-group has to be computed per pillar, not per stage.
  const groupPositions = {}; // item.id -> { isFirstInGroup, isLastInGroup }
  const byPillarForOrder = {};
  allItems.forEach(item => {
    (byPillarForOrder[item.pillar] ??= []).push(item);
  });
  Object.values(byPillarForOrder).forEach(group => {
    group.forEach((item, i) => {
      groupPositions[item.id] = { isFirstInGroup: i === 0, isLastInGroup: i === group.length - 1 };
    });
  });

  const rowsHtml = allItems.map(item =>
    renderItemRow(item, groupPositions[item.id])
  ).join('');

  const pillarOpts = PILLAR_OPTIONS.map(p =>
    `<option value="${p.value}">${p.label}</option>`).join('');

  const stageActive = activeItems.length > 0;
  const stageBtn = stageActive
    ? `<button class="btn btn-ghost btn-sm stage-status-btn"
         data-stage="${stage.stage_number}" data-active="true"
         style="color:var(--red-700);border-color:var(--red-100);"
         title="Deactivate all items in this stage">Deactivate Stage</button>`
    : `<button class="btn btn-ghost btn-sm stage-status-btn"
         data-stage="${stage.stage_number}" data-active="false"
         style="color:var(--green-700);border-color:var(--green-100);"
         title="Restore all items in this stage">Restore Stage</button>`;

  const deactivatedBanner = !stageActive && allItems.length > 0
    ? `<div style="display:flex;align-items:center;gap:10px;padding:10px 14px;
                   background:var(--red-100);border-bottom:1px solid #fca5a5;">
        <span class="badge badge-red">Stage Deactivated</span>
        <span style="font-size:12px;color:var(--red-700);">
          All ${allItems.length} item${allItems.length !== 1 ? 's' : ''} in this stage ${allItems.length !== 1 ? 'have' : 'has'} been disabled.
          New projects will skip this stage gate. Click "Restore Stage" to re-enable.
        </span>
      </div>`
    : '';

  const isEditingName = editingStageNum === stage.stage_number;
  const reorderBtns = `<span class="stage-reorder-btns" style="display:inline-flex;flex-direction:column;gap:1px;margin-right:8px;vertical-align:middle;">
    <button class="btn btn-ghost btn-sm stage-reorder-btn" data-stage="${stage.stage_number}" data-dir="up"
      ${isFirst ? 'disabled' : ''} title="Move Stage ${stage.stage_number} up"
      style="padding:0 4px;line-height:1;font-size:9px;${isFirst ? 'opacity:.3;' : ''}">▲</button>
    <button class="btn btn-ghost btn-sm stage-reorder-btn" data-stage="${stage.stage_number}" data-dir="down"
      ${isLast ? 'disabled' : ''} title="Move Stage ${stage.stage_number} down"
      style="padding:0 4px;line-height:1;font-size:9px;${isLast ? 'opacity:.3;' : ''}">▼</button>
  </span>`;

  const titleBlock = isEditingName
    ? `<span style="display:flex;align-items:center;gap:6px;flex:1;min-width:0;">
        <span style="font-size:13px;font-weight:700;white-space:nowrap;">Stage ${stage.stage_number}:</span>
        <input type="text" class="stage-name-input" data-stage="${stage.stage_number}"
          value="${api.fmt.escape(stage.stage_name)}" maxlength="100" autofocus
          style="font-size:14px;font-weight:700;padding:4px 8px;flex:1;min-width:0;max-width:340px;">
        <button class="btn btn-primary btn-sm stage-name-save" data-stage="${stage.stage_number}">Save</button>
        <button class="btn btn-ghost btn-sm stage-name-cancel">Cancel</button>
      </span>`
    : `<span style="display:flex;align-items:center;gap:6px;min-width:0;">
        <h3 style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">Stage ${stage.stage_number}: ${api.fmt.escape(stage.stage_name)}</h3>
        <button class="btn btn-ghost btn-sm stage-name-edit-btn" data-stage="${stage.stage_number}"
          title="Rename this stage" style="padding:2px 6px;color:var(--text-muted);flex-shrink:0;">✎</button>
      </span>`;

  return `<div class="stage-section">
    <div class="stage-header">
      <div style="display:flex;align-items:center;min-width:0;flex:1;">
        ${reorderBtns}
        ${titleBlock}
      </div>
      <div style="display:flex;align-items:center;gap:12px;flex-shrink:0;">
        <span class="stage-count">${activeItems.length} active · ${inactiveItems.length} inactive</span>
        ${stageBtn}
      </div>
    </div>
    ${deactivatedBanner}
    <div class="stage-body">
      <div style="display:grid;grid-template-columns:22px 34px 100px 1fr 90px 68px 96px;gap:8px;padding:8px 12px;background:var(--gray-50);border-bottom:1px solid var(--border);font-size:11px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.04em;">
        <div><input type="checkbox" class="select-all-in-stage" data-stage="${stage.stage_number}" title="Select all in Stage ${stage.stage_number}" style="width:auto;margin:0;"></div><div></div><div>Code</div><div>Description</div><div>Pillar</div><div>Mandatory</div><div>Actions</div>
      </div>
      ${rowsHtml || '<div style="padding:16px;color:var(--text-muted);font-size:13px;">No items yet.</div>'}
    </div>

    ${renderCollapsiblePanel({
      id: `add-item-${stage.stage_number}`,
      title: `+ Add item to Stage ${stage.stage_number}`,
      expanded: expandedAddItemPanels.has(stage.stage_number),
      toggleClass: 'add-item-toggle',
      bodyClass: 'add-item-panel',
      body: `
      <form class="add-item-form" data-stage="${stage.stage_number}">
        <div class="add-item-grid">
          <div class="form-group">
            <label>Description *</label>
            <input type="text" name="description" required placeholder="Checklist item text…">
          </div>
          <div class="form-group">
            <label>Pillar *</label>
            <select name="pillar">${pillarOpts}</select>
          </div>
          <div class="form-group">
            <label>Mandatory</label>
            <select name="is_mandatory">
              <option value="1">Yes</option>
              <option value="0">No</option>
            </select>
          </div>
        </div>
        <div class="form-group mt-8">
          <label>Guidance text</label>
          <input type="text" name="guidance" placeholder="Optional: detailed instructions shown to the project team">
        </div>
        <div class="form-hint mt-8">Item code is generated automatically (stage + pillar + serial number).</div>
        <div class="add-item-error error-msg hidden mt-8"></div>
        <button type="submit" class="btn btn-primary btn-sm mt-8">Add Item</button>
      </form>`,
    })}

    ${renderCollapsiblePanel({
      id: `gate-chain-${stage.stage_number}`,
      title: `${api.icons.chainLink} Gate Approver Chain`,
      subtitle: `who signs off at Stage ${stage.stage_number} (in order)`,
      expanded: expandedGateChainPanels.has(stage.stage_number),
      toggleClass: 'gate-chain-toggle',
      bodyClass: 'gate-chain-config',
      body: renderGateChainSection(stage.stage_number, chain),
    })}
  </div>`;
}

// ---------------------------------------------------------------------------
// Shared collapsible-section shell used for "+ Add item to Stage X" and
// "Gate Approver Chain" - click the header to expand/collapse. State is
// tracked per-stage in expandedAddItemPanels/expandedGateChainPanels (see
// top of file) so it survives the lightweight reload() after a save.
// ---------------------------------------------------------------------------
function renderCollapsiblePanel({ id, title, subtitle = '', expanded, toggleClass, bodyClass, body }) {
  return `<div class="collapsible-panel">
    <button type="button" class="collapsible-toggle ${toggleClass}" data-panel-id="${id}"
      style="width:100%;display:flex;align-items:center;justify-content:space-between;gap:8px;
             padding:10px 14px;background:var(--gray-50);border:1px solid var(--border);
             ${expanded ? 'border-bottom:none;' : 'border-radius:0 0 var(--radius) var(--radius);'}
             cursor:pointer;font-family:inherit;text-align:left;">
      <span style="font-size:13px;font-weight:700;color:var(--gray-900);">
        ${title}${subtitle ? `<span class="text-muted" style="font-size:12px;font-weight:400;margin-left:6px;">${subtitle}</span>` : ''}
      </span>
      <span style="display:inline-flex;transition:transform .15s;${expanded ? 'transform:rotate(180deg);' : ''}">${ICON_CHEVRON}</span>
    </button>
    <div class="${bodyClass} ${expanded ? '' : 'hidden'}" style="border-radius:0 0 var(--radius) var(--radius);">${body}</div>
  </div>`;
}

// ---------------------------------------------------------------------------
function renderItemRow(item, groupPos = { isFirstInGroup: true, isLastInGroup: true }) {
  const isEditing = editingItemId === item.id;
  const inactive  = !item.is_active;
  const cls = ['item-row', inactive ? 'inactive' : '', isEditing ? 'editing' : ''].filter(Boolean).join(' ');

  if (isEditing) {
    const pillarOpts = PILLAR_OPTIONS.map(p =>
      `<option value="${p.value}" ${p.value === item.pillar ? 'selected' : ''}>${p.label}</option>`
    ).join('');

    return `<div class="${cls}" data-item-id="${item.id}">
      <div></div>
      <div></div>
      <div class="item-code">${api.fmt.escape(item.item_code)}</div>
      <div>
        <input type="text" id="edit-desc-${item.id}" value="${api.fmt.escape(item.description)}" style="width:100%;margin-bottom:4px;">
        <input type="text" id="edit-guid-${item.id}" value="${api.fmt.escape(item.guidance ?? '')}" placeholder="Guidance (optional)" style="width:100%;font-size:11px;">
      </div>
      <select id="edit-pillar-${item.id}">${pillarOpts}</select>
      <select id="edit-mand-${item.id}">
        <option value="1" ${item.is_mandatory ? 'selected' : ''}>Yes</option>
        <option value="0" ${!item.is_mandatory ? 'selected' : ''}>No</option>
      </select>
      <div class="item-actions">
        <button class="btn btn-primary btn-sm" data-action="save" data-item-id="${item.id}">Save</button>
        <button class="btn btn-ghost btn-sm" data-action="cancel" data-item-id="${item.id}">Cancel</button>
      </div>
    </div>`;
  }

  const pillarLabel = PILLAR_LABEL[item.pillar] ?? item.pillar;
  const mandBadge   = item.is_mandatory
    ? '<span class="badge badge-green" style="font-size:10px;">Yes</span>'
    : '<span class="badge badge-gray"  style="font-size:10px;">No</span>';

  const descHtml = inactive
    ? `<span style="text-decoration:line-through;color:var(--text-muted);">${api.fmt.escape(item.description)}</span>
       <span class="badge badge-red" style="font-size:10px;margin-left:6px;vertical-align:middle;">Disabled</span>`
    : api.fmt.escape(item.description);

  const reorderBtns = `<span style="display:inline-flex;flex-direction:column;gap:1px;">
    <button class="btn btn-ghost btn-sm item-reorder-btn" data-item-id="${item.id}" data-dir="up"
      ${groupPos.isFirstInGroup ? 'disabled' : ''} title="Move up within ${pillarLabel}"
      style="padding:0 4px;line-height:1;font-size:9px;${groupPos.isFirstInGroup ? 'opacity:.3;' : ''}">▲</button>
    <button class="btn btn-ghost btn-sm item-reorder-btn" data-item-id="${item.id}" data-dir="down"
      ${groupPos.isLastInGroup ? 'disabled' : ''} title="Move down within ${pillarLabel}"
      style="padding:0 4px;line-height:1;font-size:9px;${groupPos.isLastInGroup ? 'opacity:.3;' : ''}">▼</button>
  </span>`;

  const canSelect = item.is_active; // disabled items can't be bulk-deleted anyway once used; keep the checkbox scoped to active rows for simplicity
  return `<div class="${cls}" data-item-id="${item.id}">
    <div>${canSelect ? `<input type="checkbox" class="item-select-cb" data-item-id="${item.id}" ${selectedItemIds.has(item.id) ? 'checked' : ''} style="width:auto;margin:0;">` : ''}</div>
    <div>${reorderBtns}</div>
    <div class="item-code">${api.fmt.escape(item.item_code)}</div>
    <div class="item-desc" title="${api.fmt.escape(item.guidance ?? '')}">${descHtml}</div>
    <div class="text-sm text-muted">${inactive ? '-' : pillarLabel}</div>
    <div>${inactive ? '' : mandBadge}</div>
    <div class="item-actions">
      ${item.is_active ? `<button class="btn btn-ghost btn-sm" data-action="edit" data-item-id="${item.id}" title="Edit">${ICON_PENCIL}</button>` : ''}
      <button class="btn btn-ghost btn-sm" data-action="${item.is_active ? 'deactivate' : 'restore'}" data-item-id="${item.id}"
        title="${item.is_active ? 'Disable' : 'Restore'}"
        style="color:${item.is_active ? 'var(--red-700)' : 'var(--green-700)'};">${item.is_active ? ICON_EYE : ICON_EYE_OFF}</button>
      <button class="btn btn-ghost btn-sm" data-action="delete" data-item-id="${item.id}" title="Delete permanently"
        style="color:var(--red-700);">${ICON_TRASH}</button>
    </div>
  </div>`;
}

// ---------------------------------------------------------------------------
function handleAction(btn) {
  const { action, itemId } = btn.dataset;
  const id = parseInt(itemId, 10);

  switch (action) {
    case 'edit':       startEdit(id); break;
    case 'cancel':     cancelEdit(); break;
    case 'save':       saveEdit(id); break;
    case 'deactivate': setItemStatus(id, false); break;
    case 'restore':    setItemStatus(id, true);  break;
    case 'delete':     deleteItem(id); break;
  }
}

function startEdit(itemId) {
  editingItemId = itemId;
  renderTemplate(document.getElementById('template-content'));
  // Scroll the editing row into view
  document.querySelector(`[data-item-id="${itemId}"].editing`)?.scrollIntoView({ block:'nearest' });
}

function cancelEdit() {
  editingItemId = null;
  renderTemplate(document.getElementById('template-content'));
}

async function saveEdit(itemId) {
  const description = document.getElementById(`edit-desc-${itemId}`)?.value?.trim();
  const guidance    = document.getElementById(`edit-guid-${itemId}`)?.value?.trim() || null;
  const pillar      = document.getElementById(`edit-pillar-${itemId}`)?.value;
  const is_mandatory= document.getElementById(`edit-mand-${itemId}`)?.value === '1';

  if (!description) { alert('Description is required.'); return; }

  // Find the version_id from templateData
  const versionId = templateData.version_id;

  const saveBtn = document.querySelector(`[data-action="save"][data-item-id="${itemId}"]`);
  if (saveBtn) saveBtn.disabled = true;

  try {
    const result = await api.patch(
      `/api/templates/${versionId}/items/${itemId}`,
      { description, guidance, pillar, is_mandatory }
    );
    editingItemId = null;

    if (result.forked) {
      // Version was bumped - reload to show new version
      alert(`Saved. New version ${result.new_version} ${forkReasonText()}.`);
    }
    await reload(result);
  } catch (err) {
    alert('Error: ' + err.message);
    if (saveBtn) saveBtn.disabled = false;
  }
}

// ---------------------------------------------------------------------------
// Create Version modal
// ---------------------------------------------------------------------------
function openDeleteVersionModal(versionId, versionName) {
  document.getElementById('dv-modal')?.remove();

  const modal = document.createElement('div');
  modal.id = 'dv-modal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:300;display:flex;align-items:center;justify-content:center;padding:24px;';
  modal.innerHTML = `
    <div class="card" style="width:100%;max-width:440px;">
      <div class="card-header" style="background:var(--red-700);">
        <h3 style="color:#fff;">Delete Template Version</h3>
        <button class="btn btn-ghost btn-sm" id="dv-close" style="color:#fff;">✕</button>
      </div>
      <div class="card-body" style="display:flex;flex-direction:column;gap:16px;">
        <p style="font-size:14px;">You are about to permanently delete <strong>${api.fmt.escape(versionName)}</strong>
          and all its checklist items. This cannot be undone.</p>
        <p style="font-size:13px;color:var(--text-muted);">This will be blocked if any projects are currently using this version.</p>
        <p class="text-sm text-muted">Type <strong>DELETE</strong> below to confirm:</p>
        <input type="text" id="dv-confirm" placeholder="Type DELETE here" autocomplete="off"
          style="border:2px solid var(--border);border-radius:var(--radius);padding:9px 12px;font-size:14px;width:100%;">
        <div id="dv-error" class="error-msg hidden"></div>
        <div class="flex gap-8" style="justify-content:flex-end;">
          <button class="btn btn-ghost" id="dv-cancel">Cancel</button>
          <button class="btn btn-danger" id="dv-delete" disabled>Delete Version</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(modal);

  const confirmInput = modal.querySelector('#dv-confirm');
  const deleteBtn    = modal.querySelector('#dv-delete');
  const errEl        = modal.querySelector('#dv-error');
  const close        = () => modal.remove();

  modal.querySelector('#dv-close').addEventListener('click', close);
  modal.querySelector('#dv-cancel').addEventListener('click', close);
  // Deliberately no click-outside-closes-modal: dragging to select text in
  // a textarea and releasing past the modal's edge used to register as
  // "clicked outside" and silently discard the form.

  confirmInput.addEventListener('input', () => {
    deleteBtn.disabled = confirmInput.value !== 'DELETE';
  });

  deleteBtn.addEventListener('click', async () => {
    if (confirmInput.value !== 'DELETE') return;
    errEl.classList.add('hidden');
    deleteBtn.disabled = true;
    try {
      await api.delete(`/api/templates/${versionId}`);
      close();
      // If the deleted version was open in the editor, clear it
      if (activeVersionId === versionId) activeVersionId = null;
      await loadTemplate();
    } catch (err) {
      errEl.textContent = err.message;
      errEl.classList.remove('hidden');
      deleteBtn.disabled = false;
    }
  });
}

function openCreateVersionModal() {
  // Remove any existing modal
  document.getElementById('cv-modal')?.remove();

  const TECH_LABELS = { solar_pv: 'Solar PV', biofuels: 'Biofuels', abatement: 'Abatement' };
  const techVersions = allVersions.filter(v => v.technology === activeTech);
  const sourceOpts = techVersions.map(v =>
    `<option value="${v.id}">${api.fmt.escape(v.name || v.version)}</option>`
  ).join('');

  const modal = document.createElement('div');
  modal.id = 'cv-modal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:300;display:flex;align-items:center;justify-content:center;padding:24px;';
  modal.innerHTML = `
    <div class="card" style="width:100%;max-width:460px;">
      <div class="card-header">
        <h3>Create New Template Version: ${TECH_LABELS[activeTech] || activeTech}</h3>
        <button class="btn btn-ghost btn-sm" id="cv-close">✕</button>
      </div>
      <div class="card-body">
        <div class="form-group">
          <label>Version Name *</label>
          <input type="text" id="cv-name" placeholder="e.g. Solar PV: Nigeria Grid 2026" style="width:100%;">
          <div class="form-hint">A human-readable label shown in the version history and project picker.</div>
        </div>
        <div class="form-group">
          <label>Copy items from</label>
          <select id="cv-source" style="width:100%;">
            <option value="">Start empty</option>
            ${sourceOpts}
          </select>
          <div class="form-hint">If selected, all checklist items from that version are copied into the new one.</div>
        </div>
        <div id="cv-error" class="error-msg hidden"></div>
        <div class="flex gap-8" style="margin-top:16px;">
          <button class="btn btn-primary" id="cv-submit">Create Version</button>
          <button class="btn btn-ghost" id="cv-cancel">Cancel</button>
        </div>
      </div>
    </div>`;

  document.body.appendChild(modal);

  const close = () => modal.remove();
  modal.querySelector('#cv-close').addEventListener('click', close);
  modal.querySelector('#cv-cancel').addEventListener('click', close);
  // Deliberately no click-outside-closes-modal: dragging to select text in
  // a textarea and releasing past the modal's edge used to register as
  // "clicked outside" and silently discard the form.

  modal.querySelector('#cv-submit').addEventListener('click', async () => {
    const name      = document.getElementById('cv-name').value.trim();
    const sourceId  = document.getElementById('cv-source').value;
    const errEl     = document.getElementById('cv-error');
    errEl.classList.add('hidden');

    if (!name) { errEl.textContent = 'Version name is required.'; errEl.classList.remove('hidden'); return; }

    const submitBtn = modal.querySelector('#cv-submit');
    submitBtn.disabled = true;
    try {
      const result = await api.post('/api/templates', {
        name,
        technology: activeTech,
        source_version_id: sourceId ? parseInt(sourceId, 10) : undefined,
      });
      close();
      activeVersionId = result.id;
      await loadTemplate();
    } catch (err) {
      errEl.textContent = err.message;
      errEl.classList.remove('hidden');
      submitBtn.disabled = false;
    }
  });
}

async function handleStageStatus(btn) {
  const stageNum   = parseInt(btn.dataset.stage, 10);
  const currentlyActive = btn.dataset.active === 'true';
  const verb = currentlyActive ? 'Deactivate' : 'Restore';
  const stageName = stageNameOf(stageNum);

  if (!confirm(`${verb} all checklist items in Stage ${stageNum}: ${stageName}?\n\nThis affects all items in this stage.`)) return;

  btn.disabled = true;
  const versionId = templateData.version_id;
  try {
    const result = await api.patch(
      `/api/templates/${versionId}/stages/${stageNum}/status`,
      { is_active: !currentlyActive }
    );
    if (result.forked) {
      alert(`Done. A new version (${result.new_version}) has been created to preserve existing projects.`);
    }
    await reload(result);
  } catch (err) {
    alert('Error: ' + err.message);
    btn.disabled = false;
  }
}

async function handlePublishDraft() {
  if (!confirm(
    'Publish this draft?\n\nIt will become selectable in the "+ New Project" template picker. ' +
    'It will NOT automatically become the active/default template for this vertical - use ' +
    '"Set as Active" separately if you want that.'
  )) return;

  const btn = document.getElementById('publish-draft-btn');
  if (btn) btn.disabled = true;
  try {
    await api.patch(`/api/templates/${templateData.version_id}/publish`, {});
    await loadTemplate();
  } catch (err) {
    alert('Could not publish: ' + err.message);
    if (btn) btn.disabled = false;
  }
}

// ---------------------------------------------------------------------------
// Stage rename / add / reorder
// ---------------------------------------------------------------------------

async function handleRenameStage(stageNum) {
  const input = document.querySelector(`.stage-name-input[data-stage="${stageNum}"]`);
  const name = input?.value?.trim();
  if (!name) { alert('Stage name cannot be empty.'); return; }

  const saveBtn = document.querySelector(`.stage-name-save[data-stage="${stageNum}"]`);
  if (saveBtn) saveBtn.disabled = true;

  const versionId = templateData.version_id;
  try {
    const result = await api.patch(`/api/templates/${versionId}/stages/${stageNum}/name`, { name });
    editingStageNum = null;
    if (result.forked) {
      alert(`Saved. New version ${result.new_version} ${forkReasonText()}.`);
    }
    await reload(result);
  } catch (err) {
    alert('Error: ' + err.message);
    if (saveBtn) saveBtn.disabled = false;
  }
}

function openAddStageModal() {
  document.getElementById('as-modal')?.remove();

  const modal = document.createElement('div');
  modal.id = 'as-modal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:300;display:flex;align-items:center;justify-content:center;padding:24px;';
  const nextStageNum = (templateData.stages[templateData.stages.length - 1]?.stage_number ?? -1) + 1;
  modal.innerHTML = `
    <div class="card" style="width:100%;max-width:420px;">
      <div class="card-header">
        <h3>Add Stage ${nextStageNum}</h3>
        <button class="btn btn-ghost btn-sm" id="as-close">✕</button>
      </div>
      <div class="card-body">
        <p class="text-sm text-muted" style="margin-bottom:12px;">
          Appended after the last stage. Reorder it afterwards with the ▲▼ buttons if it belongs earlier.
        </p>
        <div class="form-group">
          <label>Stage Name *</label>
          <input type="text" id="as-name" maxlength="100" placeholder="e.g. Community Engagement" style="width:100%;" autofocus>
        </div>
        <div id="as-error" class="error-msg hidden"></div>
        <div class="flex gap-8" style="margin-top:16px;">
          <button class="btn btn-primary" id="as-submit">Add Stage</button>
          <button class="btn btn-ghost" id="as-cancel">Cancel</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(modal);
  modal.querySelector('#as-name').focus();

  const close = () => modal.remove();
  modal.querySelector('#as-close').addEventListener('click', close);
  modal.querySelector('#as-cancel').addEventListener('click', close);

  const submit = async () => {
    const name = document.getElementById('as-name').value.trim();
    const errEl = document.getElementById('as-error');
    errEl.classList.add('hidden');
    if (!name) { errEl.textContent = 'Stage name is required.'; errEl.classList.remove('hidden'); return; }

    const submitBtn = modal.querySelector('#as-submit');
    submitBtn.disabled = true;
    try {
      const result = await api.post(`/api/templates/${templateData.version_id}/stages`, { name });
      close();
      if (result.forked) {
        alert(`Added. New version ${result.new_version} ${forkReasonText()}.`);
      }
      await reload(result);
    } catch (err) {
      errEl.textContent = err.message;
      errEl.classList.remove('hidden');
      submitBtn.disabled = false;
    }
  };
  modal.querySelector('#as-submit').addEventListener('click', submit);
  modal.querySelector('#as-name').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
}

async function handleReorderStage(btn) {
  const stageNum = parseInt(btn.dataset.stage, 10);
  const direction = btn.dataset.dir;
  btn.disabled = true;
  const versionId = templateData.version_id;
  try {
    const result = await api.post(`/api/templates/${versionId}/stages/${stageNum}/reorder`, { direction });
    if (result.forked) {
      alert(`Reordered. New version ${result.new_version} ${forkReasonText()}.`);
    }
    await reload(result);
  } catch (err) {
    alert('Error: ' + err.message);
    btn.disabled = false;
  }
}

async function setItemStatus(itemId, isActive) {
  const verb = isActive ? 'restore' : 'deactivate';
  if (!confirm(`${verb.charAt(0).toUpperCase() + verb.slice(1)} this item?`)) return;

  const versionId = templateData.version_id;
  try {
    const result = await api.patch(
      `/api/templates/${versionId}/items/${itemId}/status`,
      { is_active: isActive }
    );
    if (result.forked) {
      alert(`Done. New version ${result.new_version} ${forkReasonText()}.`);
    }
    await reload(result);
  } catch (err) {
    alert('Error: ' + err.message);
  }
}

async function deleteItem(itemId) {
  if (!confirm('Permanently delete this checklist item? This cannot be undone. (Items already used by a project can only be disabled, not deleted.)')) return;

  const versionId = templateData.version_id;
  try {
    const result = await api.delete(`/api/templates/${versionId}/items/${itemId}`);
    if (result.forked) {
      alert(`Done. New version ${result.new_version} ${forkReasonText()}.`);
    }
    await reload(result);
  } catch (err) {
    alert('Could not delete: ' + err.message);
  }
}

async function reorderItem(itemId, direction) {
  const versionId = templateData.version_id;
  try {
    const result = await api.post(`/api/templates/${versionId}/items/${itemId}/reorder`, { direction });
    if (result.forked) {
      alert(`Reordered. New version ${result.new_version} ${forkReasonText()}.`);
    }
    await reload(result);
  } catch (err) {
    alert('Could not reorder: ' + err.message);
  }
}

async function handleBulkDelete() {
  const ids = [...selectedItemIds];
  if (ids.length === 0) return;
  if (!confirm(
    `Permanently delete ${ids.length} selected item${ids.length > 1 ? 's' : ''}? This cannot be undone. ` +
    `(If any of them have already been used by a project, none will be deleted - disable those instead.)`
  )) return;

  const btn = document.getElementById('bulk-delete-btn');
  if (btn) btn.disabled = true;
  try {
    const result = await api.post(`/api/templates/${templateData.version_id}/items/bulk-delete`, { item_ids: ids });
    if (result.forked) {
      alert(`Deleted ${result.count} items. New version ${result.new_version} ${forkReasonText()}.`);
    }
    selectedItemIds.clear();
    await reload(result);
  } catch (err) {
    alert('Could not delete selected items: ' + err.message);
    if (btn) btn.disabled = false;
  }
}

async function handleAddItem(e) {
  e.preventDefault();
  const form        = e.target;
  const errEl       = form.querySelector('.add-item-error');
  errEl.classList.add('hidden');

  const stageNumber = parseInt(form.dataset.stage, 10);
  const description = form.elements.description.value.trim();
  const pillar      = form.elements.pillar.value;
  const is_mandatory= form.elements.is_mandatory.value === '1';
  const guidance    = form.elements.guidance.value.trim() || null;

  if (!description) {
    errEl.textContent = 'Description is required.';
    errEl.classList.remove('hidden');
    return;
  }

  const btn = form.querySelector('button[type=submit]');
  btn.disabled = true;
  try {
    const result = await api.post(`/api/templates/${templateData.version_id}/items`, {
      stage_number: stageNumber, description, guidance, pillar, is_mandatory,
    });
    if (result.forked) {
      alert(`Added. A new draft (${result.new_version}) has been created since this is a standard template - it can't be edited directly.`);
    }
    expandedAddItemPanels.add(stageNumber); // keep the panel open - they may add another
    await reload(result);
  } catch (err) {
    errEl.textContent = err.message;
    errEl.classList.remove('hidden');
    btn.disabled = false;
  }
}

// ===========================================================================
// GATE APPROVER CHAIN CONFIGURATION
// ===========================================================================

function renderGateChainSection(stageNum, chain) {
  const chainHtml = chain.length > 0
    ? chain.map((entry, i) => `
        <span style="display:inline-flex;align-items:center;gap:4px;">
          <span class="badge badge-blue" style="font-size:12px;">${GATE_AUTH_LABEL[entry.authority] ?? entry.authority}</span>
          <button class="gate-remove-btn" data-stage="${stageNum}" data-pos="${entry.chain_position}"
            style="background:none;border:none;cursor:pointer;color:var(--red-700);font-size:12px;padding:0 2px;"
            title="Remove from chain">✕</button>
          ${i < chain.length - 1 ? '<span style="color:var(--text-muted);margin:0 2px;">→</span>' : ''}
        </span>`).join('')
    : `<span class="text-muted text-sm" style="font-style:italic;">
        No chain configured. Using system default for Stage ${stageNum}.
       </span>`;

  const authOpts = GATE_AUTH_OPTIONS
    .filter(a => !chain.some(c => c.authority === a.value))
    .map(a => `<option value="${a.value}">${a.label}</option>`).join('');

  // Title/subtitle are rendered by the collapsible wrapper (renderCollapsiblePanel)
  // that calls this - just the chain content itself here.
  return `<div style="margin:0 0 8px;">${chainHtml}</div>
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
      ${authOpts ? `
        <select id="gca-sel-${stageNum}" style="font-size:12px;padding:4px 8px;border:1px solid var(--border);border-radius:var(--radius);">
          ${authOpts}
        </select>
        <button class="btn btn-ghost btn-sm gate-add-btn" data-stage="${stageNum}">+ Add to chain</button>` : ''}
      ${chain.length > 0 ? `<button class="btn btn-ghost btn-sm gate-clear-btn" data-stage="${stageNum}"
        style="color:var(--red-700);">Clear all</button>` : ''}
    </div>`;
}

async function handleGateAdd(btn) {
  const stageNum = parseInt(btn.dataset.stage, 10);
  const sel = document.getElementById(`gca-sel-${stageNum}`);
  const authority = sel?.value;
  if (!authority) return;
  btn.disabled = true;
  try {
    const currentChain = (gateConfig[stageNum] ?? []).map(e => e.authority);
    const newChain = [...currentChain, authority];
    const result = await api.post(`/api/templates/${templateData.version_id}/gate-approvers`,
      { stage_number: stageNum, chain: newChain });
    if (result.forked) {
      alert(`Chain saved. A new template version was created to protect existing projects.`);
    }
    await reload(result);
  } catch (err) {
    alert('Could not update chain: ' + err.message);
    btn.disabled = false;
  }
}

async function handleGateRemove(btn) {
  const stageNum = parseInt(btn.dataset.stage, 10);
  const removedPos = parseInt(btn.dataset.pos, 10);
  btn.disabled = true;
  try {
    const newChain = (gateConfig[stageNum] ?? [])
      .filter(e => e.chain_position !== removedPos)
      .map(e => e.authority);

    let result;
    if (newChain.length === 0) {
      result = await api.delete(`/api/templates/${templateData.version_id}/gate-approvers/${stageNum}`);
    } else {
      result = await api.post(`/api/templates/${templateData.version_id}/gate-approvers`,
        { stage_number: stageNum, chain: newChain });
    }
    await reload(result);
  } catch (err) {
    alert('Could not remove from chain: ' + err.message);
    btn.disabled = false;
  }
}

async function handleGateClear(btn) {
  const stageNum = parseInt(btn.dataset.stage, 10);
  if (!confirm(`Clear the Gate ${stageNum} approver chain? It will revert to system defaults.`)) return;
  btn.disabled = true;
  try {
    const result = await api.delete(`/api/templates/${templateData.version_id}/gate-approvers/${stageNum}`);
    if (result.forked) {
      alert(`Cleared. New version ${result.new_version} ${forkReasonText()}.`);
    }
    await reload(result);
  } catch (err) {
    alert('Could not clear chain: ' + err.message);
    btn.disabled = false;
  }
}
