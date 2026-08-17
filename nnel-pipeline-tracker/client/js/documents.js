/* documents.js — "my document upload footprint" page (regular users) */
'use strict';

document.addEventListener('DOMContentLoaded', async () => {
  const user = await api.getMe();
  if (!user) return;

  api.initSidebar(user);

  const card = document.getElementById('documents-card');
  let docs;
  try {
    docs = await api.get('/api/documents/mine');
  } catch (err) {
    card.innerHTML = `<div class="card-body"><div class="error-msg">${api.fmt.escape(err.message)}</div></div>`;
    return;
  }

  if (docs.length === 0) {
    card.innerHTML = `<div class="card-body"><div class="empty">You haven't uploaded any documents yet.</div></div>`;
    return;
  }

  const head = `<div class="doc-list-head"><div>Title</div><div>Project</div><div>Folder</div><div>Status</div><div>Date</div></div>`;
  const rows = docs.map(d => `<div class="doc-list-row">
    <div>
      ${api.fmt.escape(d.title)}
      ${d.stage_number != null ? `<span class="text-sm text-muted"> · Stage ${d.stage_number}</span>` : ''}
    </div>
    <div class="text-sm">
      <a href="/project.html?id=${d.project_id}" style="color:var(--green-700);">${api.fmt.escape(d.project_name)}</a>
    </div>
    <div class="text-sm text-muted">${d.folder_code ? api.fmt.escape(d.folder_code) + ': ' + api.fmt.escape(d.folder_name) : '-'}</div>
    <div>${api.fmt.statusBadge(d.status)}</div>
    <div class="text-sm text-muted">${api.fmt.date(d.updated_at || d.uploaded_at)}</div>
  </div>`).join('');

  card.innerHTML = head + rows;
});
