/* portfolio.js - portfolio / landing page */
'use strict';

let currentUser   = null;
let allProjects   = [];
let kpis          = null;
let pendingList   = [];
let rejectedList  = [];
let activeFunnel  = null;   // null = all
let filterPending = false;
let filterAtRisk  = false;

const FUNNEL_LABELS = { horizon:'Horizon', hopper:'Hopper', funnel:'Funnel', project:'Project' };
const FUNNEL_ORDER  = ['horizon','hopper','funnel','project'];

document.addEventListener('DOMContentLoaded', async () => {
  currentUser = await api.getMe();
  if (!currentUser) return; // api redirects to login

  api.initSidebar(currentUser);

  if (['admin','project_manager'].includes(currentUser.system_role)) {
    document.getElementById('new-project-btn').classList.remove('hidden');
    setupNewProjectModal();
  }

  renderActiveNow();
  await refresh();
});

// ---------------------------------------------------------------------------
// Active Now - portal-wide presence, visible to everyone on the dashboard
// ---------------------------------------------------------------------------
async function renderActiveNow() {
  const el = document.getElementById('active-now-stack');
  try {
    const users = await api.get('/api/presence/active');
    el.innerHTML = api.buildAvatarStack(users, { emptyText: 'No one else is active right now' });
  } catch {
    el.innerHTML = '<div class="text-sm text-muted">Could not load</div>';
  }
}

async function refresh() {
  [allProjects, kpis] = await Promise.all([
    api.get('/api/portfolio'),
    api.get('/api/portfolio/kpis'),
  ]);

  if (currentUser.system_role !== 'admin') {
    try { pendingList  = await api.get('/api/decisions/pending');  }
    catch { pendingList  = []; }
    try { rejectedList = await api.get('/api/decisions/rejected'); }
    catch { rejectedList = []; }
  }

  renderKPIs();
  renderPending();
  renderRejected();
  renderFunnel();
  renderProjects();
}

// ---------------------------------------------------------------------------
// KPI cards
// ---------------------------------------------------------------------------
function renderKPIs() {
  const el = document.getElementById('kpi-grid');
  if (!kpis) { el.innerHTML = ''; return; }

  el.innerHTML = [
    kpiCard('Active Projects', kpis.total_active, '', 'kpi-green'),
    kpiCard('Awaiting Decision', kpis.awaiting_decisions, 'stages submitted for gate review', kpis.awaiting_decisions > 0 ? 'kpi-alert' : ''),
    kpiCard('Open Conditions', kpis.open_conditions, 'projects with unresolved conditions', kpis.open_conditions > 0 ? 'kpi-alert' : ''),
    kpiCard('At Risk', kpis.at_risk, 'flagged projects', kpis.at_risk > 0 ? 'kpi-danger' : ''),
  ].join('');
}

function kpiCard(label, value, sub, extra = '') {
  return `<div class="kpi-card ${extra}">
    <div class="kpi-label">${label}</div>
    <div class="kpi-value">${value}</div>
    ${sub ? `<div class="kpi-sub">${sub}</div>` : ''}
  </div>`;
}

// ---------------------------------------------------------------------------
// Pending decisions queue (approvers only)
// ---------------------------------------------------------------------------
function renderPending() {
  const el = document.getElementById('pending-section');
  if (!pendingList || pendingList.length === 0) { el.classList.add('hidden'); return; }

  const items = pendingList.map(d => `
    <div class="pending-item">
      <div style="flex:1;min-width:0;">
        <div class="item-project">${api.fmt.escape(d.project_name.toUpperCase())}</div>
        <div class="item-stage">Stage ${d.stage_number}: ${api.fmt.escape(d.stage_name)} · Position ${d.chain_position}/${d.total_in_chain} in chain</div>
      </div>
      <div class="item-wait">${d.days_waiting}d waiting</div>
      <a href="/project.html?id=${d.project_id}&tab=gate" class="btn btn-primary btn-sm">Review</a>
    </div>
  `).join('');

  el.innerHTML = `<div class="pending-section">
    <div class="section-title">${api.icons.clock}Decisions awaiting you (${pendingList.length})</div>
    ${items}
  </div>`;
  el.classList.remove('hidden');
}

