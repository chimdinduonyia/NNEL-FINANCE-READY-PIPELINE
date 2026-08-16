/* project.js — single project view */
'use strict';

const STAGE_NAMES = [
  'Opportunity Screening', 'Preliminary Assessment', 'Full Feasibility',
  'Financial Close / FID', 'First Disbursement', 'COD / Commissioning',
];
const PILLAR_LABELS = {
  technical: 'Technical', commercial: 'Commercial', finance: 'Finance',
  legal: 'Legal', environmental: 'Environmental & Social', risk: 'Risk & Governance',
};
const ACTION_LABELS = {
  project_created: 'Project created', project_updated: 'Project updated',
  member_assigned: 'Member assigned', member_removed: 'Member removed',
  checklist_item_updated: 'Checklist item updated',
  evidence_note_edited: 'Evidence note edited',
  document_created: 'Document added', document_updated: 'Document updated', document_deleted: 'Document removed',
  stage_submitted: 'Stage submitted for gate review',
  submission_recalled: 'Submission recalled by submitter',
  gate_decision_recorded: 'Gate decision recorded',
  condition_closed: 'Condition closed', gate_conditions_resolved: 'Conditions resolved',
  stage_reopened: 'Stage re-opened', user_login: 'Signed in',
};

// Maps the project's display technology to the template_versions.technology ENUM value
const TECH_ENUM = { 'Solar PV': 'solar_pv', 'Biofuels': 'biofuels', 'Abatement': 'abatement' };
function techParam(technology) {
  const e = TECH_ENUM[technology];
  return e ? `?technology=${e}` : '';
}

let project     = null;
let currentUser = null;
let projectId   = null;
let activeTab   = 'checklist';
let viewStage   = null; // null = current working view; number = history snapshot for that stage

document.addEventListener('DOMContentLoaded', async () => {
  currentUser = await api.getMe();
  if (!currentUser) return;

  api.initSidebar(currentUser);

  const params = new URLSearchParams(window.location.search);
  projectId = params.get('id');
  if (!projectId) { window.location.href = '/'; return; }

  const requestedTab = params.get('tab');
  if (requestedTab) activeTab = requestedTab;

  await loadProject();
});

async function loadProject() {
  try {
    project = await api.get(`/api/projects/${projectId}`);
  } catch (err) {
    document.getElementById('section-content').innerHTML =
      `<div class="error-msg mt-24">Could not load project: ${api.fmt.escape(err.message)}</div>`;
    return;
  }

  // Observers get the data room view, not the full project view
  const myMember = project.members.find(m => m.user_id === currentUser.id);
  if (myMember?.role === 'observer') {
    window.location.replace(`/dataroom.html?id=${projectId}`);
    return;
  }

  viewStage = null; // any reload (e.g. member add) returns to working view
  document.title = `${project.name.toUpperCase()} | NNEL Pipeline Tracker`;
  renderHeader();
  renderProjectBrief();
  renderPipelineStrip();
  renderTabs();
  loadTab(activeTab);
}

// ---- Project brief — quick fact strip shown above the stepper -------------
function renderProjectBrief() {
  const el   = document.getElementById('project-brief');
  const grid = document.getElementById('brief-grid');

  const capexValue = project.capex_currency === 'NGN'
    ? `${api.fmt.currency(project.capex_amount, 'NGN')}
       <span class="brief-sub">(≈ ${api.fmt.currency(project.capex_usd)} USD)</span>`
    : api.fmt.currency(project.capex_usd);

  const items = [
    ['Project Name',  api.fmt.escape(project.name.toUpperCase())],
    ['Vertical',      api.fmt.escape(project.technology || '—')],
    ['Project Value', capexValue],
    ['Capacity',      api.fmt.escape(project.capacity || '—')],
    ['Location',      api.fmt.escape(project.location || '—')],
  ];

  grid.innerHTML = items.map(([label, value]) => `
    <div class="brief-item">
      <div class="brief-label">${label}</div>
      <div class="brief-value">${value}</div>
    </div>
  `).join('');

  el.style.display = 'block';
}

// ---- Header ----------------------------------------------------------------
function renderHeader() {
  const el = document.getElementById('project-header');
  document.getElementById('project-name').textContent = project.name.toUpperCase();
  // Vertical + CAPEX now live in the Project Brief strip below, so they're
  // not repeated here — this row is just status (+ the At Risk flag, which
  // isn't shown anywhere else).
  document.getElementById('project-meta').innerHTML = [
    api.fmt.statusBadge(project.status),
    project.is_at_risk ? `<span class="badge badge-red">At Risk</span>` : '',
  ].join('');

  const actionsEl = document.getElementById('project-actions');
  if (actionsEl) {
    const memoBtn = (isAdmin() || isProjectLead())
      ? `<a href="/memo.html?id=${projectId}" target="_blank" class="btn btn-ghost btn-sm">📄 Export Memo</a>` : '';
    const editBtn = canManageTeam()
      ? `<button class="btn btn-ghost btn-sm" id="edit-project-btn">✏️ Edit Details</button>` : '';
    const deleteBtn = isAdmin()
      ? `<button class="btn btn-ghost btn-sm" id="delete-project-btn" style="color:var(--red-700);">🗑 Delete</button>` : '';
    actionsEl.style.display = 'flex';
    actionsEl.style.gap = '8px';
    actionsEl.style.alignItems = 'center';
    actionsEl.innerHTML = [memoBtn, editBtn, deleteBtn].filter(Boolean).join('');
  }

  // Wire up Edit Details button
  const editProjectBtn = document.getElementById('edit-project-btn');
  if (editProjectBtn) {
    editProjectBtn.addEventListener('click', () => showEditProjectPanel());
  }

  // Wire up Delete button
  const deleteProjectBtn = document.getElementById('delete-project-btn');
  if (deleteProjectBtn) {
    deleteProjectBtn.addEventListener('click', () => showDeleteProjectModal());
  }

  el.style.display = 'block';
}

// ---- Pipeline strip --------------------------------------------------------
function renderPipelineStrip() {
  const el   = document.getElementById('pipeline-strip');
  const wrap = document.getElementById('stage-strip');

  wrap.innerHTML = project.stages
    .filter(s => !s.is_deactivated)   // hide fully-deactivated stage gates
    .map(s => {
      const isSelected = viewStage === null
        ? s.stage_number === project.current_stage
        : s.stage_number === viewStage;

      const cls = [
        'stage-node',
        `status-${s.status}`,
        'clickable',
        isSelected ? 'selected' : '',
        s.status === 'approved' ? 'line-complete' : '', // greens the connector leading to the next stage
      ].filter(Boolean).join(' ');

      const dot   = stageIcon(s.status);
      const title = s.status === 'approved'
        ? `View Stage ${s.stage_number} history`
        : s.status === 'not_started'
          ? `Preview Stage ${s.stage_number} requirements`
          : s.stage_number === project.current_stage
            ? 'Current stage'
            : '';

      return `<div class="${cls}" data-stage="${s.stage_number}" title="${title}">
        <div class="stage-dot">${dot}</div>
        <div class="stage-label">Stage ${s.stage_number}<br>${abbrev(STAGE_NAMES[s.stage_number])}</div>
      </div>`;
    }).join('');

  // Wire up click handlers for all stage nodes
  wrap.querySelectorAll('.stage-node.clickable').forEach(node => {
    const stageNum  = parseInt(node.dataset.stage, 10);
    const stageData = project.stages.find(s => s.stage_number === stageNum);
    if (!stageData) return;

    node.addEventListener('click', () => {
      if (stageData.status === 'approved') {
        switchToHistoryView(stageNum);
      } else if (stageData.status === 'not_started') {
        switchToPreviewView(stageNum);
      } else {
        switchToWorkingView();
      }
    });
  });

  el.style.display = 'block';
  document.getElementById('tabs-bar').style.display = 'block';
}

// Switch to history snapshot for an approved stage
function switchToHistoryView(stageNumber) {
  viewStage = stageNumber;

  // Update selection highlight without re-fetching
  document.querySelectorAll('.stage-node').forEach(node => {
    node.classList.toggle('selected', parseInt(node.dataset.stage, 10) === stageNumber);
  });

  // Hide the tab bar — history is a single self-contained view
  document.getElementById('tabs-bar').style.display = 'none';

  const el = document.getElementById('section-content');
  renderHistorySnapshot(el, stageNumber).catch(e => showErr(el, e));
}

// Return to the normal working view for the current stage
function switchToWorkingView() {
  viewStage = null;

  document.querySelectorAll('.stage-node').forEach(node => {
    node.classList.toggle('selected', parseInt(node.dataset.stage, 10) === project.current_stage);
  });

  document.getElementById('tabs-bar').style.display = 'block';
  renderTabs();
  loadTab(activeTab);
}

function stageIcon(status) {
  // Geometric tick: two straight segments, square line-caps, miter join
  const tick = `<svg width="13" height="11" viewBox="0 0 13 11" fill="none"
    xmlns="http://www.w3.org/2000/svg">
    <polyline points="1.5,5.5 4.5,9 11.5,1.5"
      stroke="currentColor" stroke-width="2.2"
      stroke-linecap="square" stroke-linejoin="miter"/>
  </svg>`;
  return { approved: tick, rejected:'✕', submitted:'…', conditional:'!',
           in_progress:'●', not_started:'' }[status] ?? '';
}

function abbrev(name) {
  const short = { 'Opportunity Screening':'Opp. Screening',
    'Preliminary Assessment':'Prelim. Assess.',
    'Financial Close / FID':'Fin. Close',
    'First Disbursement':'1st Disbursement',
    'COD / Commissioning':'COD' };
  return short[name] ?? name;
}

// ---- Tabs ------------------------------------------------------------------
function renderTabs() {
  const nav = document.getElementById('section-tabs');
  const tabs = [
    { id:'checklist', label:'Checklist' },
    { id:'gate',      label:'Gate Decision' },
    { id:'documents', label:'Documents' },
    { id:'audit',     label:'Audit Trail' },
    { id:'raci',      label:'RACI' },
  ];
  // Team tab visible to all project members (admin can edit, others read-only)
  tabs.push({ id:'team', label:'Team' });
  nav.innerHTML = tabs.map(t =>
    `<button class="section-tab ${activeTab === t.id ? 'active' : ''}" data-tab="${t.id}">${t.label}</button>`
  ).join('');
  nav.querySelectorAll('.section-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      nav.querySelectorAll('.section-tab').forEach(b => b.classList.toggle('active', b === btn));
      activeTab = btn.dataset.tab;
      loadTab(activeTab);
    });
  });
}

function loadTab(tab) {
  const el = document.getElementById('section-content');
  el.innerHTML = '<div class="loading">Loading…</div>';
  switch (tab) {
    case 'checklist':  renderChecklist(el).catch(e => showErr(el, e)); break;
    case 'gate':       renderGate(el).catch(e => showErr(el, e)); break;
    case 'documents':  renderDocuments(el).catch(e => showErr(el, e)); break;
    case 'audit':      renderAudit(el).catch(e => showErr(el, e)); break;
    case 'raci':       renderRaci(el).catch(e => showErr(el, e)); break;
    case 'team':       renderTeam(el).catch(e => showErr(el, e)); break;
  }
}

function showErr(el, err) {
  el.innerHTML = `<div class="error-msg">${api.fmt.escape(err.message)}</div>`;
}

// ---- Helpers: roles --------------------------------------------------------
function isAdmin() { return currentUser.system_role === 'admin'; }
function isProjectLead() {
  return project.members.some(m => m.user_id === currentUser.id && m.role === 'project_lead');
}
function isGateApprover() {
  return project.members.some(m => m.user_id === currentUser.id && m.role === 'gate_approver');
}
// PM can manage a project's team if they created it or are its project lead
function canManageTeam() {
  if (isAdmin()) return true;
  if (currentUser?.system_role !== 'project_manager') return false;
  return project.created_by === currentUser.id || isProjectLead();
}
// Used only for workstream lookup in renderChecklist — kept separate from isGateApprover/isProjectLead
function myMembership() {
  return project.members.find(m => m.user_id === currentUser.id) ?? null;
}
function currentStage() { return project.stages.find(s => s.stage_number === project.current_stage); }

