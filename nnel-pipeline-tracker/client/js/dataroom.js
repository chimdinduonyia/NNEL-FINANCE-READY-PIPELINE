/* dataroom.js — Virtual Data Room page for observers/lenders */
'use strict';

document.addEventListener('DOMContentLoaded', async () => {
  const user = await api.getMe();
  if (!user) return;

  api.initSidebar(user);

  const params    = new URLSearchParams(window.location.search);
  const projectId = params.get('id');
  if (!projectId) { window.location.href = '/'; return; }

  let data;
  try {
    data = await api.get(`/api/projects/${projectId}/dataroom`);
  } catch (err) {
    document.getElementById('vdr-content').innerHTML =
      `<div class="error-msg">Could not open data room: ${api.fmt.escape(err.message)}</div>`;
    return;
  }

  document.title = `${data.project.name.toUpperCase()} | Data Room | NNEL`;

  // Show project header
  document.getElementById('vdr-project-name').textContent = data.project.name.toUpperCase();
  document.getElementById('vdr-meta').innerHTML = [
    `<span class="vdr-meta-item">Stage <strong>${data.project.current_stage}</strong>: ${api.fmt.escape(data.project.stage_name)}</span>`,
    `<span class="vdr-meta-item">CAPEX <strong>${api.fmt.currency(data.project.capex_usd)}</strong></span>`,
    data.project.technology ? `<span class="vdr-meta-item">Technology <strong>${api.fmt.escape(data.project.technology)}</strong></span>` : '',
  ].join('<span style="color:rgba(255,255,255,0.3);">·</span>');
  document.getElementById('vdr-header').style.display = 'block';

  // Access expiry banner
  renderExpiryBanner(data.access_expires_at);

  // Content
  renderContent(data);
});

// ---------------------------------------------------------------------------
function renderExpiryBanner(expiresAt) {
  const el = document.getElementById('expiry-banner');
  if (!expiresAt) { el.classList.add('hidden'); return; }

  const expiry     = new Date(expiresAt);
  const now        = new Date();
  const daysLeft   = Math.ceil((expiry - now) / 86400000);
  const isExpired  = daysLeft <= 0;
  const isWarning  = !isExpired && daysLeft <= 7;

  const cls  = isExpired ? 'expired' : (isWarning ? 'warn' : 'safe');
  const icon = isExpired ? api.icons.lock : (isWarning ? api.icons.warning : api.icons.unlock);
  const msg  = isExpired
    ? `Your data room access expired on ${api.fmt.date(expiresAt)}.`
    : `Your data room access expires on ${api.fmt.date(expiresAt)} (${daysLeft} day${daysLeft !== 1 ? 's' : ''} remaining).`;

  el.className = `expiry-banner ${cls}`;
  el.innerHTML = `<div class="container">${icon}${msg}</div>`;
  el.classList.remove('hidden');
}

// ---------------------------------------------------------------------------
function renderContent(data) {
  const el = document.getElementById('vdr-content');

  // Index approved documents by folder code
  const docsByFolder = {};
  data.documents.forEach(d => {
    if (!docsByFolder[d.folder_code]) docsByFolder[d.folder_code] = [];
    docsByFolder[d.folder_code].push(d);
  });

  // Use ALL VDR folders from the template (including empty ones)
  const folders = (data.vdr_folders ?? []);

  if (folders.length === 0 && data.documents.length === 0) {
    el.innerHTML = `
      <div class="confidential-notice" style="margin-bottom:20px;">${confidentialText()}</div>
      <div class="empty">No data room documents are available yet.</div>`;
    return;
  }

  const foldersHtml = folders.map(f => {
    const folderDocs = docsByFolder[f.folder_code] ?? [];
    const docsHtml   = folderDocs.length
      ? folderDocs.map(renderDocRow).join('')
      : `<div class="vdr-folder-empty">No approved documents in this folder yet.</div>`;

    return `<div class="folder-section">
      <div class="folder-title">
        <span class="folder-code-chip">${f.folder_code}</span>
        ${api.fmt.escape(f.name)}
        <span class="vdr-folder-count">${folderDocs.length}</span>
      </div>
      <div class="card" style="overflow:hidden;">${docsHtml}</div>
    </div>`;
  }).join('');

  el.innerHTML = `
    <div class="confidential-notice" style="margin-bottom:24px;">${confidentialText()}</div>
    <div class="flex items-center justify-between" style="margin-bottom:20px;">
      <h2 style="font-size:18px;font-weight:700;">Virtual Data Room</h2>
      <span class="text-sm text-muted">${data.document_count} approved document${data.document_count !== 1 ? 's' : ''} across ${folders.length} folders</span>
    </div>
    ${foldersHtml}`;
}

function renderDocRow(d) {
  const stageLabel = d.stage_number != null ? `Stage ${d.stage_number}` : '';
  const fileCell   = d.file_ref
    ? `<a href="${api.fmt.escape(d.file_ref)}" target="_blank" rel="noopener" class="vdr-file-link" style="display:inline-flex;align-items:center;gap:6px;">
         ${api.icons.paperclip}${api.fmt.escape(d.file_ref)}
       </a>`
    : `<span class="text-muted text-sm">No file reference</span>`;

  return `<div class="doc-row">
    <div>
      <div class="doc-title">${api.fmt.escape(d.title)}</div>
      <div class="doc-subtitle">
        ${stageLabel ? `<span>${stageLabel}</span>` : ''}
        ${d.uploaded_by ? `<span>${api.fmt.escape(d.uploaded_by)}</span>` : ''}
        <span>${api.fmt.date(d.updated_at || d.uploaded_at)}</span>
      </div>
    </div>
    <span class="badge badge-green">Approved</span>
    ${fileCell}
  </div>`;
}

function confidentialText() {
  return `<strong>Confidential:</strong> This data room contains commercially sensitive information provided solely
    for due diligence purposes. Only documents that have been formally approved through the gate review
    process are visible here. Recipient obligations under any NDA in place continue to apply.`;
}
