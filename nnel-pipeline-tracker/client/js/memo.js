/* memo.js — Internal Memo Export page */
'use strict';

const STAGE_NAMES = [
  'Opportunity Screening', 'Preliminary Assessment', 'Full Feasibility',
  'Financial Close / FID', 'First Disbursement', 'COD / Commissioning',
];
const ROLE_LABELS = {
  project_lead:  'Project Lead',
  contributor:   'Contributor',
  gate_approver: 'Gate Approver',
  reviewer:      'Reviewer',
  observer:      'Observer',
};

document.addEventListener('DOMContentLoaded', async () => {
  const params    = new URLSearchParams(window.location.search);
  const projectId = params.get('id');
  if (!projectId) { showStatus('No project ID specified.'); return; }

  const me = await api.getMe();
  if (!me) return; // api.js redirects to login on 401

  let data;
  try {
    data = await api.get(`/api/projects/${projectId}/memo`);
  } catch (err) {
    showStatus(`Could not load memo: ${err.message}`);
    return;
  }

  document.title = `${data.project.name} | Internal Memo`;
  document.getElementById('memo-status').style.display = 'none';

  const memoEl = document.getElementById('memo');
  memoEl.innerHTML = buildMemo(data);
  memoEl.style.display = 'block';

  // Pre-fill the editable Subject field with the project name
  const subjectEl = document.getElementById('field-subject');
  if (subjectEl) subjectEl.value = `${data.project.name}: Pipeline Status`;
});

function showStatus(msg) {
  document.getElementById('memo-status').textContent = msg;
}