// ===========================================================================
// CHECKLIST TAB
// ===========================================================================
async function renderChecklist(el) {
  const stageNum = project.current_stage;
  const stage    = currentStage();
  let items = [], allDocs = [], deactivatedCount = 0;
  try {
    const [checklistData, docs] = await Promise.all([
      api.get(`/api/projects/${projectId}/stages/${stageNum}/checklist`),
      api.get(`/api/projects/${projectId}/documents`),
    ]);
    // API returns { items: [...], deactivated_count: N }
    items           = checklistData.items ?? [];
    deactivatedCount = checklistData.deactivated_count ?? 0;
    allDocs = docs;
  } catch { items = []; allDocs = []; }
  const stageDocs = allDocs.filter(d => d.stage_number === stageNum);

  const contribRow  = project.members.find(m => m.user_id === currentUser?.id && m.role === 'contributor');
  const isContrib   = !!contribRow;
  const memberWs    = contribRow?.workstream ?? null;
  const stageOpen   = stage?.status === 'in_progress';
  const canEditAll  = stageOpen && (isAdmin() || isProjectLead());

  // Group active items by pillar (deactivated items are counted but never rendered)
  const byPillar = {};
  items.forEach(item => {
    if (!byPillar[item.pillar]) byPillar[item.pillar] = [];
    byPillar[item.pillar].push(item);
  });

  const total    = items.length;
  const complete = items.filter(i => i.is_complete).length;
  const pct      = total > 0 ? Math.round((complete / total) * 100) : 0;

  const statusHtml = `<div class="checklist-progress">
    <div class="checklist-progress-header">
      <div class="checklist-progress-title">
        Stage ${stageNum}: ${STAGE_NAMES[stageNum] ?? ''}
        ${api.fmt.statusBadge(stage?.status ?? 'not_started')}
      </div>
      ${total > 0
        ? `<span class="checklist-progress-count">${complete} / ${total} complete &nbsp;·&nbsp; ${pct}%</span>`
        : ''}
    </div>
    ${total > 0 ? `<div class="checklist-progress-track">
      <div class="checklist-progress-fill" style="width:${pct}%"></div>
    </div>` : ''}
  </div>`;

  const pillarsHtml = Object.entries(byPillar).map(([pillar, pillarItems]) => {
    const isMySection    = isContrib && memberWs === pillar;
    const sectionEditable = canEditAll || (isContrib && stageOpen && isMySection);
    const badge = isMySection
      ? ' <span class="your-section-badge">Your section</span>'
      : '';

    const itemsHtml = pillarItems.map(item => {
      const outsideWs = isContrib && memberWs !== item.pillar;
      return renderChecklistItem(item, stageNum, sectionEditable && !outsideWs, outsideWs);
    }).join('');

    return `<div class="pillar-section">
      <div class="pillar-header">${PILLAR_LABELS[pillar] ?? pillar}${badge}</div>
      <div class="checklist-items">${itemsHtml}</div>
    </div>`;
  }).join('');

  // Banner shown when items were disabled in the template — items themselves are never rendered
  const allDeactivated  = deactivatedCount > 0 && items.length === 0;
  const someDeactivated = deactivatedCount > 0 && items.length > 0;

  const deactivatedBanner = allDeactivated
    ? `<div style="display:flex;align-items:flex-start;gap:12px;padding:16px;
                   background:var(--red-100);border:1px solid #fca5a5;border-radius:var(--radius);margin-bottom:12px;">
        <span class="badge badge-red" style="flex-shrink:0;margin-top:1px;">Stage Deactivated</span>
        <div>
          <div style="font-size:13px;font-weight:600;color:var(--red-700);">All checklist items have been disabled in the template.</div>
          <div style="font-size:12px;color:var(--red-700);margin-top:4px;">
            This stage has no active items. Contact an admin or project manager to restore items in the Template Editor.
          </div>
        </div>
      </div>`
    : someDeactivated
      ? `<div style="display:flex;align-items:center;gap:10px;padding:10px 14px;
                     background:var(--amber-100);border:1px solid #fde68a;border-radius:var(--radius);margin-top:16px;">
          <span class="badge badge-amber" style="flex-shrink:0;">Note</span>
          <span style="font-size:12px;color:var(--amber-600);">
            ${deactivatedCount} checklist item${deactivatedCount !== 1 ? 's' : ''} in this stage
            ${deactivatedCount !== 1 ? 'have' : 'has'} been disabled in the template and
            ${deactivatedCount !== 1 ? 'are' : 'is'} not required for this project.
          </span>
        </div>`
      : '';

  // Submit panel — includes a summary textarea the PL fills in before submitting
  const submitHtml = isProjectLead() && stageOpen ? `
    <div class="add-form" style="margin-top:24px;">
      <h4>Submit Stage ${stageNum} for Gate Review</h4>
      <div class="form-group">
        <label for="submission-summary">
          Stage Gate Summary
          <span class="form-hint">: key outputs, decisions and findings (feeds into the Internal Memo)</span>
        </label>
        <textarea id="submission-summary" rows="5"
          placeholder="Summarise the key outputs achieved, key findings, major decisions made, and readiness for gate review…"></textarea>
      </div>
      <p class="text-sm text-muted">Once submitted, working data is frozen until a gate decision is recorded.</p>
      <button class="btn btn-primary" id="submit-stage-btn" style="align-self:flex-start;">Submit Stage ${stageNum} for Review</button>
      <div id="submit-error" class="error-msg hidden"></div>
    </div>` : '';

  // Read-only summary banner shown after the stage has been submitted
  const submittedStage = project.stages?.find(s => s.stage_number === stageNum);
  const summaryBannerHtml = submittedStage?.submission_summary && !stageOpen ? `
    <div style="margin-top:20px;padding:14px 16px;background:var(--gray-50);border:1px solid var(--border);border-radius:var(--radius-lg);opacity:0.75;">
      <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--text-muted);margin-bottom:6px;">Stage Gate Summary</div>
      <div style="font-size:13px;color:var(--gray-700);line-height:1.55;white-space:pre-wrap;">${api.fmt.escape(submittedStage.submission_summary)}</div>
      <div style="font-size:11px;color:var(--text-muted);margin-top:8px;">
        Submitted by ${api.fmt.escape(submittedStage.submitted_by_name ?? '-')} · ${api.fmt.date(submittedStage.submitted_at)}
      </div>
    </div>` : '';

  // Recall panel — shown to the original submitter (or admin) while the stage
  // is still 'submitted' and no approver has acted yet. Cleared server-side once
  // any decision is recorded.
  const canRecall = stage?.status === 'submitted'
    && (isAdmin() || submittedStage?.submitted_by === currentUser?.id);
  const recallHtml = canRecall ? `
    <div style="margin-top:16px;padding:12px 16px;background:var(--gray-50);border:1px solid var(--border);border-radius:var(--radius-lg);display:flex;align-items:center;gap:16px;flex-wrap:wrap;">
      <div style="flex:1;min-width:180px;">
        <div style="font-size:13px;font-weight:600;color:var(--gray-700);">Stage submitted and awaiting gate review</div>
        <div style="font-size:12px;color:var(--text-muted);margin-top:2px;">You can recall the submission to make edits, then re-submit when ready.</div>
      </div>
      <button class="btn btn-sm" id="recall-submission-btn" style="white-space:nowrap;background:var(--gray-100);color:var(--gray-700);border:1px solid var(--border);">Recall Submission</button>
    </div>
    <div id="recall-error" class="error-msg hidden" style="margin-top:6px;"></div>` : '';

  // Stage documents section — upload during in_progress, view when submitted/beyond
  const stageDocsHtml = renderStageDocs(stageDocs, stageNum, false, stageOpen);

  const checklistBody = allDeactivated
    ? deactivatedBanner
    : items.length
      ? pillarsHtml + deactivatedBanner
      : '<div class="empty">No checklist items configured for this stage.</div>';

  el.innerHTML = statusHtml
    + checklistBody
    + summaryBannerHtml
    + recallHtml
    + stageDocsHtml
    + submitHtml;

  // Wire up checkboxes
  el.querySelectorAll('.checklist-checkbox').forEach(cb => {
    cb.addEventListener('change', () => handleCheckToggle(cb, stageNum));
  });

  // Wire up "Edit evidence note" buttons on already-checked items
  el.querySelectorAll('.evidence-edit-btn').forEach(btn => {
    btn.addEventListener('click', () => handleEvidenceEdit(btn));
  });

  // Wire up stage-doc edit buttons (pencil icon)
  el.querySelectorAll('.sdoc-edit-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const docId = btn.dataset.docId;
      const doc   = allDocs.find(d => d.id === parseInt(docId, 10));
      if (doc) openDocEditModal(doc, stageNum);
    });
  });

  // Wire up stage-doc delete buttons
  el.querySelectorAll('.sdoc-delete-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const docId = btn.dataset.docId;
      const title = btn.dataset.title;
      if (!confirm(`Delete "${title}"?\n\nThis cannot be undone.`)) return;
      btn.disabled = true;
      try {
        await api.delete(`/api/projects/${projectId}/documents/${docId}`);
        await renderChecklist(document.getElementById('section-content'));
      } catch (err) {
        alert('Could not delete document: ' + err.message);
        btn.disabled = false;
      }
    });
  });

  // Wire up submit button — includes the summary in the POST body
  const submitBtn = el.querySelector('#submit-stage-btn');
  if (submitBtn) {
    submitBtn.addEventListener('click', async () => {
      if (!confirm(`Submit Stage ${stageNum} (${STAGE_NAMES[stageNum]}) for gate review? Working data will be frozen.`)) return;
      const summary = el.querySelector('#submission-summary')?.value?.trim() || null;
      submitBtn.disabled = true;
      try {
        await api.post(`/api/projects/${projectId}/stages/${stageNum}/submit`,
          { submission_summary: summary });
        await loadProject();
      } catch (err) {
        document.getElementById('submit-error').textContent = err.message;
        document.getElementById('submit-error').classList.remove('hidden');
        submitBtn.disabled = false;
      }
    });
  }

  // Wire up recall button
  const recallBtn = el.querySelector('#recall-submission-btn');
  if (recallBtn) {
    recallBtn.addEventListener('click', async () => {
      if (!confirm(`Recall the Stage ${stageNum} submission? The stage will return to draft so you can edit it before re-submitting.`)) return;
      recallBtn.disabled = true;
      try {
        await api.post(`/api/projects/${projectId}/stages/${stageNum}/recall`, {});
        await loadProject();
      } catch (err) {
        const errEl = document.getElementById('recall-error');
        if (errEl) { errEl.textContent = err.message; errEl.classList.remove('hidden'); }
        recallBtn.disabled = false;
      }
    });
  }
}

// outsideWs: item belongs to a different workstream — visible but locked for contributors
function renderChecklistItem(item, stageNum, editable, outsideWs = false) {
  const outerClass = [
    'checklist-item',
    item.is_complete ? 'is-complete' : '',
    outsideWs         ? 'outside-ws'   : '',
  ].filter(Boolean).join(' ');

  const evidenceHtml = item.is_complete ? `
    <div class="item-evidence">
      ${item.evidence_note ? `<div class="item-evidence-display">↳ ${api.fmt.escape(item.evidence_note)}</div>` : ''}
      ${editable ? `<button type="button" class="btn-link text-sm evidence-edit-btn"
        data-item="${item.checklist_item_id}" data-stage="${stageNum}">
        ${item.evidence_note ? 'Edit evidence note' : '+ Add evidence note'}</button>` : ''}
    </div>
    ${item.completed_by_name ? `<div class="item-completed-by">Completed by ${api.fmt.escape(item.completed_by_name)} · ${api.fmt.date(item.completed_at)}</div>` : ''}
  ` : '';

  return `<div class="${outerClass}" data-item="${item.checklist_item_id}">
    <input type="checkbox" class="checklist-checkbox"
      data-item-id="${item.checklist_item_id}"
      data-pillar="${item.pillar}"
      ${item.is_complete ? 'checked' : ''}
      ${!editable ? 'disabled' : ''}
      ${outsideWs ? 'title="Outside your workstream"' : ''}>
    <div class="item-body">
      <div class="item-code">${api.fmt.escape(item.item_code)} ${item.is_mandatory ? '' : '(optional)'}</div>
      <div class="item-desc">${api.fmt.escape(item.description)}</div>
      ${evidenceHtml}
    </div>
  </div>`;
}

async function handleCheckToggle(cb, stageNum) {
  const itemId  = cb.dataset.itemId;
  const checked = cb.checked;

  let evidenceNote = '';
  let docToCreate  = null;

  if (checked) {
    const itemEl   = cb.closest('.checklist-item');
    const itemCode = itemEl?.querySelector('.item-code')?.textContent ?? '';
    const itemDesc = itemEl?.querySelector('.item-desc')?.textContent ?? '';
    const result = await showEvidenceModal({ itemCode, itemDesc, stageNum });
    if (result.cancelled) { cb.checked = false; return; }
    evidenceNote = result.evidenceNote;
    docToCreate  = result.document;
  }

  cb.disabled = true;
  try {
    if (docToCreate) {
      await api.post(`/api/projects/${projectId}/documents`, {
        title: docToCreate.title, folder_code: docToCreate.folder,
        stage_number: stageNum, file_ref: docToCreate.fileRef || null,
        status: 'submitted',
      });
    }
    await api.patch(`/api/projects/${projectId}/stages/${stageNum}/checklist/${itemId}`, {
      is_complete:   checked,
      evidence_note: evidenceNote || null,
    });
    await renderChecklist(document.getElementById('section-content'));
  } catch (err) {
    alert('Could not update item: ' + err.message);
    cb.checked = !checked; // revert
  } finally {
    cb.disabled = false;
  }
}

// Edit the evidence note on an item that's already checked (no document
// re-attachment forced — the modal still offers it as optional).
async function handleEvidenceEdit(btn) {
  const itemId   = btn.dataset.item;
  const stageNum = parseInt(btn.dataset.stage, 10);
  const itemEl   = btn.closest('.checklist-item');
  const itemCode = itemEl?.querySelector('.item-code')?.textContent ?? '';
  const itemDesc = itemEl?.querySelector('.item-desc')?.textContent ?? '';
  const existingNote = itemEl?.querySelector('.item-evidence-display')?.textContent.replace(/^↳\s*/, '') ?? '';

  const result = await showEvidenceModal({ itemCode, itemDesc, stageNum, existingNote });
  if (result.cancelled) return;

  btn.disabled = true;
  try {
    if (result.document) {
      await api.post(`/api/projects/${projectId}/documents`, {
        title: result.document.title, folder_code: result.document.folder,
        stage_number: stageNum, file_ref: result.document.fileRef || null,
        status: 'submitted',
      });
    }
    await api.patch(`/api/projects/${projectId}/stages/${stageNum}/checklist/${itemId}`, {
      is_complete: true, evidence_note: result.evidenceNote || null,
    });
    await renderChecklist(document.getElementById('section-content'));
  } catch (err) {
    alert('Could not update evidence note: ' + err.message);
    btn.disabled = false;
  }
}