// ---------------------------------------------------------------------------
// NO-GO rejection notices (project leads only)
// ---------------------------------------------------------------------------
function renderRejected() {
  const el = document.getElementById('rejected-section');
  if (!rejectedList || rejectedList.length === 0) { el.classList.add('hidden'); return; }

  const svgNoGo = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none" style="vertical-align:middle;flex-shrink:0;"><circle cx="7" cy="7" r="5.5" stroke="currentColor" stroke-width="1.6"/><line x1="4.5" y1="4.5" x2="9.5" y2="9.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="square"/><line x1="9.5" y1="4.5" x2="4.5" y2="9.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="square"/></svg>`;

  const items = rejectedList.map(d => `
    <div class="rejected-item">
      <div class="item-body">
        <div class="item-project">${api.fmt.escape(d.project_name.toUpperCase())}</div>
        <div class="item-stage">Stage ${d.stage_number}: ${api.fmt.escape(d.stage_name)} · NO-GO decision on ${api.fmt.date(d.decided_at)}</div>
        <div class="item-approver">${api.fmt.escape(d.decided_by_name)} · ${d.authority ? d.authority.replace(/_/g,'-').toUpperCase() : ''}</div>
        <div class="item-rationale">"${api.fmt.escape(d.rationale)}"</div>
      </div>
      <a href="/project.html?id=${d.project_id}&tab=gate" class="btn btn-sm" style="background:#fca5a5;color:#7f1d1d;border:none;white-space:nowrap;flex-shrink:0;">View Project</a>
    </div>
  `).join('');

  el.innerHTML = `<div class="rejected-section">
    <div class="section-title">${svgNoGo} Gate returned for revision (${rejectedList.length})</div>
    ${items}
  </div>`;
  el.classList.remove('hidden');
}

// ---------------------------------------------------------------------------
// Funnel filter strip
// ---------------------------------------------------------------------------
function renderFunnel() {
  const counts = kpis?.by_funnel ?? {};
  const el = document.getElementById('funnel-strip');

  const allTab = `<button class="funnel-tab ${activeFunnel === null ? 'active' : ''}" data-funnel="">
    <span class="funnel-count">${kpis?.total_active ?? '-'}</span>
    <span>All Active</span>
  </button>`;

  const tabs = FUNNEL_ORDER.map(f => `
    <button class="funnel-tab ${activeFunnel === f ? 'active' : ''}" data-funnel="${f}">
      <span class="funnel-count">${counts[f] ?? 0}</span>
      <span>${FUNNEL_LABELS[f]}</span>
    </button>
  `).join('');

  el.innerHTML = allTab + tabs;

  el.querySelectorAll('.funnel-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      activeFunnel = btn.dataset.funnel || null;
      el.querySelectorAll('.funnel-tab').forEach(b => b.classList.toggle('active', b === btn));
      renderFilterChips();
      renderProjects();
    });
  });

  renderFilterChips();
}

function renderFilterChips() {
  const el = document.getElementById('filter-chips');
  el.innerHTML = `
    <button class="filter-chip ${filterPending ? 'active' : ''}" id="chip-pending">Awaiting decision</button>
    <button class="filter-chip ${filterAtRisk  ? 'active' : ''}" id="chip-atrisk">At risk</button>
  `;
  document.getElementById('chip-pending').addEventListener('click', () => { filterPending = !filterPending; renderFilterChips(); renderProjects(); });
  document.getElementById('chip-atrisk').addEventListener('click',  () => { filterAtRisk  = !filterAtRisk;  renderFilterChips(); renderProjects(); });
}

// ---------------------------------------------------------------------------
// Project cards grid
// ---------------------------------------------------------------------------
function renderProjects() {
  let filtered = allProjects.filter(p => p.status !== 'cancelled');
  if (activeFunnel)   filtered = filtered.filter(p => p.funnel_stage === activeFunnel);
  if (filterPending)  filtered = filtered.filter(p => p.stage_status === 'submitted');
  if (filterAtRisk)   filtered = filtered.filter(p => p.is_at_risk);

  const label = activeFunnel ? FUNNEL_LABELS[activeFunnel] : 'All Projects';
  document.getElementById('section-title').textContent = `${label} (${filtered.length})`;

  const el = document.getElementById('projects-grid');
  if (filtered.length === 0) {
    el.innerHTML = '<div class="empty">No projects match the current filters.</div>';
    return;
  }

  el.innerHTML = filtered.map(renderProjectCard).join('');
}

