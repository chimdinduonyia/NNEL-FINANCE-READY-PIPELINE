/* templates.js — Template Editor page (admin only) */
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

const STAGE_NAMES = [
  'Opportunity Screening','Preliminary Assessment','Full Feasibility',
  'Financial Close / FID','First Disbursement','COD / Commissioning',
];

let activeTech      = 'solar_pv';
let activeVersionId = null; // which version is open in the editor
let templateData    = null; // current GET /api/templates/:id/items response
let gateConfig      = {};   // { stageNumber: [{chain_position, authority}, …] }
let editingItemId   = null;
let currentUser     = null;
let allVersions     = [];   // all template versions (refreshed on loadTemplate)

const GATE_AUTH_OPTIONS = [
  { value: 'm1_nnpc',    label: 'M1: NNPC Group' },
  { value: 'm2_evp',     label: 'M2: EVP' },
  { value: 'nnel_board', label: 'NNEL Board' },
  { value: 'm3_md_nnel', label: 'M3: MD-NNEL' },
  { value: 'slt_mtc',    label: 'SLT-MTC' },
  { value: 'm4_ed_cam',  label: 'M4: ED-CAM' },
];
const GATE_AUTH_LABEL = Object.fromEntries(GATE_AUTH_OPTIONS.map(a => [a.value, a.label]));
const CAPEX_GOVERNED  = [2, 3]; // These stages use CAPEX-threshold routing — not configurable

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
// loadTemplate — fetches version list for the active technology, renders the
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