// ---------------------------------------------------------------------------
function buildMemo(d) {
  const p          = d.project;
  const genDate    = new Date(d.generated_at);
  const genStr     = genDate.toLocaleString('en-GB', {
    day: '2-digit', month: 'long', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
  const overallPct = calcOverallPct(d.stages);

  return `
    ${buildHeader(genStr)}
    ${buildAddressBlock()}

    <!-- 1. Project Overview -->
    <div class="memo-section">
      <h2>1. Project Overview</h2>
      <table class="memo-table">
        <tr><td width="180"><strong>Project Name</strong></td><td>${esc(p.name)}</td></tr>
        <tr><td><strong>Technology Vertical</strong></td><td>${esc(p.technology ?? '-')}</td></tr>
        <tr><td><strong>CAPEX (USD)</strong></td><td>${api.fmt.currency(p.capex_usd)}</td></tr>
        <tr><td><strong>Current Stage</strong></td>
            <td>Stage ${p.current_stage}: ${STAGE_NAMES[p.current_stage] ?? '-'}</td></tr>
        <tr><td><strong>Project Status</strong></td><td>${statusBadge(p.status)}</td></tr>
        <tr><td><strong>Overall Checklist</strong></td><td>
          <span class="pct-bar"><span class="pct-fill" style="width:${overallPct}%;"></span></span>
          ${overallPct}% complete across active stages
        </td></tr>
        ${p.description    ? `<tr><td><strong>Description</strong></td><td>${esc(p.description)}</td></tr>` : ''}
        ${p.objectives    ? `<tr><td><strong>Objectives</strong></td><td style="white-space:pre-wrap;">${esc(p.objectives)}</td></tr>` : ''}
        ${p.justification ? `<tr><td><strong>Justification</strong></td><td style="white-space:pre-wrap;">${esc(p.justification)}</td></tr>` : ''}
        ${p.benefits      ? `<tr><td><strong>Expected Benefits</strong></td><td style="white-space:pre-wrap;">${esc(p.benefits)}</td></tr>` : ''}
      </table>
    </div>

    <!-- 2. Pipeline Status -->
    <div class="memo-section">
      <h2>2. Pipeline Status</h2>
      <table class="memo-table">
        <thead><tr>
          <th>Stage</th><th>Name</th><th>Status</th><th>Checklist Progress</th>
        </tr></thead>
        <tbody>
          ${d.stages.map(s => `<tr>
            <td>Stage ${s.stage_number}</td>
            <td>${esc(s.stage_name)}</td>
            <td>${statusBadge(s.status)}</td>
            <td>${s.checklist_total > 0
              ? `<span class="pct-bar"><span class="pct-fill" style="width:${s.checklist_pct}%;"></span></span>
                 ${s.checklist_done}/${s.checklist_total}`
              : '-'}</td>
          </tr>
          ${s.submission_summary ? `<tr>
            <td colspan="4" style="padding:4px 10px 10px;font-size:12px;color:#555;font-style:italic;border-bottom:1px solid #eee;">
              <strong>Stage gate summary:</strong> ${esc(s.submission_summary)}
            </td>
          </tr>` : ''}`).join('')}
        </tbody>
      </table>
    </div>

    <!-- 3. Gate Decision History -->
    <div class="memo-section">
      <h2>3. Gate Decision History</h2>
      ${d.decisions.length === 0
        ? '<p style="color:#aaa;font-size:13px;">No gate decisions recorded yet.</p>'
        : `<table class="memo-table">
            <thead><tr>
              <th>Stage</th><th>Decision</th><th>Authority</th><th>Decided By</th><th>Date</th><th>Rationale</th>
            </tr></thead>
            <tbody>
              ${d.decisions.map(dec => `<tr>
                <td>Stage ${dec.stage_number}${dec.review_round > 1 ? ` <em>(R${dec.review_round})</em>` : ''}</td>
                <td class="decision-${dec.decision}">${dec.decision.replace(/_/g, '-').toUpperCase()}</td>
                <td>${dec.authority.replace(/_/g, '-').toUpperCase()}</td>
                <td>${esc(dec.decided_by_name)}</td>
                <td style="white-space:nowrap;">${api.fmt.date(dec.created_at)}</td>
                <td style="font-size:12px;">${esc(dec.rationale)}</td>
              </tr>`).join('')}
            </tbody>
           </table>`}
    </div>

    <!-- 4. Open Conditions -->
    <div class="memo-section">
      <h2>4. Open Conditions</h2>
      ${d.open_conditions.length === 0
        ? '<p style="color:#aaa;font-size:13px;">No open conditions.</p>'
        : `<table class="memo-table">
            <thead><tr><th>Stage</th><th>Authority</th><th>Condition</th><th>Raised</th></tr></thead>
            <tbody>
              ${d.open_conditions.map(c => `<tr>
                <td>Stage ${c.stage_number}</td>
                <td>${c.authority.replace(/_/g, '-').toUpperCase()}</td>
                <td>${esc(c.description)}</td>
                <td>${api.fmt.date(c.created_at)}</td>
              </tr>`).join('')}
            </tbody>
           </table>`}
    </div>

    <!-- 5. Document Register Summary -->
    <div class="memo-section">
      <h2>5. Document Register Summary</h2>
      ${d.documents.length === 0
        ? '<p style="color:#aaa;font-size:13px;">No documents registered yet.</p>'
        : `<table class="memo-table">
            <thead><tr><th>Folder</th><th>Title</th><th>Stage</th><th>Status</th></tr></thead>
            <tbody>
              ${d.documents.map(doc => `<tr>
                <td style="white-space:nowrap;">${doc.folder_code}: ${esc(doc.folder_name)}</td>
                <td>${esc(doc.title)}</td>
                <td>${doc.stage_number != null ? `Stage ${doc.stage_number}` : '-'}</td>
                <td style="text-transform:capitalize;">${esc(doc.status)}</td>
              </tr>`).join('')}
            </tbody>
           </table>`}
    </div>

    <!-- 6. Team -->
    <div class="memo-section">
      <h2>6. Team</h2>
      <table class="memo-table">
        <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Detail</th></tr></thead>
        <tbody>
          ${d.members.map(m => {
            let detail = '';
            if (m.role === 'contributor'   && m.workstream)         detail = m.workstream;
            if (m.role === 'gate_approver' && m.approver_authority) detail = m.approver_authority.replace(/_/g, '-').toUpperCase();
            return `<tr>
              <td><strong>${esc(m.full_name)}</strong></td>
              <td style="font-size:12px;">${esc(m.email)}</td>
              <td>${ROLE_LABELS[m.role] ?? m.role}</td>
              <td style="font-size:12px;">${esc(detail)}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>

    <!-- 7. Next Steps — EDITABLE -->
    <div class="memo-section">
      <h2>7. Next Steps</h2>
      <textarea class="memo-textarea" id="field-next-steps" rows="6"
        placeholder="Enter the agreed next steps, responsibilities, and target dates…"></textarea>
    </div>

    <!-- 8. Additional Notes — EDITABLE -->
    <div class="memo-section">
      <h2>8. Additional Notes</h2>
      <textarea class="memo-textarea" id="field-notes" rows="4"
        placeholder="Any additional context, risks, or observations (optional)…"></textarea>
    </div>

    ${buildFooter(genStr)}`;
}

// ---------------------------------------------------------------------------
function buildHeader(genStr) {
  return `<div class="memo-header">
    <div class="memo-logo">
      <img src="/img/nnel-logo-light.png" alt="NNEL" onerror="this.style.display='none'">
    </div>
    <div class="memo-title-block">
      <div class="memo-title">Internal Memo</div>
      <div class="memo-date-line">${genStr}</div>
      <div class="memo-ref-line">NNEL-CAM-FRP-001 v1.0</div>
    </div>
  </div>`;
}

// ---------------------------------------------------------------------------
// Address block: To / From / Subject are editable; Date is auto-populated.
// Subject is pre-filled with the project name after DOM load (see init above).
// ---------------------------------------------------------------------------
function buildAddressBlock() {
  return `<div class="memo-address">
    <table class="memo-address-table">
      <tr>
        <td class="addr-label">To</td>
        <td><input type="text" class="memo-input" id="field-to"
            placeholder="Recipient name / role…" autocomplete="off"></td>
      </tr>
      <tr>
        <td class="addr-label">From</td>
        <td><input type="text" class="memo-input" id="field-from"
            value="NNEL Clean Asset Management" autocomplete="off"></td>
      </tr>
      <tr>
        <td class="addr-label">Subject</td>
        <td><input type="text" class="memo-input" id="field-subject"
            autocomplete="off"></td>
      </tr>
    </table>
    <div class="addr-confidential">Confidential | Internal Use Only</div>
  </div>`;
}

// ---------------------------------------------------------------------------
function buildFooter(genStr) {
  return `<div class="memo-footer">
    <span class="confidential">CONFIDENTIAL | NNEL Internal Use Only</span>
    <span>Generated by NNEL Pipeline Tracker &nbsp;|&nbsp; ${genStr} &nbsp;|&nbsp; NNEL-CAM-FRP-001 v1.0</span>
  </div>`;
}

// ---------------------------------------------------------------------------
function calcOverallPct(stages) {
  const active = stages.filter(s => s.status !== 'not_started');
  const total  = active.reduce((s, r) => s + Number(r.checklist_total), 0);
  const done   = active.reduce((s, r) => s + Number(r.checklist_done),  0);
  return total > 0 ? Math.round((done / total) * 100) : 0;
}

function statusBadge(status) {
  return `<span class="status status-${status}">${(status ?? '').replace(/_/g, ' ')}</span>`;
}

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