function renderProjectCard(p) {
  const isObserver  = p.my_role === 'observer';
  const viewLink    = isObserver ? `/dataroom.html?id=${p.id}` : `/project.html?id=${p.id}`;
  const viewLabel   = isObserver ? 'Data Room →' : 'View →';

  const stageBadge  = api.fmt.statusBadge(p.stage_status);
  const techBadge   = p.technology ? `<span class="badge badge-outline">${api.fmt.escape(p.technology)}</span>` : '';
  const atRiskBadge = p.is_at_risk ? `<span class="badge badge-red">At Risk</span>` : '';
  const condBadge   = p.has_open_conditions ? `<span class="badge badge-orange">Conditions open</span>` : '';
  const vdrBadge    = isObserver ? `<span class="badge badge-blue">Data Room Access</span>` : '';
  const waiting     = p.stage_status === 'submitted' && p.days_since_submitted != null
    ? `<span class="text-sm text-muted">${p.days_since_submitted}d awaiting decision</span>` : '';

  // Overall progress: completed stages + partial credit for current stage checklist.
  // Total stage count comes from THIS project's own template (max_stage_number
  // is 0-indexed, so +1 for the count) -- not a fixed 6, since a lightweight
  // template can have fewer stages. stage_pct is the % of the current stage's
  // checklist done.
  const totalStages = (p.max_stage_number ?? 5) + 1;
  const pct = p.status === 'completed'
    ? 100
    : Math.min(99, Math.round(((p.current_stage + Number(p.stage_pct ?? 0) / 100) / totalStages) * 100));
  const barColor = p.status === 'completed'
    ? 'var(--green-600)'
    : p.is_at_risk
      ? 'var(--red-700)'
      : pct >= 66 ? 'var(--green-600)' : 'var(--green-500)';

  return `<div class="project-card ${p.is_at_risk ? 'at-risk' : ''}">
    <div>
      <div class="card-title">${api.fmt.escape(p.name.toUpperCase())}</div>
      <div class="card-meta mt-8">
        ${techBadge}
        ${vdrBadge}
        ${atRiskBadge}
        ${condBadge}
      </div>
    </div>
    <div class="flex flex-col gap-4">
      <div class="text-sm text-muted">Stage ${p.current_stage}: ${api.fmt.escape(p.stage_name)}</div>
      <div class="flex items-center gap-8">
        ${stageBadge}
        ${waiting}
      </div>
    </div>
    <div style="margin-top:8px;">
      <div style="display:flex;justify-content:space-between;margin-bottom:4px;">
        <span style="font-size:11px;color:var(--text-muted);">
          ${p.status === 'completed' ? 'Complete' : `${pct}% through pipeline`}
        </span>
        <span style="font-size:11px;font-weight:600;color:var(--text-muted);">Stage ${p.current_stage}/${p.max_stage_number ?? 5}</span>
      </div>
      <div style="height:5px;background:var(--gray-200);border-radius:99px;overflow:hidden;">
        <div style="height:100%;width:${pct}%;background:${barColor};border-radius:99px;transition:width .4s;"></div>
      </div>
    </div>
    <div class="card-footer">
      <span class="card-capex">${api.fmt.currency(p.capex_usd)}</span>
      <a href="${viewLink}" class="btn btn-ghost btn-sm">${viewLabel}</a>
    </div>
  </div>`;
}

