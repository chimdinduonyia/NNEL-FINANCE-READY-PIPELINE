/* vdr.js - admin/PM cross-project document register (VDR) */
'use strict';

let projects = [];
const openProjects = new Set(); // project ids currently expanded
const docsCache = {};           // project id -> documents array, fetched lazily
let searchQuery = '';

document.addEventListener('DOMContentLoaded', async () => {
  const user = await api.getMe();
  if (!user) return;
  if (!['admin','project_manager'].includes(user.system_role)) { window.location.href = '/'; return; }

  api.initSidebar(user);
  await loadProjects();

  document.getElementById('vdr-search').addEventListener('input', (e) => {
    searchQuery = e.target.value.trim().toLowerCase();
    render();
  });
});

async function loadProjects() {
  const card = document.getElementById('vdr-card');
  try {
    projects = await api.get('/api/vdr');
  } catch (err) {
    card.innerHTML = `<div class="card-body"><div class="error-msg">${api.fmt.escape(err.message)}</div></div>`;
    return;
  }
  render();
}

function render() {
  const card = document.getElementById('vdr-card');

  if (projects.length === 0) {
    card.innerHTML = `<div class="card-body"><div class="empty">No projects yet.</div></div>`;
    return;
  }

  const visible = searchQuery
    ? projects.filter(p => [p.name, p.technology].some(f => f && f.toLowerCase().includes(searchQuery)))
    : projects;

  if (visible.length === 0) {
    card.innerHTML = `<div class="card-body"><div class="empty">No projects match "${api.fmt.escape(searchQuery)}".</div></div>`;
    return;
  }

  card.innerHTML = visible.map(p => {
    const isOpen = openProjects.has(p.id);
    const docs = docsCache[p.id];
    return `<div class="vdr-project-item" data-pid="${p.id}">
      <div class="vdr-project-row" data-pid="${p.id}">
        <div>
          <div class="vdr-project-name">${api.fmt.escape(p.name)}</div>
          <div class="vdr-project-meta">
            ${p.technology ? api.fmt.escape(p.technology) + ' · ' : ''}Stage ${p.current_stage} · ${api.fmt.statusBadge(p.status)}
          </div>
        </div>
        <div class="flex items-center gap-8">
          <span class="badge badge-outline">${p.document_count} document${p.document_count !== 1 ? 's' : ''}</span>
          <span class="text-muted" style="font-size:11px;">${isOpen ? '▲' : '▼'}</span>
        </div>
      </div>
      ${isOpen ? `<div class="vdr-doc-panel">${renderDocs(docs)}</div>` : ''}
    </div>`;
  }).join('');

  card.querySelectorAll('.vdr-project-row').forEach(row => {
    row.addEventListener('click', () => toggleProject(parseInt(row.dataset.pid, 10)));
  });
}

function renderDocs(docs) {
  if (docs === undefined) return `<div class="loading" style="padding:16px 16px 16px 40px;">Loading documents…</div>`;
  if (docs.length === 0) return `<div style="padding:12px 16px 12px 40px;color:var(--text-muted);font-size:13px;">No documents yet.</div>`;

  const head = `<div class="vdr-doc-head"><div>Folder</div><div>Title</div><div>Stage</div><div>Uploaded by</div><div>Date</div></div>`;
  const rows = docs.map(d => `<div class="vdr-doc-row">
    <div class="text-sm text-muted">${d.folder_code ? api.fmt.escape(d.folder_code) + ': ' + api.fmt.escape(d.folder_name) : '-'}</div>
    <div>${api.fmt.escape(d.title)} ${api.fmt.statusBadge(d.status)}</div>
    <div class="text-sm text-muted">${d.stage_number != null ? 'Stage ' + d.stage_number : '-'}</div>
    <div class="text-sm text-muted">${api.fmt.escape(d.uploaded_by_name)}</div>
    <div class="text-sm text-muted">${api.fmt.date(d.updated_at || d.uploaded_at)}</div>
  </div>`).join('');
  return head + rows;
}

async function toggleProject(projectId) {
  if (openProjects.has(projectId)) {
    openProjects.delete(projectId);
    render();
    return;
  }
  openProjects.add(projectId);
  render(); // show the "Loading documents…" state immediately

  if (!docsCache[projectId]) {
    try {
      const result = await api.get(`/api/vdr/${projectId}`);
      docsCache[projectId] = result.documents;
    } catch (err) {
      docsCache[projectId] = [];
    }
    render();
  }
}