async function loadVersion(versionId, el, techVersions) {
  if (!el) el = document.getElementById('template-content');
  if (!techVersions) {
    techVersions = allVersions.filter(v => v.technology === activeTech);
  }
  activeVersionId = versionId;
  editingItemId = null;

  try { templateData = await api.get(`/api/templates/${versionId}/items`); }
  catch (err) { el.innerHTML = `<div class="error-msg">${api.fmt.escape(err.message)}</div>`; return; }

  try {
    const gc = await api.get(`/api/templates/${versionId}/gate-approvers`);
    gateConfig = gc ?? {};
  } catch { gateConfig = {}; }

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
function renderTemplate(el, techVersions = []) {
  const d = templateData;
  const hasProjects = d.project_count > 0;

  const bannerClass = hasProjects ? 'warn' : 'safe';
  const bannerMsg   = hasProjects
    ? `<strong>${d.project_count} active project${d.project_count > 1 ? 's' : ''}</strong> using <strong>${api.fmt.escape(d.name || d.version)}</strong>.
       Saving any change will create a new version. Existing projects are unaffected.`
    : `<strong>${api.fmt.escape(d.name || d.version)}</strong> · No active projects yet. Changes apply directly to this version.`;

  // Version history panel
  const versionHistory = techVersions.map(v => {
    const isOpen   = v.id === activeVersionId;
    const isActive = v.is_active;

    // Bin icon: visible to the creator of this version, or to any admin.
    // Active versions are blocked server-side — shown here but the modal will
    // display the server's error if they attempt to delete an active version.
    const canDelete =
      currentUser?.system_role === 'admin' ||
      (currentUser?.system_role === 'project_manager' && v.created_by === currentUser?.id);

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
      ${!isActive ? `<button class="btn btn-ghost btn-sm set-active-btn" data-vid="${v.id}"
         style="margin-top:6px;font-size:11px;color:var(--green-700);">Set as Active</button>` : ''}
    </div>`;
  }).join('');

  const stagesHtml = d.stages.map(s => renderStage(s, gateConfig[s.stage_number] ?? [])).join('');

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
    ${stagesHtml}
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

  // Wire up accordions (click anywhere on header except buttons)
  el.querySelectorAll('.stage-header').forEach(h => {
    h.addEventListener('click', e => {
      if (e.target.closest('button')) return;
      const body = h.nextElementSibling;
      body.classList.toggle('hidden');
    });
  });

  // Wire up stage deactivate/restore buttons
  el.querySelectorAll('.stage-status-btn').forEach(btn => {
    btn.addEventListener('click', () => handleStageStatus(btn));
  });

  // Wire up all item-level buttons
  el.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', e => handleAction(e.currentTarget));
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
function renderStage(stage, chain = []) {
  const activeItems   = stage.items.filter(i => i.is_active);
  const inactiveItems = stage.items.filter(i => !i.is_active);
  const allItems      = [...activeItems, ...inactiveItems];

  const rowsHtml = allItems.map(item => renderItemRow(item)).join('');

  // Next suggested item code: increment the last digit in the highest code
  const lastCode = activeItems.length
    ? activeItems.reduce((max, i) => i.item_code > max ? i.item_code : max, activeItems[0].item_code)
    : null;

  const suggestedCode = lastCode
    ? lastCode.replace(/(\d+)(?!.*\d)/, n => String(parseInt(n, 10) + 1))
    : `?${stage.stage_number}-T-01`;

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

  return `<div class="stage-section">
    <div class="stage-header">
      <h3>Stage ${stage.stage_number}: ${STAGE_NAMES[stage.stage_number] ?? ''}</h3>
      <div style="display:flex;align-items:center;gap:12px;">
        <span class="stage-count">${activeItems.length} active · ${inactiveItems.length} inactive</span>
        ${stageBtn}
      </div>
    </div>
    ${deactivatedBanner}
    <div class="stage-body">
      <div style="display:grid;grid-template-columns:100px 1fr 100px 70px 90px 90px;gap:8px;padding:8px 12px;background:var(--gray-50);border-bottom:1px solid var(--border);font-size:11px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.04em;">
        <div>Code</div><div>Description</div><div>Pillar</div><div>Mandatory</div><div></div><div></div>
      </div>
      ${rowsHtml || '<div style="padding:16px;color:var(--text-muted);font-size:13px;">No items yet.</div>'}
    </div>
    <div class="add-item-panel">
      <h4>+ Add item to Stage ${stage.stage_number}</h4>
      <form class="add-item-form" data-stage="${stage.stage_number}">
        <div class="add-item-grid">
          <div class="form-group">
            <label>Item code *</label>
            <input type="text" name="item_code" value="${api.fmt.escape(suggestedCode)}" required>
          </div>
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
        <div class="add-item-error error-msg hidden mt-8"></div>
        <button type="submit" class="btn btn-primary btn-sm mt-8">Add Item</button>
      </form>
    </div>

    <!-- Gate Approver Chain configuration -->
    ${renderGateChainSection(stage.stage_number, chain)}
  </div>`;
}

// ---------------------------------------------------------------------------
function renderItemRow(item) {
  const isEditing = editingItemId === item.id;
  const inactive  = !item.is_active;
  const cls = ['item-row', inactive ? 'inactive' : '', isEditing ? 'editing' : ''].filter(Boolean).join(' ');

  if (isEditing) {
    const pillarOpts = PILLAR_OPTIONS.map(p =>
      `<option value="${p.value}" ${p.value === item.pillar ? 'selected' : ''}>${p.label}</option>`
    ).join('');

    return `<div class="${cls}" data-item-id="${item.id}">
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
      <div></div>
    </div>`;
  }

  const pillarLabel = PILLAR_LABEL[item.pillar] ?? item.pillar;
  const mandBadge   = item.is_mandatory
    ? '<span class="badge badge-green" style="font-size:10px;">Yes</span>'
    : '<span class="badge badge-gray"  style="font-size:10px;">No</span>';
  const statusBtn = item.is_active
    ? `<button class="btn btn-ghost btn-sm" data-action="deactivate" data-item-id="${item.id}"
         style="color:var(--red-700);border-color:var(--red-100);">Disable</button>`
    : `<button class="btn btn-ghost btn-sm" data-action="restore" data-item-id="${item.id}"
         style="color:var(--green-700);border-color:var(--green-100);">Restore</button>`;

  const descHtml = inactive
    ? `<span style="text-decoration:line-through;color:var(--text-muted);">${api.fmt.escape(item.description)}</span>
       <span class="badge badge-red" style="font-size:10px;margin-left:6px;vertical-align:middle;">Disabled</span>`
    : api.fmt.escape(item.description);

  return `<div class="${cls}" data-item-id="${item.id}">
    <div class="item-code">${api.fmt.escape(item.item_code)}</div>
    <div class="item-desc" title="${api.fmt.escape(item.guidance ?? '')}">${descHtml}</div>
    <div class="text-sm text-muted">${inactive ? '-' : pillarLabel}</div>
    <div>${inactive ? '' : mandBadge}</div>
    <div class="item-actions">
      ${item.is_active ? `<button class="btn btn-ghost btn-sm" data-action="edit" data-item-id="${item.id}">Edit</button>` : ''}
    </div>
    <div class="item-actions">${statusBtn}</div>
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
      // Version was bumped — reload to show new version
      alert(`Saved. A new version (${result.new_version}) has been created to protect existing projects.`);
    }
    await loadTemplate();
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
      <div class="card-header" style="border-left:4px solid var(--red-700);">
        <h3 style="color:var(--red-700);">Delete Template Version</h3>
        <button class="btn btn-ghost btn-sm" id="dv-close">✕</button>
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
  modal.addEventListener('click', e => { if (e.target === modal) close(); });

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
  modal.addEventListener('click', e => { if (e.target === modal) close(); });

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
  const stageName = STAGE_NAMES[stageNum] ?? `Stage ${stageNum}`;

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
    await loadTemplate();
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
      alert(`Done. A new version (${result.new_version}) has been created.`);
    }
    await loadTemplate();
  } catch (err) {
    alert('Error: ' + err.message);
  }
}