// ---------------------------------------------------------------------------
// New project modal (admin only)
// ---------------------------------------------------------------------------
function setupNewProjectModal() {
  const modal     = document.getElementById('new-project-modal');
  const openBtn   = document.getElementById('new-project-btn');
  const closeBtn  = document.getElementById('close-modal-btn');
  const cancelBtn = document.getElementById('cancel-modal-btn');
  const form      = document.getElementById('new-project-form');
  const errEl     = document.getElementById('np-error');

  const openModal  = () => { modal.classList.remove('hidden'); };
  const closeModal = () => {
    modal.classList.add('hidden'); form.reset(); errEl.classList.add('hidden');
    document.getElementById('np-usd-equiv-group')?.classList.add('hidden');
  };

  // Cache of all template versions (fetched once on first open)
  let allTemplateVersions = null;

  async function populateTemplatePicker(techDisplay) {
    const TECH_ENUM = { 'Solar PV':'solar_pv', 'Biofuels':'biofuels', 'Abatement':'abatement' };
    const techEnum = TECH_ENUM[techDisplay];
    const sel = document.getElementById('np-template');
    if (!sel) return;
    sel.innerHTML = '<option value="">Loading…</option>';
    if (!techEnum) { sel.innerHTML = '<option value="">Select technology first</option>'; return; }

    if (!allTemplateVersions) {
      // published_only: drafts (still being built in the template editor)
      // must never be selectable for a real project - see DRAFT/PUBLISH in
      // server/routes/templates.js.
      try { allTemplateVersions = await api.get('/api/templates?published_only=true'); }
      catch { allTemplateVersions = []; }
    }

    const versions = allTemplateVersions.filter(v => v.technology === techEnum);
    if (!versions.length) {
      sel.innerHTML = '<option value="">No templates for this technology</option>';
      return;
    }
    sel.innerHTML = versions.map(v =>
      `<option value="${v.id}" ${v.is_active ? 'selected' : ''}>
        ${api.fmt.escape(v.name || v.version)}${v.is_active ? ' (active)' : ''}, by ${api.fmt.escape(v.created_by_name || '?')}
       </option>`
    ).join('');
  }

  openBtn.addEventListener('click', () => {
    openModal();
    const tech = document.getElementById('np-tech')?.value;
    if (tech) populateTemplatePicker(tech);
  });
  closeBtn.addEventListener('click', closeModal);
  cancelBtn.addEventListener('click', closeModal);
  // Deliberately no click-outside-closes-modal: dragging to select text in
  // any of the textareas below and releasing past the modal's edge used to
  // register as "clicked outside" and silently discard the whole form.

  // Refresh template picker when technology changes
  document.getElementById('np-tech')?.addEventListener('change', (e) => {
    populateTemplatePicker(e.target.value);
  });

  // Show the USD-equivalent field only when NGN is selected -- it's the
  // figure the $50M gate-routing threshold check actually uses.
  const currencySel  = document.getElementById('np-capex-currency');
  const usdEquivGroup = document.getElementById('np-usd-equiv-group');
  currencySel?.addEventListener('change', () => {
    usdEquivGroup.classList.toggle('hidden', currencySel.value !== 'NGN');
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errEl.classList.add('hidden');

    const name            = document.getElementById('np-name').value.trim();
    const capexAmount     = parseFloat(document.getElementById('np-capex-amount').value);
    const capexCurrency   = document.getElementById('np-capex-currency').value;
    const capexUsdEquiv   = document.getElementById('np-capex-usd-equiv').value;
    // Capacity is two inputs (value + unit) combined into the one string the
    // backend stores, e.g. "50 MW" -- same format as before this was split,
    // so nothing downstream that displays project.capacity needs to change.
    const capacityValue   = document.getElementById('np-capacity').value.trim();
    const capacityUnit    = document.getElementById('np-capacity-unit').value;
    const capacity        = capacityValue ? `${capacityValue} ${capacityUnit}` : '';
    const location         = document.getElementById('np-location').value.trim();
    const tech            = document.getElementById('np-tech').value.trim();
    const desc            = document.getElementById('np-desc').value.trim();
    const objectives      = document.getElementById('np-objectives')?.value.trim() || null;
    const justification   = document.getElementById('np-justification')?.value.trim() || null;
    const benefits        = document.getElementById('np-benefits')?.value.trim() || null;
    const templateVersionId = document.getElementById('np-template')?.value || null;

    if (!name) { errEl.textContent = 'Project name is required.'; errEl.classList.remove('hidden'); return; }
    if (isNaN(capexAmount) || capexAmount < 0) {
      errEl.textContent = 'Valid CAPEX is required.'; errEl.classList.remove('hidden'); return;
    }
    if (capexCurrency === 'NGN' && (capexUsdEquiv === '' || isNaN(parseFloat(capexUsdEquiv)) || parseFloat(capexUsdEquiv) < 0)) {
      errEl.textContent = 'A USD equivalent is required when CAPEX is quoted in NGN.';
      errEl.classList.remove('hidden'); return;
    }

    const submitBtn = form.querySelector('button[type=submit]');
    submitBtn.disabled = true;
    try {
      await api.post('/api/projects', {
        name,
        capex_amount: capexAmount,
        capex_currency: capexCurrency,
        capex_usd_equivalent: capexCurrency === 'NGN' ? parseFloat(capexUsdEquiv) : undefined,
        capacity: capacity || null,
        location: location || null,
        description: desc || null, technology: tech || null,
        objectives, justification, benefits,
        template_version_id: templateVersionId ? parseInt(templateVersionId, 10) : null,
      });
      closeModal();
      await refresh();
    } catch (err) {
      errEl.textContent = err.message || 'Failed to create project.';
      errEl.classList.remove('hidden');
    } finally {
      submitBtn.disabled = false;
    }
  });
}