// ===========================================================================
// EVIDENCE NOTE MODAL
// Replaces the old browser prompt(). Also lets the user optionally attach a
// supporting document (title / file reference / VDR folder) in the same
// step, instead of the separate "Add Document to Stage" box that used to
// sit at the bottom of the checklist page.
// ===========================================================================
function showEvidenceModal({ itemCode, itemDesc, stageNum, existingNote = '' }) {
  return new Promise((resolve) => {
    document.getElementById('evidence-modal')?.remove();

    const modal = document.createElement('div');
    modal.id = 'evidence-modal';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:200;display:flex;align-items:center;justify-content:center;padding:24px;';
    modal.innerHTML = `
      <div class="card" style="width:100%;max-width:520px;max-height:90vh;overflow-y:auto;">
        <div class="card-header">
          <h3>Evidence Note</h3>
          <button class="btn btn-ghost btn-sm" id="ev-close">✕</button>
        </div>
        <div class="card-body" style="display:flex;flex-direction:column;gap:16px;">
          <div class="text-sm text-muted">${api.fmt.escape(itemCode)} — ${api.fmt.escape(itemDesc)}</div>

          <div class="form-group">
            <label>Evidence note <span class="form-hint">(describe how this item is satisfied)</span></label>
            <textarea id="ev-note" rows="3" placeholder="Describe how this item is satisfied…">${api.fmt.escape(existingNote)}</textarea>
          </div>

          <hr class="divider">

          <div class="form-group" style="gap:2px;">
            <label>Reference a document <span class="form-hint">(optional)</span></label>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label>Document Title</label>
              <input type="text" id="ev-doc-title" placeholder="Document title…">
            </div>
            <div class="form-group">
              <label>File Reference</label>
              <input type="text" id="ev-doc-fileref" placeholder="filename.pdf or URL…">
            </div>
          </div>
          <div class="form-group">
            <label>VDR Folder</label>
            <select id="ev-doc-folder"><option value="">Loading…</option></select>
          </div>

          <div id="ev-error" class="error-msg hidden"></div>
          <div class="flex gap-8" style="justify-content:flex-end;">
            <button class="btn btn-ghost" id="ev-cancel">Cancel</button>
            <button class="btn btn-primary" id="ev-save">Save</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(modal);

    // Populate VDR folder dropdown from the project's active template
    api.get(`/api/templates/active${techParam(project.technology)}`)
      .then(tpl => {
        const sel = modal.querySelector('#ev-doc-folder');
        sel.innerHTML = '<option value="">Select folder…</option>' +
          (tpl?.vdr_folders ?? [])
            .map(f => `<option value="${f.folder_code}">${f.folder_code}: ${api.fmt.escape(f.name)}</option>`)
            .join('');
      })
      .catch(() => {
        modal.querySelector('#ev-doc-folder').innerHTML = '<option value="">Could not load folders</option>';
      });

    const close = (result) => { modal.remove(); resolve(result); };
    modal.querySelector('#ev-close').addEventListener('click', () => close({ cancelled: true }));
    modal.querySelector('#ev-cancel').addEventListener('click', () => close({ cancelled: true }));
    modal.addEventListener('click', e => { if (e.target === modal) close({ cancelled: true }); });

    modal.querySelector('#ev-save').addEventListener('click', () => {
      const errEl = modal.querySelector('#ev-error');
      errEl.classList.add('hidden');

      const note       = modal.querySelector('#ev-note').value.trim();
      const docTitle   = modal.querySelector('#ev-doc-title').value.trim();
      const docFileRef = modal.querySelector('#ev-doc-fileref').value.trim();
      const docFolder  = modal.querySelector('#ev-doc-folder').value;

      if (docTitle && !docFolder) {
        errEl.textContent = 'Select a VDR folder for the document.';
        errEl.classList.remove('hidden');
        return;
      }

      close({
        cancelled: false,
        evidenceNote: note,
        document: docTitle ? { title: docTitle, fileRef: docFileRef, folder: docFolder } : null,
      });
    });
  });
}

// ===========================================================================
// GATE DECISION TAB
// ===========================================================================
async function renderGate(el) {
  const stageNum = project.current_stage;
  const stage    = currentStage();

  const [decisions, conditions, allDocs] = await Promise.all([
    api.get(`/api/projects/${projectId}/stages/${stageNum}/decisions`).catch(() => []),
    api.get(`/api/projects/${projectId}/stages/${stageNum}/conditions`).catch(() => []),
    api.get(`/api/projects/${projectId}/documents`).catch(() => []),
  ]);
  const stageDocs = allDocs.filter(d => d.stage_number === stageNum);

  const parts = [];

  // Status summary
  // Find the current stage data (has submission_summary from the project object)
  const stageData = project.stages?.find(s => s.stage_number === stageNum);

  // Build per-approver chain progress pills.
  // Uses decisions from the current review round only (stage.review_round is now
  // returned by the project API). Each required authority gets a green "approved"
  // pill if a GO decision exists this round, or a grey "awaiting" pill otherwise.
  const required   = stage?.required_approvers ?? [];
  const roundNum   = stage?.review_round ?? 1;
  const roundDecisions = decisions.filter(d => d.review_round === roundNum);
  const goByAuth   = {};
  roundDecisions.forEach(d => { if (d.decision === 'go') goByAuth[d.authority] = d; });

  const svgTick = `<svg width="11" height="9" viewBox="0 0 11 9" fill="none" style="flex-shrink:0;"><polyline points="1,4.5 4,8 10,1" stroke="currentColor" stroke-width="2" stroke-linecap="square" stroke-linejoin="miter"/></svg>`;
  const svgClock = `<svg width="11" height="11" viewBox="0 0 11 11" fill="none" style="flex-shrink:0;"><circle cx="5.5" cy="5.5" r="4.5" stroke="currentColor" stroke-width="1.4"/><polyline points="5.5,3 5.5,5.5 7.5,7" stroke="currentColor" stroke-width="1.4" stroke-linecap="square"/></svg>`;

  const chainPills = required.length === 0 ? '<span style="color:var(--text-muted);">-</span>' :
    required.map((auth, i) => {
      const label = auth.replace(/_/g, '-').toUpperCase();
      const go    = goByAuth[auth];
      const pill  = go
        ? `<span style="display:inline-flex;align-items:center;gap:5px;padding:4px 10px;border-radius:99px;background:#dcfce7;color:#166534;font-size:12px;font-weight:600;">${svgTick} ${api.fmt.escape(label)} · ${api.fmt.escape(go.decided_by_name)}</span>`
        : `<span style="display:inline-flex;align-items:center;gap:5px;padding:4px 10px;border-radius:99px;background:var(--gray-100);color:var(--text-muted);font-size:12px;font-weight:500;">${svgClock} ${api.fmt.escape(label)} · Awaiting</span>`;
      const arrow = i < required.length - 1
        ? `<span style="color:var(--gray-300);font-size:14px;line-height:1;user-select:none;">→</span>`
        : '';
      return pill + (arrow ? ' ' + arrow : '');
    }).join(' ');

  parts.push(`<div class="gate-status-box">
    <div class="flex items-center gap-8">
      <strong>Stage ${stageNum}:</strong> ${STAGE_NAMES[stageNum] ?? ''}
      ${api.fmt.statusBadge(stage?.status ?? 'not_started')}
    </div>
    ${stage?.submitted_at ? `<div class="text-sm text-muted mt-8">Submitted ${api.fmt.dateTime(stage.submitted_at)} · CAPEX locked at ${api.fmt.currency(stage.capex_at_submission)}</div>` : ''}
    <div style="margin-top:10px;">
      <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--text-muted);margin-bottom:6px;">Approval chain</div>
      <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">${chainPills}</div>
    </div>
    ${stageData?.submission_summary ? `
      <hr style="margin:12px 0;border:none;border-top:1px solid var(--border);">
      <div style="font-size:13px;font-weight:700;margin-bottom:4px;color:var(--gray-700);">Stage Gate Summary</div>
      <div style="font-size:13px;color:var(--gray-700);line-height:1.55;white-space:pre-wrap;">${api.fmt.escape(stageData.submission_summary)}</div>` : ''}
  </div>`);

  // Stage documents — only the gate approver(s) in the required chain may approve/return
  if (stageDocs.length > 0 || stage?.status === 'submitted') {
    const myAuthorities = project.members
      .filter(m => m.user_id === currentUser?.id && m.role === 'gate_approver')
      .map(m => m.approver_authority);
    const requiredAuths = stage?.required_approvers ?? [];
    const canApprove = isGateApprover()
      && stage?.status === 'submitted'
      && (requiredAuths.length === 0 || requiredAuths.some(a => myAuthorities.includes(a)));
    parts.push(renderStageDocs(stageDocs, stageNum, canApprove));
  }

  // Warn gate approver if submitted documents are still pending review
  if (isGateApprover() && stage?.status === 'submitted') {
    const pending = stageDocs.filter(d => d.status === 'submitted');
    if (pending.length > 0) {
      parts.push(`<div class="error-msg" style="margin-bottom:8px;">
        ⚠️ You must review all ${pending.length} submitted document${pending.length > 1 ? 's' : ''} above
        (approve or return each one) before you can record a gate decision.
      </div>`);
    }
  }

  // Open conditions
  if (conditions.length > 0) {
    const canClose = isProjectLead() || isAdmin();
    parts.push(renderConditionsList(conditions, stageNum, canClose));
  }

  // Past decisions — shown as a chain with step indicators when multiple approvers
  if (decisions.length > 0) {
    parts.push(`<div>
      <h4 style="font-size:14px;font-weight:700;margin-bottom:16px;">Gate Decision History</h4>
      ${renderDecisionChain(decisions)}
    </div>`);
  }

  // Approver decision form (only if next in chain)
  if (isGateApprover() && stage?.status === 'submitted') {
    // Only block GO if a gate approver explicitly returned at least one document
    // (updated_by is a gate approver on this project). Documents that were simply
    // never submitted by the team are 'outstanding' but are not a gate-approver action.
    const hasReturnedDocs = stageDocs.some(d =>
      d.status === 'outstanding' &&
      d.updated_by != null &&
      project.members.some(m => m.user_id === d.updated_by && m.role === 'gate_approver')
    );
    parts.push(renderDecisionForm(stageNum, hasReturnedDocs));
  }

  // Re-open form (admin or approver on approved/rejected/conditional stage)
  if ((isAdmin() || isGateApprover()) && ['approved','rejected','conditional'].includes(stage?.status)) {
    parts.push(renderReopenForm(stageNum));
  }

  el.innerHTML = `<div class="gate-panel">${parts.join('')}</div>`;

  // Wire up document review buttons (Approve / Return to team / Undo)
  el.querySelectorAll('.doc-approve-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const docId  = btn.dataset.docId;
      const action = btn.dataset.action;

      const messages = {
        'approve':      'Approve this document?\n\nYou can undo this until you record the final gate decision.',
        'return':       'Return this document to the project team for revision?\n\nIt will be marked Outstanding so the uploader can edit and resubmit.',
        'undo-approve': 'Undo approval and return this document to "Submitted" status?',
        'undo-return':  'Undo the return and put this document back to "Submitted" status?',
      };
      const statuses = {
        'approve':      'approved',
        'return':       'outstanding',
        'undo-approve': 'submitted',
        'undo-return':  'submitted',
      };

      if (!confirm(messages[action] ?? 'Confirm?')) return;
      btn.disabled = true;
      try {
        await api.patch(`/api/projects/${projectId}/documents/${docId}`,
          { status: statuses[action] });
        await renderGate(el);
      } catch (err) {
        alert('Could not update document: ' + err.message);
        btn.disabled = false;
      }
    });
  });

  // Wire up status dropdowns in gate tab
  el.querySelectorAll('.doc-status-select').forEach(sel => {
    sel.addEventListener('change', async () => {
      const docId = sel.dataset.docId;
      const oldStatus = sel.dataset.status;
      sel.disabled = true;
      try {
        await api.patch(`/api/projects/${projectId}/documents/${docId}`, { status: sel.value });
        sel.dataset.status = sel.value;
      } catch (err) {
        alert('Could not update status: ' + err.message);
        sel.value = oldStatus;
        sel.dataset.status = oldStatus;
      } finally { sel.disabled = false; }
    });
  });

  // Wire up decision form
  const decForm = el.querySelector('#decision-form');
  if (decForm) wireDecisionForm(decForm, stageNum);

  // Wire up reopen form
  const reopenForm = el.querySelector('#reopen-form');
  if (reopenForm) wireReopenForm(reopenForm, stageNum);

  // Wire up condition close buttons
  el.querySelectorAll('.close-cond-btn').forEach(btn => {
    btn.addEventListener('click', () => handleCloseCondition(btn, stageNum));
  });
}

function renderConditionsList(conditions, stageNum, canClose) {
  const openCount   = conditions.filter(c => !c.is_closed).length;
  const closedCount = conditions.filter(c => c.is_closed).length;
  const items = conditions.map(c => `
    <div class="condition-item ${c.is_closed ? 'closed' : ''}">
      <div class="cond-icon">${c.is_closed ? '✅' : '⬜'}</div>
      <div class="cond-desc">
        <div>${api.fmt.escape(c.description)}</div>
        ${c.is_closed ? `<div class="cond-evidence">↳ ${api.fmt.escape(c.evidence_note ?? '')}</div>
          <div class="cond-closed-by">Closed by ${api.fmt.escape(c.closed_by_name ?? '?')} · ${api.fmt.date(c.closed_at)}</div>` : ''}
        ${!c.is_closed && canClose ? `<button class="btn btn-sm btn-primary mt-8 close-cond-btn"
          data-cond-id="${c.id}" style="align-self:flex-start;">Mark resolved</button>` : ''}
      </div>
    </div>
  `).join('');

  return `<div>
    <h4 style="font-size:14px;font-weight:700;margin-bottom:12px;">
      Conditions (${closedCount}/${conditions.length} resolved)
    </h4>
    <div class="conditions-list">${items}</div>
  </div>`;
}

async function handleCloseCondition(btn, stageNum) {
  const condId = btn.dataset.condId;
  const note   = prompt('Evidence note (required: describe how this condition was satisfied):');
  if (!note || !note.trim()) return;
  btn.disabled = true;
  try {
    const result = await api.patch(
      `/api/projects/${projectId}/stages/${stageNum}/conditions/${condId}`,
      { evidence_note: note.trim() }
    );
    if (result?.all_conditions_resolved) {
      alert(`All conditions resolved! ${result.outcome === 'stage_advanced' ? 'Stage has advanced.' : 'Next approver in chain can now sign.'}`);
      await loadProject();
    } else {
      await renderGate(document.getElementById('section-content'));
    }
  } catch (err) {
    alert('Error: ' + err.message);
    btn.disabled = false;
  }
}

function renderDecisionCard(d) {
  const cls = d.decision.toLowerCase().replace('_','');
  return `<div class="decision-card">
    <div class="decision-header ${d.decision}">
      <div>
        <strong>${d.decision.replace(/_/g,' ').toUpperCase()}</strong>
        <span class="text-muted" style="margin-left:8px;">by ${api.fmt.escape(d.decided_by_name)} (${(d.authority ? d.authority.replace(/_/g,'-').toUpperCase() : 'Project Lead')})</span>
        <span class="text-sm text-muted" style="margin-left:8px;">Chain position ${d.chain_position} · Round ${d.review_round}</span>
      </div>
      <span class="text-sm text-muted">${api.fmt.dateTime(d.created_at)}</span>
    </div>
    <div class="decision-rationale">${api.fmt.escape(d.rationale)}</div>
    ${d.conditions && d.conditions.length ? `<div class="conditions-list" style="background:none;">
      ${d.conditions.map(c => `<div class="condition-item ${c.is_closed ? 'closed' : ''}">
        <div class="cond-icon">${c.is_closed ? '✅' : '⬜'}</div>
        <div class="cond-desc">${api.fmt.escape(c.description)}</div>
      </div>`).join('')}
    </div>` : ''}
  </div>`;
}

// hasReturnedDocs: true when approver returned at least one document — only NO-GO is allowed
function renderDecisionForm(stageNum, hasReturnedDocs = false) {
  const blockGo = hasReturnedDocs;

  return `<div class="card">
    <div class="card-header"><h3>Record Gate Decision</h3></div>
    <div class="card-body">
      ${blockGo ? `<div class="error-msg" style="margin-bottom:16px;">
        <svg width="14" height="13" viewBox="0 0 14 13" fill="none" style="vertical-align:middle;margin-right:4px;"><polygon points="7,1 13.5,12.5 0.5,12.5" stroke="currentColor" stroke-width="1.8" stroke-linejoin="miter"/><line x1="7" y1="5" x2="7" y2="8.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="square"/><circle cx="7" cy="10.5" r="0.8" fill="currentColor"/></svg>
        You have returned document(s) to the project team.
        <strong>GO and Conditional decisions are locked</strong> while documents remain Outstanding.
        You may record NO-GO, or undo the document return and re-approve the documents first.
      </div>` : ''}
      <form id="decision-form" class="decision-form">
        <div class="form-group">
          <label>Decision *</label>
          <div class="radio-group">
            <label class="radio-option" style="${blockGo ? 'opacity:0.35;cursor:not-allowed;' : ''}">
              <input type="radio" name="decision" value="go" ${blockGo ? 'disabled' : ''}>
              <svg width="14" height="12" viewBox="0 0 14 12" fill="none" style="vertical-align:middle;color:#16a34a;margin-right:4px;"><polyline points="1.5,6 5,10.5 12.5,1.5" stroke="currentColor" stroke-width="2" stroke-linecap="square" stroke-linejoin="miter"/></svg>
              GO</label>
            <label class="radio-option" style="${blockGo ? 'opacity:0.35;cursor:not-allowed;' : ''}">
              <input type="radio" name="decision" value="conditional" ${blockGo ? 'disabled' : ''}>
              <svg width="14" height="13" viewBox="0 0 14 13" fill="none" style="vertical-align:middle;color:#d97706;margin-right:4px;"><polygon points="7,1 13.5,12.5 0.5,12.5" stroke="currentColor" stroke-width="1.8" stroke-linejoin="miter"/><line x1="7" y1="5" x2="7" y2="8.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="square"/><circle cx="7" cy="10.5" r="0.8" fill="currentColor"/></svg>
              Conditional</label>
            <label class="radio-option">
              <input type="radio" name="decision" value="no_go">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style="vertical-align:middle;color:#dc2626;margin-right:4px;"><line x1="1.5" y1="1.5" x2="10.5" y2="10.5" stroke="currentColor" stroke-width="2" stroke-linecap="square"/><line x1="10.5" y1="1.5" x2="1.5" y2="10.5" stroke="currentColor" stroke-width="2" stroke-linecap="square"/></svg>
              NO-GO</label>
          </div>
        </div>
        <div class="form-group">
          <label>Rationale * <span class="form-hint">(becomes part of the permanent gate record)</span></label>
          <textarea id="dec-rationale" rows="4" placeholder="State the basis for your decision…" required></textarea>
        </div>
        <div id="conditions-section" class="form-group hidden">
          <label>Conditions (one per line) *</label>
          <textarea id="dec-conditions" rows="4" placeholder="Each line is a separate condition…"></textarea>
        </div>
        <div id="dec-error" class="error-msg hidden"></div>
        <button type="submit" class="btn btn-primary" id="dec-submit-btn" disabled>Submit Decision</button>
      </form>
    </div>
  </div>`;
}

function wireDecisionForm(form, stageNum) {
  const radios   = form.querySelectorAll('input[type=radio]');
  const condSec  = form.querySelector('#conditions-section');
  const submitBtn= form.querySelector('#dec-submit-btn');
  const errEl    = form.querySelector('#dec-error');

  radios.forEach(r => {
    r.addEventListener('change', () => {
      form.querySelectorAll('.radio-option').forEach(o => {
        const val = o.querySelector('input').value;
        const sel = o.querySelector('input').checked;
        o.className = 'radio-option' + (sel ? ` selected-${val}` : '');
      });
      condSec.classList.toggle('hidden', r.value !== 'conditional');
      submitBtn.disabled = false;
    });
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errEl.classList.add('hidden');

    const decision  = form.querySelector('input[name=decision]:checked')?.value;
    const rationale = form.querySelector('#dec-rationale').value.trim();
    const condText  = form.querySelector('#dec-conditions')?.value ?? '';

    if (!decision)  { errEl.textContent = 'Select a decision.'; errEl.classList.remove('hidden'); return; }
    if (!rationale) { errEl.textContent = 'Rationale is required.'; errEl.classList.remove('hidden'); return; }

    const conditions = decision === 'conditional'
      ? condText.split('\n').map(s => s.trim()).filter(Boolean).map(d => ({ description: d }))
      : undefined;

    if (decision === 'conditional' && (!conditions || conditions.length === 0)) {
      errEl.textContent = 'At least one condition is required for a Conditional decision.';
      errEl.classList.remove('hidden');
      return;
    }

    submitBtn.disabled = true;
    try {
      if (!confirm(`Confirm recording a ${decision.toUpperCase()} decision? This cannot be edited.`)) {
        submitBtn.disabled = false;
        return;
      }
      await api.post(`/api/projects/${projectId}/stages/${stageNum}/decision`, { decision, rationale, conditions });
      await loadProject();
    } catch (err) {
      errEl.textContent = err.message;
      errEl.classList.remove('hidden');
      submitBtn.disabled = false;
    }
  });
}

function renderReopenForm(stageNum) {
  return `<div class="card">
    <div class="card-header"><h3>Re-open Stage (Change Control)</h3></div>
    <div class="card-body">
      <p class="text-sm text-muted" style="margin-bottom:16px;">
        Re-opening starts a new review round. Previous decisions remain on record.
        You must have authority ≥ the original approver.
      </p>
      <form id="reopen-form" class="add-form" style="border:none;padding:0;background:none;">
        <div class="form-group">
          <label>Reason for re-opening *</label>
          <textarea id="reopen-reason" rows="3" required placeholder="State the reason for re-opening this stage…"></textarea>
        </div>
        <div id="reopen-error" class="error-msg hidden"></div>
        <button type="submit" class="btn btn-danger" style="align-self:flex-start;">Re-open Stage</button>
      </form>
    </div>
  </div>`;
}

function wireReopenForm(form, stageNum) {
  const errEl = form.querySelector('#reopen-error');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errEl.classList.add('hidden');
    const reason = form.querySelector('#reopen-reason').value.trim();
    if (!reason) { errEl.textContent = 'Reason is required.'; errEl.classList.remove('hidden'); return; }
    const btn = form.querySelector('button[type=submit]');
    btn.disabled = true;
    try {
      if (!confirm('Re-open this stage? This is a significant change-control action.')) { btn.disabled = false; return; }
      await api.post(`/api/projects/${projectId}/stages/${stageNum}/reopen`, { reason });
      await loadProject();
    } catch (err) {
      errEl.textContent = err.message;
      errEl.classList.remove('hidden');
      btn.disabled = false;
    }
  });
}

// ===========================================================================
// DOCUMENTS TAB
// ===========================================================================
async function renderDocuments(el) {
  const [docs, tpl] = await Promise.all([
    api.get(`/api/projects/${projectId}/documents`),
    api.get(`/api/templates/active${techParam(project.technology)}`),
  ]);

  const canAdd = isAdmin() || isProjectLead();

  // Group by VDR folder
  const byFolder = {};
  docs.forEach(d => {
    const key = d.folder_code;
    if (!byFolder[key]) byFolder[key] = { name: d.folder_name, code: key, items: [] };
    byFolder[key].items.push(d);
  });

  const tableHtml = Object.values(byFolder).sort((a,b) => a.code.localeCompare(b.code)).map(folder => `
    <tr style="background:var(--gray-50);">
      <td colspan="5" style="padding:8px 12px;font-size:12px;font-weight:700;text-transform:uppercase;color:var(--text-muted);">
        ${folder.code}: ${api.fmt.escape(folder.name)}
      </td>
    </tr>
    ${folder.items.map(d => `<tr>
      <td>${api.fmt.escape(d.title)}</td>
      <td>${d.stage_number != null ? `Stage ${d.stage_number}` : '-'}</td>
      <td>${api.fmt.statusBadge(d.status)}</td>
      <td class="text-sm text-muted">${api.fmt.escape(d.uploaded_by_name)} · ${api.fmt.date(d.uploaded_at)}</td>
      <td>${d.file_ref ? `<a href="#" class="text-sm">${api.fmt.escape(d.file_ref)}</a>` : '<span class="text-muted text-sm">No file ref</span>'}</td>
    </tr>`).join('')}
  `).join('');

  const addFormHtml = canAdd ? `
    <div class="add-form mt-24">
      <h4>Add Document</h4>
      <form id="add-doc-form" class="add-form" style="border:none;padding:0;background:none;">
        <div class="form-row">
          <div class="form-group">
            <label>Title *</label>
            <input type="text" id="doc-title" required>
          </div>
          <div class="form-group">
            <label>VDR Folder *</label>
            <select id="doc-folder">
              ${(tpl?.vdr_folders ?? []).map(f => `<option value="${f.folder_code}">${f.folder_code}: ${api.fmt.escape(f.name)}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>Stage</label>
            <select id="doc-stage">
              <option value="">Not stage-specific</option>
              ${STAGE_NAMES.map((n,i) => `<option value="${i}">${i}: ${n}</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label>File reference</label>
            <input type="text" id="doc-fileref" placeholder="filename.pdf or SharePoint URL">
          </div>
        </div>
        <div id="doc-error" class="error-msg hidden"></div>
        <button type="submit" class="btn btn-primary btn-sm" style="align-self:flex-start;">Add Document</button>
      </form>
    </div>` : '';

  el.innerHTML = `
    <div class="card">
      <table class="doc-table">
        <thead>
          <tr>
            <th>Title</th><th>Stage</th><th>Status</th><th>Uploaded by</th><th>File Ref</th>
          </tr>
        </thead>
        <tbody>${docs.length ? tableHtml : `<tr><td colspan="5" class="empty">No documents yet.</td></tr>`}</tbody>
      </table>
    </div>
    ${addFormHtml}`;

  const docForm = el.querySelector('#add-doc-form');
  if (docForm) {
    const errEl = docForm.querySelector('#doc-error');
    docForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      errEl.classList.add('hidden');
      const title    = document.getElementById('doc-title').value.trim();
      const folder   = document.getElementById('doc-folder').value;
      const stageVal = document.getElementById('doc-stage').value;
      const fileRef  = document.getElementById('doc-fileref').value.trim();
      if (!title) { errEl.textContent = 'Title is required.'; errEl.classList.remove('hidden'); return; }
      const btn = docForm.querySelector('button[type=submit]');
      btn.disabled = true;
      try {
        await api.post(`/api/projects/${projectId}/documents`, {
          title, folder_code: folder,
          stage_number: stageVal !== '' ? parseInt(stageVal) : null,
          file_ref: fileRef || null,
          status: 'submitted',
        });
        await renderDocuments(el);
      } catch (err) {
        errEl.textContent = err.message;
        errEl.classList.remove('hidden');
        btn.disabled = false;
      }
    });
  }
}

// ===========================================================================
// AUDIT TRAIL TAB
// ===========================================================================
async function renderAudit(el) {
  const entries = await api.get(`/api/projects/${projectId}/audit`);

  const html = entries.map(e => {
    const label  = ACTION_LABELS[e.action] ?? e.action.replace(/_/g,' ');
    const stage  = e.stage_number != null ? ` · Stage ${e.stage_number}` : '';
    const detail = e.detail ? JSON.stringify(e.detail).substring(0, 120) + (JSON.stringify(e.detail).length > 120 ? '…' : '') : '';
    return `<div class="audit-item">
      <div class="audit-dot"></div>
      <div class="audit-body">
        <div class="audit-action">${api.fmt.escape(label)}${stage}</div>
        <div class="audit-actor">${api.fmt.escape(e.actor_name)} (${api.fmt.escape(e.actor_email)})</div>
        ${detail ? `<div class="audit-detail">${api.fmt.escape(detail)}</div>` : ''}
      </div>
      <div class="audit-time">${api.fmt.dateTime(e.created_at)}</div>
    </div>`;
  }).join('');

  el.innerHTML = `<div class="audit-timeline">${html || '<div class="empty">No audit events recorded yet.</div>'}</div>`;
}

// ===========================================================================
// PROJECT DETAILS EDIT PANEL (admin only)
// ===========================================================================

function showEditProjectPanel() {
  // Remove any existing panel
  document.getElementById('edit-project-panel')?.remove();

  const panel = document.createElement('div');
  panel.id = 'edit-project-panel';
  panel.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:200;display:flex;align-items:center;justify-content:center;padding:24px;';
  panel.innerHTML = `
    <div class="card" style="width:100%;max-width:540px;max-height:90vh;overflow-y:auto;">
      <div class="card-header">
        <h3>Edit Project Details</h3>
        <button class="btn btn-ghost btn-sm" id="epp-close">✕</button>
      </div>
      <div class="card-body" style="display:flex;flex-direction:column;gap:16px;">
        <div class="form-group">
          <label>Project Name *</label>
          <input type="text" id="epp-name" value="${api.fmt.escape(project.name)}">
        </div>
        <div class="form-group">
          <label>Checklist Template</label>
          <input type="text" value="${api.fmt.escape(project.template_version)}" disabled
            style="background:var(--gray-50);color:var(--text-muted);cursor:not-allowed;">
          <div class="form-hint">Template is locked at project creation and cannot be changed.</div>
        </div>
        <div class="form-group">
          <label>CAPEX</label>
          <div class="flex gap-8">
            <input type="number" id="epp-capex-amount" value="${project.capex_amount ?? project.capex_usd}" min="0" style="flex:1;">
            <select id="epp-capex-currency" style="max-width:92px;">
              <option value="USD" ${project.capex_currency !== 'NGN' ? 'selected' : ''}>USD</option>
              <option value="NGN" ${project.capex_currency === 'NGN' ? 'selected' : ''}>NGN</option>
            </select>
          </div>
        </div>
        <div class="form-group ${project.capex_currency === 'NGN' ? '' : 'hidden'}" id="epp-usd-equiv-group">
          <label>USD Equivalent <span class="form-hint">(used for the gate-routing threshold check)</span></label>
          <input type="number" id="epp-capex-usd-equiv" value="${project.capex_currency === 'NGN' ? project.capex_usd : ''}" min="0">
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>Capacity <span class="form-hint">(optional)</span></label>
            <input type="text" id="epp-capacity" value="${api.fmt.escape(project.capacity ?? '')}" placeholder="e.g. 50 MW">
          </div>
          <div class="form-group">
            <label>Location <span class="form-hint">(optional)</span></label>
            <input type="text" id="epp-location" value="${api.fmt.escape(project.location ?? '')}" placeholder="e.g. Kano State, Nigeria">
          </div>
        </div>
        <div class="form-group">
          <label>Description</label>
          <textarea id="epp-desc" rows="2">${api.fmt.escape(project.description ?? '')}</textarea>
        </div>
        <div class="form-group">
          <label>Objectives</label>
          <textarea id="epp-objectives" rows="3" placeholder="State the project objectives…">${api.fmt.escape(project.objectives ?? '')}</textarea>
        </div>
        <div class="form-group">
          <label>Justification</label>
          <textarea id="epp-justification" rows="3" placeholder="State the rationale and strategic fit…">${api.fmt.escape(project.justification ?? '')}</textarea>
        </div>
        <div class="form-group">
          <label>Expected Benefits</label>
          <textarea id="epp-benefits" rows="3" placeholder="Describe expected benefits…">${api.fmt.escape(project.benefits ?? '')}</textarea>
        </div>
        <div id="epp-error" class="error-msg hidden"></div>
        <div class="flex gap-8" style="justify-content:flex-end;">
          <button class="btn btn-ghost" id="epp-cancel">Cancel</button>
          <button class="btn btn-primary" id="epp-save">Save Changes</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(panel);

  const close = () => panel.remove();
  panel.querySelector('#epp-close').addEventListener('click', close);
  panel.querySelector('#epp-cancel').addEventListener('click', close);
  panel.addEventListener('click', e => { if (e.target === panel) close(); });

  const eppCurrencySel = panel.querySelector('#epp-capex-currency');
  eppCurrencySel.addEventListener('change', () => {
    panel.querySelector('#epp-usd-equiv-group').classList.toggle('hidden', eppCurrencySel.value !== 'NGN');
  });

  panel.querySelector('#epp-save').addEventListener('click', async () => {
    const errEl = panel.querySelector('#epp-error');
    errEl.classList.add('hidden');
    const name = panel.querySelector('#epp-name').value.trim();
    if (!name) { errEl.textContent = 'Project name is required.'; errEl.classList.remove('hidden'); return; }

    const capexAmount   = parseFloat(panel.querySelector('#epp-capex-amount').value);
    const capexCurrency = eppCurrencySel.value;
    const capexUsdEquiv = panel.querySelector('#epp-capex-usd-equiv').value;
    if (isNaN(capexAmount) || capexAmount < 0) {
      errEl.textContent = 'Valid CAPEX is required.'; errEl.classList.remove('hidden'); return;
    }
    if (capexCurrency === 'NGN' && (capexUsdEquiv === '' || isNaN(parseFloat(capexUsdEquiv)) || parseFloat(capexUsdEquiv) < 0)) {
      errEl.textContent = 'A USD equivalent is required when CAPEX is quoted in NGN.';
      errEl.classList.remove('hidden'); return;
    }

    const saveBtn = panel.querySelector('#epp-save');
    saveBtn.disabled = true;
    try {
      await api.patch(`/api/projects/${projectId}`, {
        name,
        capex_amount: capexAmount,
        capex_currency: capexCurrency,
        capex_usd_equivalent: capexCurrency === 'NGN' ? parseFloat(capexUsdEquiv) : undefined,
        capacity: panel.querySelector('#epp-capacity').value.trim() || null,
        location: panel.querySelector('#epp-location').value.trim() || null,
        description:   panel.querySelector('#epp-desc').value.trim() || null,
        objectives:    panel.querySelector('#epp-objectives').value.trim() || null,
        justification: panel.querySelector('#epp-justification').value.trim() || null,
        benefits:      panel.querySelector('#epp-benefits').value.trim() || null,
      });
      close();
      await loadProject();
    } catch (err) {
      errEl.textContent = err.message;
      errEl.classList.remove('hidden');
      saveBtn.disabled = false;
    }
  });
}

// ===========================================================================
// PROJECT DELETE MODAL (admin only — type "DELETE" to confirm)
// ===========================================================================

function showDeleteProjectModal() {
  document.getElementById('delete-project-modal')?.remove();

  const modal = document.createElement('div');
  modal.id = 'delete-project-modal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:200;display:flex;align-items:center;justify-content:center;padding:24px;';
  modal.innerHTML = `
    <div class="card" style="width:100%;max-width:440px;">
      <div class="card-header" style="border-left:4px solid var(--red-700);">
        <h3 style="color:var(--red-700);">Delete Project</h3>
        <button class="btn btn-ghost btn-sm" id="dpm-close">✕</button>
      </div>
      <div class="card-body" style="display:flex;flex-direction:column;gap:16px;">
        <p style="font-size:14px;">You are about to permanently archive <strong>${api.fmt.escape(project.name.toUpperCase())}</strong>.
          The project will be removed from the active portfolio. All audit records and gate decisions are preserved.</p>
        <p class="text-sm text-muted">Type <strong>DELETE</strong> below to confirm:</p>
        <input type="text" id="dpm-confirm" placeholder="Type DELETE here" autocomplete="off"
          style="border:2px solid var(--border);border-radius:var(--radius);padding:9px 12px;font-size:14px;width:100%;">
        <div id="dpm-error" class="error-msg hidden"></div>
        <div class="flex gap-8" style="justify-content:flex-end;">
          <button class="btn btn-ghost" id="dpm-cancel">Cancel</button>
          <button class="btn btn-danger" id="dpm-delete" disabled>Delete Project</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(modal);

  const confirmInput = modal.querySelector('#dpm-confirm');
  const deleteBtn    = modal.querySelector('#dpm-delete');
  const errEl        = modal.querySelector('#dpm-error');
  const close        = () => modal.remove();

  modal.querySelector('#dpm-close').addEventListener('click', close);
  modal.querySelector('#dpm-cancel').addEventListener('click', close);
  modal.addEventListener('click', e => { if (e.target === modal) close(); });

  // Enable delete button only when user has typed exactly "DELETE"
  confirmInput.addEventListener('input', () => {
    deleteBtn.disabled = confirmInput.value !== 'DELETE';
  });

  deleteBtn.addEventListener('click', async () => {
    if (confirmInput.value !== 'DELETE') return;
    errEl.classList.add('hidden');
    deleteBtn.disabled = true;
    try {
      await api.delete(`/api/projects/${projectId}`);
      window.location.href = '/'; // return to portfolio
    } catch (err) {
      errEl.textContent = err.message;
      errEl.classList.remove('hidden');
      deleteBtn.disabled = false;
    }
  });
}

// ===========================================================================
// FUTURE STAGE PREVIEW (not_started stages — grayed-out checklist)
// ===========================================================================

function switchToPreviewView(stageNum) {
  viewStage = stageNum;
  document.querySelectorAll('.stage-node').forEach(node => {
    node.classList.toggle('selected', parseInt(node.dataset.stage, 10) === stageNum);
  });
  document.getElementById('tabs-bar').style.display = 'none';
  const el = document.getElementById('section-content');
  renderFutureStagePreview(el, stageNum).catch(e => showErr(el, e));
}

async function renderFutureStagePreview(el, stageNum) {
  el.innerHTML = '<div class="loading">Loading preview…</div>';
  const stageName = STAGE_NAMES[stageNum] ?? `Stage ${stageNum}`;

  let items = [];
  try {
    const data = await api.get(`/api/projects/${projectId}/stages/${stageNum}/checklist`);
    items = data.items ?? [];
  } catch { items = []; }

  const byPillar = {};
  items.forEach(item => {
    if (!byPillar[item.pillar]) byPillar[item.pillar] = [];
    byPillar[item.pillar].push(item);
  });

  const pillarsHtml = Object.entries(byPillar).map(([pillar, pillarItems]) => `
    <div class="pillar-section" style="opacity:0.55;">
      <div class="pillar-header">${PILLAR_LABELS[pillar] ?? pillar}</div>
      <div class="checklist-items">
        ${pillarItems.map(item => renderChecklistItem(item, stageNum, false)).join('')}
      </div>
    </div>`).join('');

  el.innerHTML = `
    <div class="history-banner" style="border-left-color:var(--gray-400);background:var(--gray-50);">
      <div class="history-banner-icon">🔒</div>
      <div class="history-banner-body">
        <strong>Stage ${stageNum}: ${stageName} (Not yet started)</strong>
        <p>Preview of checklist requirements. Items are read-only until this stage opens.</p>
      </div>
      <button class="btn btn-ghost btn-sm" id="back-to-current-btn">← Current stage</button>
    </div>
    ${items.length
      ? pillarsHtml
      : '<div class="empty">No checklist items configured for this stage yet.</div>'}`;

  document.getElementById('back-to-current-btn').addEventListener('click', switchToWorkingView);
}

// ===========================================================================
// GATE DECISION CHAIN VISUALIZATION
// ===========================================================================

/**
 * Renders decision cards with a step-chain indicator on the left.
 * Uses inline styles so layout is guaranteed regardless of CSS cascade.
 * Single decisions get no chain indicator (unchanged look).
 */
function renderDecisionChain(decisions) {
  if (decisions.length <= 1) {
    return `<div class="gate-decisions">${decisions.map(renderDecisionCard).join('')}</div>`;
  }

  // Colour map: decision → [border, background]
  const dotColors = {
    go:          ['#1B6B3A', '#D1F0E0'],
    conditional: ['#EA580C', '#FFEDD5'],
    no_go:       ['#B91C1C', '#FEE2E2'],
  };

  const entries = decisions.map((d, i) => {
    const isLast              = i === decisions.length - 1;
    const [border, bg]        = dotColors[d.decision] ?? ['#9CA3AF', '#F3F4F6'];
    const dotStyle            = `width:14px;height:14px;border-radius:50%;border:2.5px solid ${border};background:${bg};flex-shrink:0;`;
    const lineStyle           = `flex:1;width:2px;margin:5px 0;min-height:28px;background:repeating-linear-gradient(to bottom,#D1D5DB 0,#D1D5DB 5px,transparent 5px,transparent 10px);`;
    const colStyle            = `display:flex;flex-direction:column;align-items:center;flex-shrink:0;padding-top:18px;width:24px;`;
    const cardStyle           = `flex:1;min-width:0;margin-bottom:${isLast ? 0 : 12}px;`;

    return `<div style="display:flex;gap:14px;align-items:stretch;">
      <div style="${colStyle}">
        <div style="${dotStyle}"></div>
        ${isLast ? '' : `<div style="${lineStyle}"></div>`}
      </div>
      <div style="${cardStyle}">${renderDecisionCard(d)}</div>
    </div>`;
  }).join('');

  return `<div style="display:flex;flex-direction:column;">${entries}</div>`;
}

// ===========================================================================
// DOCUMENT EDIT MODAL (uploader editing their own doc, stage in_progress)
// ===========================================================================

async function openDocEditModal(doc, stageNum) {
  // Fetch VDR folders so admin can change the folder if needed
  let folders = [];
  try {
    const tpl = await api.get(`/api/templates/active${techParam(project.technology)}`);
    folders = tpl?.vdr_folders ?? [];
  } catch {}

  const modal = document.createElement('div');
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:200;display:flex;align-items:center;justify-content:center;padding:24px;';
  modal.innerHTML = `
    <div class="card" style="width:100%;max-width:520px;">
      <div class="card-header">
        <h3>Edit Document</h3>
        <button class="btn btn-ghost btn-sm" id="ded-close">✕</button>
      </div>
      <div class="card-body" style="display:flex;flex-direction:column;gap:16px;">
        <div class="form-group">
          <label>Title *</label>
          <input type="text" id="ded-title" value="${api.fmt.escape(doc.title ?? '')}">
        </div>
        <div class="form-group">
          <label>File Reference <span class="form-hint">(URL or filename)</span></label>
          <input type="text" id="ded-fileref" value="${api.fmt.escape(doc.file_ref ?? '')}"
            placeholder="filename.pdf or SharePoint URL">
        </div>
        ${folders.length ? `<div class="form-group">
          <label>VDR Folder</label>
          <select id="ded-folder">
            ${folders.map(f => `<option value="${f.folder_code}"
              ${f.folder_code === doc.folder_code ? 'selected' : ''}>
              ${f.folder_code}: ${api.fmt.escape(f.name)}</option>`).join('')}
          </select>
        </div>` : ''}
        <div class="form-group">
          <label>Notes <span class="form-hint">(optional)</span></label>
          <textarea id="ded-notes" rows="2">${api.fmt.escape(doc.notes ?? '')}</textarea>
        </div>
        <div id="ded-error" class="error-msg hidden"></div>
        <div class="flex gap-8" style="justify-content:flex-end;">
          <button class="btn btn-ghost" id="ded-cancel">Cancel</button>
          <button class="btn btn-primary" id="ded-save">Save Changes</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(modal);

  const close = () => modal.remove();
  modal.querySelector('#ded-close').addEventListener('click', close);
  modal.querySelector('#ded-cancel').addEventListener('click', close);
  modal.addEventListener('click', e => { if (e.target === modal) close(); });

  modal.querySelector('#ded-save').addEventListener('click', async () => {
    const errEl   = modal.querySelector('#ded-error');
    const title   = modal.querySelector('#ded-title').value.trim();
    const fileRef = modal.querySelector('#ded-fileref').value.trim();
    const notes   = modal.querySelector('#ded-notes')?.value.trim() || null;
    errEl.classList.add('hidden');
    if (!title) { errEl.textContent = 'Title is required.'; errEl.classList.remove('hidden'); return; }

    const saveBtn = modal.querySelector('#ded-save');
    saveBtn.disabled = true;
    try {
      await api.patch(`/api/projects/${projectId}/documents/${doc.id}`, {
        title, file_ref: fileRef || null, notes,
      });
      close();
      // Refresh the checklist so the updated document appears
      await renderChecklist(document.getElementById('section-content'));
    } catch (err) {
      errEl.textContent = err.message;
      errEl.classList.remove('hidden');
      saveBtn.disabled = false;
    }
  });
}

// ===========================================================================
// STAGE DOCUMENT HELPERS
// ===========================================================================

const VDR_STATUSES_GATE = ['outstanding','submitted','approved','superseded'];

/**
 * Renders a stage-document section (read-only table + approve/return workflow).
 * @param {Array}   docs        - documents filtered to this stage
 * @param {number}  stageNum    - current stage number
 * @param {boolean} canApprove  - show Approve buttons (gate approver reviewing)
 */
// stageIsOpen: true when stage is in_progress — enables edit button for uploader
function renderStageDocs(docs, stageNum, canApprove, stageIsOpen = false) {
  // Geometric SVG icons — square linecaps, straight lines
  const tickSvg = `<svg width="11" height="9" viewBox="0 0 11 9" fill="none" style="vertical-align:middle;flex-shrink:0;">
    <polyline points="1,4.5 3.5,7.5 10,1" stroke="currentColor" stroke-width="2.2" stroke-linecap="square" stroke-linejoin="miter"/>
  </svg>`;
  const crossSvg = `<svg width="9" height="9" viewBox="0 0 9 9" fill="none" style="vertical-align:middle;flex-shrink:0;">
    <line x1="1" y1="1" x2="8" y2="8" stroke="currentColor" stroke-width="2.2" stroke-linecap="square"/>
    <line x1="8" y1="1" x2="1" y2="8" stroke="currentColor" stroke-width="2.2" stroke-linecap="square"/>
  </svg>`;

  const docRows = docs.map(d => {
    // ---- STATUS CELL ----
    let statusCell;
    if (canApprove) {
      // Gate approver view.
      // Only 'submitted' docs get interactive buttons — 'outstanding'/'draft' are
      // not yet ready for review (the uploader hasn't submitted them), so they just
      // show a plain status badge. 'outstanding' only means "returned" once the
      // approver has explicitly used the Return action on a previously-submitted doc.
      if (d.status === 'submitted') {
        statusCell = `<span style="display:inline-flex;gap:4px;flex-wrap:wrap;align-items:center;">
          <button class="btn btn-primary btn-sm doc-approve-btn"
            data-doc-id="${d.id}" data-action="approve"
            style="background:#1B6B3A;display:inline-flex;align-items:center;gap:5px;">${tickSvg}Approve</button>
          <button class="btn btn-danger btn-sm doc-approve-btn"
            data-doc-id="${d.id}" data-action="return"
            style="font-size:12px;display:inline-flex;align-items:center;gap:5px;">${crossSvg}Return</button>
        </span>`;
      } else if (d.status === 'approved') {
        statusCell = `<span style="display:inline-flex;align-items:center;gap:6px;">
          ${api.fmt.statusBadge('approved')}
          <button class="btn btn-ghost btn-sm doc-approve-btn"
            data-doc-id="${d.id}" data-action="undo-approve"
            style="font-size:11px;color:var(--amber-600);" title="Undo approval">↩ Undo</button>
        </span>`;
      } else if (d.status === 'outstanding') {
        // Distinguish between "returned by a gate approver" and "never submitted yet".
        // If updated_by is a gate approver on this project, the approver explicitly
        // returned it and can undo. Otherwise it is just in its initial state.
        const wasReturned = d.updated_by != null &&
          project.members.some(m => m.user_id === d.updated_by && m.role === 'gate_approver');

        if (wasReturned) {
          statusCell = `<span style="display:inline-flex;align-items:center;gap:6px;">
            <span class="badge badge-red" style="font-size:11px;">Returned to team</span>
            <button class="btn btn-ghost btn-sm doc-approve-btn"
              data-doc-id="${d.id}" data-action="undo-return"
              style="font-size:11px;color:var(--text-muted);" title="Undo return">↩ Undo</button>
          </span>`;
        } else {
          // Not yet submitted for review — show a plain badge, no action for the approver
          statusCell = api.fmt.statusBadge(d.status);
        }
      } else {
        // draft or any other status
        statusCell = api.fmt.statusBadge(d.status);
      }
    } else {
      statusCell = api.fmt.statusBadge(d.status);
    }

    const fileRef = d.file_ref
      ? `<a href="${api.fmt.escape(d.file_ref)}" target="_blank" class="text-sm">${api.fmt.escape(d.file_ref)}</a>`
      : '<span class="text-muted text-sm">-</span>';

    // Edit button: uploader can edit their own doc when stage is open and doc is editable
    const canEdit = stageIsOpen
      && d.uploaded_by === currentUser?.id
      && !['submitted', 'approved'].includes(d.status);
    const editBtn = canEdit
      ? `<button class="btn btn-ghost btn-sm sdoc-edit-btn"
           data-doc-id="${d.id}"
           style="padding:3px 8px;font-size:13px;" title="Edit document">✏️</button>`
      : '';

    // Delete button: uploader only, non-submitted/approved docs
    const canDelete = d.uploaded_by === currentUser?.id
      && !['submitted', 'approved'].includes(d.status);
    const deleteBtn = canDelete
      ? `<button class="btn btn-ghost btn-sm sdoc-delete-btn"
           data-doc-id="${d.id}" data-title="${api.fmt.escape(d.title)}"
           style="color:var(--red-700);padding:3px 8px;font-size:12px;">✕</button>`
      : '';

    return `<tr>
      <td>${api.fmt.escape(d.title)}</td>
      <td class="text-sm text-muted">${d.folder_code ?? ''} ${d.folder_name ? ': ' + api.fmt.escape(d.folder_name) : ''}</td>
      <td>${statusCell}</td>
      <td>${fileRef}</td>
      <td class="text-sm text-muted">${api.fmt.escape(d.uploaded_by_name ?? d.uploaded_by ?? '')}</td>
      <td style="display:flex;gap:2px;">${editBtn}${deleteBtn}</td>
    </tr>`;
  }).join('');

  const tableHtml = docs.length
    ? `<table class="doc-table" style="width:100%;">
        <thead><tr>
          <th>Title</th><th>VDR Folder</th><th>Status</th><th>File Reference</th><th>Uploaded By</th><th></th>
        </tr></thead>
        <tbody>${docRows}</tbody>
       </table>`
    : '<p class="text-sm text-muted" style="padding:12px 0;">No documents submitted for this stage yet.</p>';

  // Documents are added by attaching them to an evidence note when ticking a
  // checklist item (see showEvidenceModal) -- there's no standalone add-form
  // here any more.
  return `<div class="stage-doc-section">
    <h3 class="stage-doc-heading">
      Stage ${stageNum} Documents
      ${canApprove ? '<span class="badge badge-amber" style="margin-left:8px;font-size:11px;">Review &amp; Approve</span>' : ''}
    </h3>
    <div class="card" style="overflow:hidden;">${tableHtml}</div>
  </div>`;
}

// ===========================================================================
// HISTORY SNAPSHOT (approved stages)
// ===========================================================================

/**
 * Renders a read-only snapshot of a completed stage.
 * Uses three existing endpoints — no new API calls needed:
 *   /stages/:stage/checklist   — final checklist state
 *   /stages/:stage/decisions   — gate decisions (with basic condition data)
 *   /stages/:stage/conditions  — conditions with closure names
 */
async function renderHistorySnapshot(el, stageNumber) {
  el.innerHTML = '<div class="loading">Loading stage history…</div>';

  const stageName  = STAGE_NAMES[stageNumber] ?? `Stage ${stageNumber}`;
  const stageData  = project.stages.find(s => s.stage_number === stageNumber);

  const [checklistData, decisions, conditions] = await Promise.all([
    api.get(`/api/projects/${projectId}/stages/${stageNumber}/checklist`),
    api.get(`/api/projects/${projectId}/stages/${stageNumber}/decisions`),
    api.get(`/api/projects/${projectId}/stages/${stageNumber}/conditions`).catch(() => []),
  ]);
  const items = checklistData.items ?? [];

  // Group checklist items by pillar (same logic as working view)
  const byPillar = {};
  items.forEach(item => {
    if (!byPillar[item.pillar]) byPillar[item.pillar] = [];
    byPillar[item.pillar].push(item);
  });

  const pillarsHtml = Object.entries(byPillar).map(([pillar, pillarItems]) => `
    <div class="pillar-section">
      <div class="pillar-header">${PILLAR_LABELS[pillar] ?? pillar}</div>
      <div class="checklist-items">
        ${pillarItems.map(item => renderChecklistItem(item, stageNumber, false)).join('')}
      </div>
    </div>
  `).join('');

  // Gate decisions — show oldest first (chain order) then by round
  const sortedDecisions = [...decisions].sort((a, b) =>
    a.review_round - b.review_round || a.chain_position - b.chain_position
  );
  const stampsHtml = sortedDecisions.length
    ? sortedDecisions.map(d => renderHistoryDecisionStamp(d, conditions)).join('')
    : '<div class="empty">No gate decisions recorded for this stage.</div>';

  const submittedLabel = stageData?.submitted_at
    ? `Submitted ${api.fmt.date(stageData.submitted_at)} · CAPEX locked at ${api.fmt.currency(stageData.capex_at_submission)}`
    : '';

  el.innerHTML = `
    <div class="history-banner">
      <div class="history-banner-icon">📋</div>
      <div class="history-banner-body">
        <strong>Historical view | Stage ${stageNumber}: ${stageName}</strong>
        <p>This stage is complete. All data below is read-only.</p>
      </div>
      <button class="btn btn-ghost btn-sm" id="back-to-current-btn">← Current stage</button>
    </div>

    ${stageData?.submission_summary ? `
    <div class="gate-status-box" style="margin-bottom:20px;">
      <div style="font-size:13px;font-weight:700;margin-bottom:6px;">Stage Gate Summary</div>
      <div style="font-size:13px;color:var(--gray-700);line-height:1.55;white-space:pre-wrap;">${api.fmt.escape(stageData.submission_summary)}</div>
    </div>` : ''}

    <div style="margin-bottom:32px;">
      <div class="flex items-center justify-between" style="margin-bottom:16px;">
        <h3 style="font-size:15px;font-weight:700;">Checklist at approval</h3>
        ${submittedLabel ? `<span class="text-sm text-muted">${submittedLabel}</span>` : ''}
      </div>
      ${items.length ? pillarsHtml : '<div class="empty">No checklist items for this stage.</div>'}
    </div>

    <div>
      <h3 style="font-size:15px;font-weight:700;margin-bottom:16px;">Gate Decision</h3>
      <div class="gate-decisions">${stampsHtml}</div>
    </div>`;

  document.getElementById('back-to-current-btn').addEventListener('click', switchToWorkingView);
}

/**
 * Renders one decision as a history stamp.
 * Merges condition detail (with closed_by_name) from the conditions endpoint
 * into the decision card, keyed by gate_decision_id.
 */
function renderHistoryDecisionStamp(d, allConditions) {
  const decisionConditions = allConditions.filter(c => c.gate_decision_id === d.id);

  const decisionBadgeClass = { go: 'badge-green', conditional: 'badge-orange', no_go: 'badge-red' }[d.decision] || 'badge-gray';
  const decisionText = d.decision.replace(/_/g, '-').toUpperCase();

  const roundTag = d.review_round > 1
    ? `<span class="badge badge-amber" style="margin-left:6px;">Round ${d.review_round}</span>`
    : '';
  const chainTag = d.chain_position > 1
    ? `<span class="text-muted text-sm" style="margin-left:6px;">Chain ${d.chain_position}</span>`
    : '';

  const condHtml = decisionConditions.length ? `
    <div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--border);">
      <div style="font-size:12px;font-weight:700;color:var(--text-muted);margin-bottom:8px;text-transform:uppercase;letter-spacing:0.04em;">
        Conditions (${decisionConditions.filter(c => c.is_closed).length}/${decisionConditions.length} resolved)
      </div>
      ${decisionConditions.map(c => `
        <div class="condition-item ${c.is_closed ? 'closed' : ''}" style="margin-bottom:4px;">
          <div class="cond-icon">${c.is_closed ? '✅' : '⬜'}</div>
          <div class="cond-desc">
            <div>${api.fmt.escape(c.description)}</div>
            ${c.is_closed ? `
              <div class="cond-evidence">↳ ${api.fmt.escape(c.evidence_note ?? '')}</div>
              <div class="cond-closed-by">Closed by ${api.fmt.escape(c.closed_by_name ?? '?')} · ${api.fmt.date(c.closed_at)}</div>
            ` : '<div class="cond-closed-by" style="color:var(--red-700);">Not resolved</div>'}
          </div>
        </div>`).join('')}
    </div>` : '';

  return `<div class="decision-card">
    <div class="decision-header ${d.decision}">
      <div class="flex items-center" style="flex-wrap:wrap;gap:6px;">
        <span class="badge ${decisionBadgeClass}" style="font-size:13px;padding:4px 14px;">${decisionText}</span>
        <span class="text-muted" style="font-size:13px;">${d.authority.replace(/_/g, '-').toUpperCase()}</span>
        ${roundTag}${chainTag}
      </div>
      <span class="text-sm text-muted">${api.fmt.dateTime(d.created_at)}</span>
    </div>
    <div class="decision-rationale">
      <div style="font-size:13px;margin-bottom:6px;">
        <strong>${api.fmt.escape(d.decided_by_name)}</strong>
        <span class="text-muted"> · ${api.fmt.escape(d.decided_by_email)}</span>
      </div>
      ${api.fmt.escape(d.rationale)}
    </div>
    ${condHtml}
  </div>`;
}

// ===========================================================================
// RACI TAB (all members read; admin edits)
// ===========================================================================
const RACI_CODES = ['', 'R', 'A', 'C', 'I'];

async function renderRaci(el) {
  const data = await api.get(`/api/projects/${projectId}/raci`);
  const canEdit = canManageTeam(); // admin always; PM only on their own/led projects

  if (!data.members || data.members.length === 0) {
    el.innerHTML = `<div class="empty">No team members assigned yet. Add members in the Team tab first.</div>`;
    return;
  }

  // Group activities
  const groups = {};
  data.activities.forEach(a => {
    if (!groups[a.group]) groups[a.group] = [];
    groups[a.group].push(a.key);
  });

  const memberHeaders = data.members.map(m =>
    `<th title="${api.fmt.escape(m.email)}">${api.fmt.escape(m.full_name.split(' ')[0])}<br>
     <span style="font-weight:400;text-transform:none;letter-spacing:0;font-size:10px;color:var(--text-muted);">${m.role.replace(/_/g,' ')}</span></th>`
  ).join('');

  const buildRows = (activities) => activities.map(actKey => {
    const cells = data.members.map(m => {
      const code = data.cells[actKey]?.[m.user_id] ?? '';
      if (canEdit) {
        const opts = RACI_CODES.map(c => `<option value="${c}" ${c === code ? 'selected' : ''}>${c}</option>`).join('');
        return `<td><select class="raci-select" data-val="${code}" data-activity="${api.fmt.escape(actKey)}" data-uid="${m.user_id}">${opts}</select></td>`;
      }
      return `<td>${code ? `<span class="raci-badge raci-badge-${code}">${code}</span>` : ''}</td>`;
    }).join('');
    return `<tr><td class="raci-activity">${api.fmt.escape(actKey)}</td>${cells}</tr>`;
  }).join('');

  const tableBody = Object.entries(groups).map(([group, activities]) => `
    <tr class="raci-group-header"><td colspan="${data.members.length + 1}">${group}</td></tr>
    ${buildRows(activities)}`
  ).join('');

  el.innerHTML = `
    <div class="raci-wrapper">
      <table class="raci-table">
        <thead><tr>
          <th class="raci-activity-col">Activity</th>
          ${memberHeaders}
        </tr></thead>
        <tbody>${tableBody}</tbody>
      </table>
    </div>
    <div class="raci-legend">
      <div class="raci-legend-item"><span class="raci-badge raci-badge-R">R</span> Responsible: does the work</div>
      <div class="raci-legend-item"><span class="raci-badge raci-badge-A">A</span> Accountable: owns the outcome</div>
      <div class="raci-legend-item"><span class="raci-badge raci-badge-C">C</span> Consulted: provides input</div>
      <div class="raci-legend-item"><span class="raci-badge raci-badge-I">I</span> Informed: kept up to date</div>
    </div>
    ${!canEdit ? '<p class="text-sm text-muted mt-12">Read-only. Contact an admin to update the RACI matrix.</p>' : ''}`;

  if (canEdit) {
    el.querySelectorAll('.raci-select').forEach(sel => {
      sel.addEventListener('change', async () => {
        const activity = sel.dataset.activity;
        const uid      = parseInt(sel.dataset.uid, 10);
        const code     = sel.value || null;
        sel.dataset.val = code ?? '';
        sel.disabled = true;
        try {
          await api.post(`/api/projects/${projectId}/raci`, { activity, user_id: uid, raci_code: code });
        } catch (err) {
          alert('Could not save: ' + err.message);
        } finally {
          sel.disabled = false;
        }
      });
    });
  }
}

// ===========================================================================
// TEAM TAB (admin only)
// ===========================================================================
const ROLE_LABELS = {
  project_lead:  'Project Lead',
  contributor:   'Contributor',
  gate_approver: 'Gate Approver',
  reviewer:      'Reviewer',
  observer:      'Observer / Lender',
};
const ROLE_BADGE_CLASS = {
  project_lead:  'badge-green',
  contributor:   'badge-blue',
  gate_approver: 'badge-amber',
  reviewer:      'badge-outline',
  observer:      'badge-gray',
};
// Gate-level authority labels (used for approver chain display)
const AUTHORITY_LABELS = {
  m1_nnpc:    'M1: NNPC Group',
  m2_evp:     'M2: EVP',
  m4_ed_cam:  'M4: ED-CAM',
  nnel_board: 'NNEL Board',
  m3_md_nnel: 'M3: MD-NNEL',
  slt_mtc:    'SLT-MTC',
};

// All authority levels (for dropdowns)
const ALL_AUTHORITY_OPTIONS = [
  { value: 'm1_nnpc',    label: 'M1: NNPC Group' },
  { value: 'm2_evp',     label: 'M2: EVP' },
  { value: 'nnel_board', label: 'NNEL Board' },
  { value: 'm3_md_nnel', label: 'M3: MD-NNEL' },
  { value: 'slt_mtc',    label: 'SLT-MTC' },
  { value: 'm4_ed_cam',  label: 'M4: ED-CAM' },
  { value: 'm5_manager', label: 'M5: Manager' },
  { value: 'm6_dm',      label: 'M6: DM' },
  { value: 'ss',         label: 'SS: Senior Staff' },
  { value: 'external',   label: 'External' },
];

const ALL_WORKSTREAM_OPTIONS = [
  { value: 'technical',      label: 'Technical' },
  { value: 'commercial',     label: 'Commercial' },
  { value: 'finance',        label: 'Finance' },
  { value: 'legal',          label: 'Legal' },
  { value: 'risk',           label: 'Risk' },
  { value: 'esg',            label: 'ESG' },
  { value: 'administrative', label: 'Administrative' },
  { value: 'external',       label: 'External' },
];

async function renderTeam(el) {
  const adminView = canManageTeam();
  let allUsers = [];
  if (adminView) {
    try { allUsers = await api.get('/api/users'); } catch {}
  }
  const activeUsers = allUsers.filter(u => u.is_active);

  el.innerHTML = buildTeamHtml(adminView);

  // Non-admin members see a read-only table — no event wiring needed
  if (!adminView) return;

  // ---- tracked changes: keyed by "uid|originalRole" ----
  // Each entry: { uid, originalRole, role, workstream, authority }
  const changes = {};  // pending edits not yet saved

  function rowKey(uid, originalRole) { return `${uid}|${originalRole}`; }

  function getOrInit(uid, originalRole) {
    const k = rowKey(uid, originalRole);
    if (!changes[k]) {
      const m = project.members.find(m => m.user_id === uid && m.role === originalRole);
      // Fall back to user_authority / user_workstream so the initial state
      // matches what the dropdowns are displaying even when member_authority
      // hasn't been written to the DB yet (freshly-added members).
      changes[k] = {
        uid, originalRole,
        role:      originalRole,
        workstream: m?.workstream      || m?.user_workstream || null,
        authority:  m?.member_authority || m?.user_authority  || null,
      };
    }
    return changes[k];
  }

  function markDirty() {
    const btn = el.querySelector('#team-save-btn');
    if (btn) { btn.disabled = false; btn.style.opacity = '1'; }
  }

  // Role dropdowns — track change only, no API call
  el.querySelectorAll('.team-role-select').forEach(sel => {
    sel.addEventListener('change', () => {
      const uid = parseInt(sel.dataset.uid, 10);
      const c   = getOrInit(uid, sel.dataset.role);
      c.role    = sel.value;
      markDirty();
    });
  });

  // Workstream dropdowns — track only
  el.querySelectorAll('.team-ws-select').forEach(sel => {
    sel.addEventListener('change', () => {
      const uid = parseInt(sel.dataset.uid, 10);
      const c   = getOrInit(uid, sel.dataset.role);
      c.workstream = sel.value || null;
      markDirty();
    });
  });

  // Authority dropdowns — track only
  el.querySelectorAll('.team-auth-select').forEach(sel => {
    sel.addEventListener('change', () => {
      const uid = parseInt(sel.dataset.uid, 10);
      const c   = getOrInit(uid, sel.dataset.role);
      c.authority = sel.value || null;
      markDirty();
    });
  });

  // ---- Save button: commit all pending changes ----
  el.querySelector('#team-save-btn')?.addEventListener('click', async () => {
    const saveBtn  = el.querySelector('#team-save-btn');
    const saveErr  = el.querySelector('#team-save-error');
    saveBtn.disabled = true;
    saveErr?.classList.add('hidden');

    const gateAuths = ['m1_nnpc','m2_evp','nnel_board','m3_md_nnel','slt_mtc','m4_ed_cam'];
    const entries   = Object.values(changes);
    let errMsg = '';

    for (const c of entries) {
      try {
        if (c.role !== c.originalRole) {
          // Role changed: delete old row + insert new row.
          // If the insert fails, restore the original row so the member isn't lost.
          await api.delete(`/api/projects/${projectId}/members/${c.uid}/${c.originalRole}`);
          try {
            await api.post(`/api/projects/${projectId}/members`, {
              user_id:           c.uid,
              role:              c.role,
              workstream:        c.role === 'contributor' ? c.workstream : null,
              approver_authority: (c.role === 'gate_approver' && gateAuths.includes(c.authority))
                                   ? c.authority : null,
            });
          } catch (insertErr) {
            // Rollback: restore original role so the member isn't removed
            try {
              await api.post(`/api/projects/${projectId}/members`, {
                user_id: c.uid, role: c.originalRole,
                workstream: c.originalRole === 'contributor' ? c.workstream : null,
              });
            } catch { /* best effort */ }
            throw insertErr; // re-throw so outer catch logs it
          }
        } else {
          // Same role: patch workstream + authority
          const body = {
            workstream:      c.workstream,
            member_authority: c.authority,
          };
          if (c.role === 'gate_approver' && gateAuths.includes(c.authority)) {
            body.approver_authority = c.authority;
          }
          await api.patch(`/api/projects/${projectId}/members/${c.uid}/${c.role}`, body);
        }
      } catch (err) {
        errMsg = err.message;
      }
    }

    // Reload fresh data from server — this is the ground truth
    await loadProject();

    if (errMsg && saveErr) {
      saveErr.textContent = `Some changes could not be saved: ${errMsg}`;
      saveErr.classList.remove('hidden');
    }
  });

  // Remove buttons
  el.querySelectorAll('.remove-member-btn').forEach(btn =>
    btn.addEventListener('click', () => handleRemoveMember(btn)));
  el.querySelectorAll('.remove-authority-btn').forEach(btn =>
    btn.addEventListener('click', () => handleRemoveAuthority(btn)));

  // "Add Team Members" button
  el.querySelector('#open-add-members-btn')?.addEventListener('click', () =>
    openAddMembersModal(activeUsers));
}

function buildTeamHtml(adminView = false) {
  const members = project.members ?? [];

  // ---- Read-only view (non-admin project members) ----
  if (!adminView) {
    const ROLE_LABEL = {
      project_lead: 'Project Lead', contributor: 'Contributor',
      gate_approver: 'Gate Approver', reviewer: 'Reviewer', observer: 'Observer',
    };
    const ROLE_BADGE = {
      project_lead: 'badge-green', contributor: 'badge-blue',
      gate_approver: 'badge-amber', reviewer: 'badge-gray', observer: 'badge-gray',
    };
    const rows = members.length === 0
      ? `<tr><td colspan="5" class="empty" style="padding:24px;text-align:center;">No team members assigned.</td></tr>`
      : members.map(m => {
          const roleLabel = ROLE_LABEL[m.role] ?? m.role.replace(/_/g,' ');
          const roleCls   = ROLE_BADGE[m.role] ?? 'badge-gray';
          const ws   = m.workstream || m.user_workstream;
          const auth = m.member_authority || m.user_authority;
          const expiry = m.role === 'observer' && m.access_expires_at
            ? ` <span class="badge ${new Date(m.access_expires_at) < new Date() ? 'badge-red' : 'badge-gray'}" style="margin-left:4px;">Exp ${api.fmt.date(m.access_expires_at)}</span>` : '';
          const isMe = m.user_id === currentUser?.id;
          return `<tr style="${isMe ? 'background:var(--green-50);' : ''}">
            <td><strong>${api.fmt.escape(m.full_name)}</strong>${isMe ? ' <span class="badge badge-green" style="font-size:10px;">You</span>' : ''}</td>
            <td class="text-sm text-muted">${api.fmt.escape(m.email)}</td>
            <td><span class="badge ${roleCls}">${roleLabel}</span>${expiry}</td>
            <td class="text-sm text-muted">${ws ? ws.replace(/_/g,' ') : '-'}</td>
            <td class="text-sm text-muted">${auth ? auth.replace(/_/g,'-').toUpperCase() : '-'}</td>
          </tr>`;
        }).join('');

    return `
      <div class="card">
        <div class="card-header">
          <h3>Project Team (${members.length})</h3>
          <span class="text-sm text-muted">Contact an admin to make changes</span>
        </div>
        <div style="overflow-x:auto;">
          <table class="doc-table" style="width:100%;min-width:600px;">
            <thead><tr><th>Name</th><th>Email</th><th>Project Role</th><th>Workstream</th><th>Authority</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </div>`;
  }

  // ---- Admin editable view ----
  const wsOpts  = `<option value=""></option>` + ALL_WORKSTREAM_OPTIONS.map(w =>
    `<option value="${w.value}">${w.label}</option>`).join('');
  const authOpts = `<option value=""></option>` + ALL_AUTHORITY_OPTIONS.map(a =>
    `<option value="${a.value}">${a.label}</option>`).join('');

  const rows = members.length === 0
    ? `<tr><td colspan="6" class="empty" style="padding:24px;text-align:center;">No team members yet. Click Add Team Members to get started.</td></tr>`
    : members.map(m => {
        const ws    = m.workstream     || m.user_workstream || '';
        const auth  = m.member_authority || m.user_authority || 'ss';
        const expiry = m.role === 'observer' && m.access_expires_at
          ? `<span class="badge ${new Date(m.access_expires_at) < new Date() ? 'badge-red' : 'badge-gray'}" style="margin-left:4px;">Exp ${api.fmt.date(m.access_expires_at)}</span>` : '';

        const roleOpts = [
          ['project_lead', 'Project Lead'],
          ['contributor',  'Contributor'],
          ['gate_approver','Gate Approver'],
          ['reviewer',     'Reviewer'],
          ['observer',     'Observer'],
        ].map(([v,l]) => `<option value="${v}" ${m.role===v?'selected':''}>${l}</option>`).join('');

        return `<tr>
          <td><strong>${api.fmt.escape(m.full_name)}</strong></td>
          <td class="text-sm text-muted">${api.fmt.escape(m.email)}</td>
          <td>
            <select class="team-pill-select team-role-select role-${m.role}" data-uid="${m.user_id}" data-role="${m.role}">
              ${roleOpts}
            </select>
            ${expiry}
          </td>
          <td>
            <select class="team-pill-select team-ws-select ws-pill" data-uid="${m.user_id}" data-role="${m.role}">
              ${wsOpts.replace(`value="${ws}"`, `value="${ws}" selected`)}
            </select>
          </td>
          <td>
            <select class="team-pill-select team-auth-select auth-pill" data-uid="${m.user_id}" data-role="${m.role}">
              ${authOpts.replace(`value="${auth}"`, `value="${auth}" selected`)}
            </select>
          </td>
          <td>
            <button class="btn btn-ghost btn-sm remove-member-btn"
              data-user-id="${m.user_id}" data-role="${m.role}"
              data-name="${api.fmt.escape(m.full_name)}">✕</button>
          </td>
        </tr>`;
      }).join('');

  return `
    <div class="card">
      <div class="card-header">
        <h3>Current Members (${members.length})</h3>
        <div class="flex gap-8" style="align-items:center;">
          <button class="btn btn-primary btn-sm" id="team-save-btn"
            disabled style="opacity:0.4;transition:opacity .2s;">Save Changes</button>
          <button class="btn btn-primary btn-sm" id="open-add-members-btn">+ Add Team Members</button>
        </div>
      </div>
      <div id="team-save-error" class="error-msg hidden" style="margin:8px 16px 0;"></div>
      <div style="overflow-x:auto;">
        <table class="doc-table" style="width:100%;min-width:700px;">
          <thead><tr>
            <th>Name</th><th>Email</th><th>Project Role</th>
            <th>Workstream</th><th>Authority</th><th style="width:40px;"></th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;
}

// Open the batch-add modal — admin picks multiple users from a checklist
function openAddMembersModal(activeUsers) {
  document.getElementById('add-members-modal')?.remove();
  const existing = new Set(project.members.map(m => m.user_id));
  const available = activeUsers.filter(u => !existing.has(u.id));

  const userRows = available.length === 0
    ? '<p class="empty" style="padding:16px;">All active users are already on this project.</p>'
    : available.map(u => `
        <label style="display:flex;align-items:center;gap:12px;padding:10px 16px;cursor:pointer;border-bottom:1px solid var(--border);">
          <input type="checkbox" class="add-member-cb" value="${u.id}"
            style="width:16px;height:16px;accent-color:var(--green-700);">
          <div style="flex:1;min-width:0;">
            <div style="font-weight:600;font-size:14px;">${api.fmt.escape(u.full_name)}</div>
            <div style="font-size:12px;color:var(--text-muted);">${api.fmt.escape(u.email)}
              ${u.workstream ? ` · ${u.workstream}` : ''}
              ${u.authority  ? ` · ${ALL_AUTHORITY_OPTIONS.find(a=>a.value===u.authority)?.label ?? u.authority}` : ''}
            </div>
          </div>
        </label>`).join('');

  const modal = document.createElement('div');
  modal.id = 'add-members-modal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:200;display:flex;align-items:center;justify-content:center;padding:24px;';
  modal.innerHTML = `
    <div class="card" style="width:100%;max-width:520px;max-height:80vh;display:flex;flex-direction:column;">
      <div class="card-header">
        <h3>Add Team Members</h3>
        <button class="btn btn-ghost btn-sm" id="amm-close">✕</button>
      </div>
      <div style="padding:10px 16px;border-bottom:1px solid var(--border);font-size:12px;color:var(--text-muted);">
        Selected users will be added as <strong>Contributor</strong> by default.
        Change their role inline in the table afterwards.
      </div>
      <div style="overflow-y:auto;flex:1;">${userRows}</div>
      <div style="padding:14px 16px;border-top:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;gap:12px;">
        <span id="amm-selected-count" class="text-sm text-muted">0 selected</span>
        <div class="flex gap-8">
          <button class="btn btn-ghost btn-sm" id="amm-cancel">Cancel</button>
          <button class="btn btn-primary btn-sm" id="amm-confirm" disabled>Add Selected</button>
        </div>
      </div>
      <div id="amm-error" class="error-msg hidden" style="margin:0 16px 12px;"></div>
    </div>`;
  document.body.appendChild(modal);

  const close = () => modal.remove();
  modal.querySelector('#amm-close').addEventListener('click', close);
  modal.querySelector('#amm-cancel').addEventListener('click', close);
  modal.addEventListener('click', e => { if (e.target === modal) close(); });

  const countEl  = modal.querySelector('#amm-selected-count');
  const confirmBtn = modal.querySelector('#amm-confirm');

  modal.querySelectorAll('.add-member-cb').forEach(cb => {
    cb.addEventListener('change', () => {
      const n = modal.querySelectorAll('.add-member-cb:checked').length;
      countEl.textContent = `${n} selected`;
      confirmBtn.disabled = n === 0;
    });
  });

  confirmBtn.addEventListener('click', async () => {
    const errEl   = modal.querySelector('#amm-error');
    const checked = [...modal.querySelectorAll('.add-member-cb:checked')].map(cb => parseInt(cb.value, 10));
    errEl.classList.add('hidden');
    confirmBtn.disabled = true;
    let failed = 0, lastErr = '';
    for (const uid of checked) {
      const u = activeUsers.find(u => u.id === uid);
      try {
        await api.post(`/api/projects/${projectId}/members`, {
          user_id: uid, role: 'contributor',
          workstream: u?.workstream || null,
        });
      } catch (err) { failed++; lastErr = err.message || String(err); }
    }
    if (failed > 0) {
      errEl.textContent = failed === checked.length
        ? `Could not add members: ${lastErr}`
        : `${failed} of ${checked.length} user(s) were not added: ${lastErr}`;
      errEl.classList.remove('hidden');
      confirmBtn.disabled = false;
      if (failed < checked.length) { close(); await loadProject(); } // partial success
    } else {
      close();
      await loadProject();
    }
  });
}

function toggleConditionalFields(el) {
  const role = el.querySelector('#mem-role').value;
  el.querySelector('#mem-workstream-group').classList.toggle('hidden', role !== 'contributor');
  el.querySelector('#mem-authority-group').classList.toggle('hidden', role !== 'gate_approver');
  el.querySelector('#mem-expiry-group').classList.toggle('hidden', role !== 'observer');
}

async function handleAddMember(e, el) {
  e.preventDefault();
  const errEl = el.querySelector('#add-member-error');
  errEl.classList.add('hidden');

  const userId    = parseInt(el.querySelector('#mem-user').value, 10);
  const role      = el.querySelector('#mem-role').value;
  const workstream = el.querySelector('#mem-workstream').value;
  const authority  = el.querySelector('#mem-authority').value;
  const expiry     = el.querySelector('#mem-expiry').value;

  if (!userId) { errEl.textContent = 'Please select a user.'; errEl.classList.remove('hidden'); return; }
  if (!role)   { errEl.textContent = 'Please select a project role.'; errEl.classList.remove('hidden'); return; }
  if (role === 'observer' && !expiry) {
    errEl.textContent = 'An access expiry date is required for Observers.';
    errEl.classList.remove('hidden');
    return;
  }

  const body = { user_id: userId, role };
  if (role === 'contributor')   body.workstream          = workstream;
  if (role === 'gate_approver') body.approver_authority  = authority;
  if (role === 'observer')      body.access_expires_at   = expiry + ' 23:59:59';

  const btn = el.querySelector('button[type=submit]');
  btn.disabled = true;
  try {
    await api.post(`/api/projects/${projectId}/members`, body);
    await loadProject();      // re-fetches project (including members) and re-renders Team tab
  } catch (err) {
    errEl.textContent = err.message;
    errEl.classList.remove('hidden');
    btn.disabled = false;
  }
}

async function handleRemoveMember(btn) {
  const userId = btn.dataset.userId;
  const role   = btn.dataset.role;
  const name   = btn.dataset.name;
  if (!confirm(`Remove ${name} from this project?`)) return;
  btn.disabled = true;
  try {
    await api.delete(`/api/projects/${projectId}/members/${userId}/${role}`);
    await loadProject();
  } catch (err) {
    alert('Could not remove member: ' + err.message);
    btn.disabled = false;
  }
}