async function handleAddItem(e) {
  e.preventDefault();
  const form        = e.target;
  const errEl       = form.querySelector('.add-item-error');
  errEl.classList.add('hidden');

  const stageNumber = parseInt(form.dataset.stage, 10);
  const item_code   = form.elements.item_code.value.trim();
  const description = form.elements.description.value.trim();
  const pillar      = form.elements.pillar.value;
  const is_mandatory= form.elements.is_mandatory.value === '1';
  const guidance    = form.elements.guidance.value.trim() || null;

  if (!item_code || !description) {
    errEl.textContent = 'Item code and description are required.';
    errEl.classList.remove('hidden');
    return;
  }

  const btn = form.querySelector('button[type=submit]');
  btn.disabled = true;
  try {
    await api.post(`/api/templates/${templateData.version_id}/items`, {
      stage_number: stageNumber, item_code, description, guidance, pillar, is_mandatory,
    });
    await loadTemplate();
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
  if (CAPEX_GOVERNED.includes(stageNum)) {
    return `<div class="gate-chain-config">
      <div class="gate-chain-title"><span style="vertical-align:middle;margin-right:6px;">${api.icons.lock}</span>Gate Approver Chain</div>
      <p class="text-sm text-muted" style="margin-top:4px;">
        Stage ${stageNum} routing is determined by the project's CAPEX at submission
        (DOA threshold rules) and cannot be configured here.
      </p>
    </div>`;
  }

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

  return `<div class="gate-chain-config">
    <div class="gate-chain-title"><span style="vertical-align:middle;margin-right:6px;">${api.icons.chainLink}</span>Gate Approver Chain
      <span class="text-muted" style="font-size:12px;font-weight:400;margin-left:6px;">
        who signs off at Stage ${stageNum} (in order)
      </span>
    </div>
    <div style="margin:8px 0;">${chainHtml}</div>
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
      ${authOpts ? `
        <select id="gca-sel-${stageNum}" style="font-size:12px;padding:4px 8px;border:1px solid var(--border);border-radius:var(--radius);">
          ${authOpts}
        </select>
        <button class="btn btn-ghost btn-sm gate-add-btn" data-stage="${stageNum}">+ Add to chain</button>` : ''}
      ${chain.length > 0 ? `<button class="btn btn-ghost btn-sm gate-clear-btn" data-stage="${stageNum}"
        style="color:var(--red-700);">Clear all</button>` : ''}
    </div>
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
    await loadTemplate();
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

    if (newChain.length === 0) {
      await api.delete(`/api/templates/${templateData.version_id}/gate-approvers/${stageNum}`);
    } else {
      await api.post(`/api/templates/${templateData.version_id}/gate-approvers`,
        { stage_number: stageNum, chain: newChain });
    }
    await loadTemplate();
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
    await api.delete(`/api/templates/${templateData.version_id}/gate-approvers/${stageNum}`);
    await loadTemplate();
  } catch (err) {
    alert('Could not clear chain: ' + err.message);
    btn.disabled = false;
  }
}
