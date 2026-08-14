/* users.js — User Management page (admin only) */
'use strict';

let currentUser = null;
let allUsers    = [];

document.addEventListener('DOMContentLoaded', async () => {
  currentUser = await api.getMe();
  if (!currentUser) return;

  // Non-admins have no business here
  if (currentUser.system_role !== 'admin') {
    window.location.href = '/';
    return;
  }

  api.initSidebar(currentUser);

  // Password show/hide — delegate from document so it works inside modals
  document.addEventListener('click', e => {
    const toggle = e.target.closest('.pw-toggle');
    if (!toggle) return;
    const input = document.getElementById(toggle.dataset.target);
    if (!input) return;
    const show = input.type === 'password';
    input.type         = show ? 'text' : 'password';
    toggle.textContent = show ? 'Hide' : 'Show';
  });

  setupUserModal();
  setupPasswordModal();
  await loadUsers();
});

// ---------------------------------------------------------------------------
// Load and render
// ---------------------------------------------------------------------------
async function loadUsers() {
  try {
    allUsers = await api.get('/api/users');
  } catch (err) {
    document.getElementById('users-card').innerHTML =
      `<div class="card-body"><div class="error-msg">${api.fmt.escape(err.message)}</div></div>`;
    return;
  }
  renderTable();
}

function renderTable() {
  const card = document.getElementById('users-card');

  if (allUsers.length === 0) {
    card.innerHTML = '<div class="card-body"><div class="empty">No users yet.</div></div>';
    return;
  }

  const rows = allUsers.map(u => {
    const roleBadge = u.system_role === 'admin'
      ? '<span class="badge badge-green">Admin</span>'
      : u.system_role === 'project_manager'
        ? '<span class="badge badge-blue">Project Manager</span>'
        : '<span class="badge badge-gray">User</span>';
    const statusBadge = u.is_active
      ? '<span class="badge badge-green">Active</span>'
      : '<span class="badge badge-red">Inactive</span>';
    const isSelf      = u.id === currentUser.id;

    const statusBtn = isSelf ? '' : (u.is_active
      ? `<button class="btn btn-ghost btn-sm" data-action="deactivate" data-id="${u.id}" data-name="${api.fmt.escape(u.full_name)}">Deactivate</button>`
      : `<button class="btn btn-primary btn-sm" data-action="activate" data-id="${u.id}" data-name="${api.fmt.escape(u.full_name)}">Activate</button>`);

    const wsBadge   = u.workstream ? `<span class="badge badge-outline" style="text-transform:capitalize;font-size:10px;">${u.workstream}</span>` : '';
    const authLabel = u.authority  ? (u.authority.replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase())) : 'SS';

    return `<tr>
      <td><strong>${api.fmt.escape(u.full_name)}</strong> ${isSelf ? '<span class="text-muted text-sm">(you)</span>' : ''}</td>
      <td class="text-sm">${api.fmt.escape(u.email)}</td>
      <td>${roleBadge}</td>
      <td class="text-sm">${wsBadge} <span class="badge badge-blue" style="font-size:10px;">${authLabel}</span></td>
      <td>${statusBadge}</td>
      <td class="text-sm text-muted">${api.fmt.date(u.created_at)}</td>
      <td>
        <div class="flex gap-8">
          <button class="btn btn-ghost btn-sm" data-action="edit"
            data-id="${u.id}" data-name="${api.fmt.escape(u.full_name)}"
            data-email="${api.fmt.escape(u.email)}" data-role="${u.system_role}"
            data-workstream="${u.workstream||''}" data-authority="${u.authority||'ss'}">Edit</button>
          <button class="btn btn-ghost btn-sm" data-action="reset-pw"
            data-id="${u.id}" data-name="${api.fmt.escape(u.full_name)}">Reset password</button>
          ${statusBtn}
        </div>
      </td>
    </tr>`;
  }).join('');

  card.innerHTML = `<table class="doc-table" style="width:100%;">
    <thead>
      <tr>
        <th>Name</th><th>Email</th><th>System Role</th>
        <th>Workstream / Authority</th><th>Status</th><th>Created</th><th>Actions</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>`;

  // Wire up action buttons
  card.querySelectorAll('button[data-action]').forEach(btn => {
    btn.addEventListener('click', () => handleAction(btn));
  });
}

function handleAction(btn) {
  const { action, id, name, email, role } = btn.dataset;
  const uid = parseInt(id, 10);

  switch (action) {
    case 'edit':
      openEditModal(uid, name, email, role, btn.dataset.workstream, btn.dataset.authority);
      break;
    case 'reset-pw':
      openPasswordModal(uid, name);
      break;
    case 'activate':
      confirmStatusChange(uid, name, true);
      break;
    case 'deactivate':
      confirmStatusChange(uid, name, false);
      break;
  }
}

// ---------------------------------------------------------------------------
// Status toggle (activate / deactivate)
// ---------------------------------------------------------------------------
async function confirmStatusChange(userId, name, activate) {
  const verb = activate ? 'activate' : 'deactivate';
  if (!confirm(`${verb.charAt(0).toUpperCase() + verb.slice(1)} account for ${name}?`)) return;

  try {
    await api.patch(`/api/users/${userId}/status`, { is_active: activate });
    await loadUsers();
  } catch (err) {
    alert('Error: ' + err.message);
  }
}

// ---------------------------------------------------------------------------
// New / Edit user modal
// ---------------------------------------------------------------------------
function setupUserModal() {
  const modal     = document.getElementById('user-modal');
  const form      = document.getElementById('user-form');
  const errEl     = document.getElementById('modal-error');
  const pwGroup   = document.getElementById('password-group');
  const submitBtn = document.getElementById('modal-submit-btn');

  const openModal  = () => modal.classList.remove('hidden');
  const closeModal = () => {
    modal.classList.add('hidden');
    form.reset();
    document.getElementById('edit-user-id').value = '';
    errEl.classList.add('hidden');
  };

  document.getElementById('new-user-btn').addEventListener('click', () => {
    document.getElementById('modal-title').textContent = 'New User';
    submitBtn.textContent = 'Create User';
    pwGroup.classList.remove('hidden');
    document.getElementById('u-password').required = true;
    openModal();
  });

  document.getElementById('modal-close-btn').addEventListener('click', closeModal);
  document.getElementById('modal-cancel-btn').addEventListener('click', closeModal);
  modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errEl.classList.add('hidden');

    const editId    = document.getElementById('edit-user-id').value;
    const fullName  = document.getElementById('u-name').value.trim();
    const email     = document.getElementById('u-email').value.trim();
    const password  = document.getElementById('u-password').value;
    const role      = document.getElementById('u-role').value;
    const workstream= document.getElementById('u-workstream')?.value || null;
    const authority = document.getElementById('u-authority')?.value  || 'ss';

    submitBtn.disabled = true;
    try {
      if (editId) {
        const body = { full_name: fullName, email, system_role: role, workstream, authority };
        await api.patch(`/api/users/${editId}`, body);
      } else {
        await api.post('/api/users', { full_name: fullName, email, password, system_role: role, workstream, authority });
      }
      closeModal();
      await loadUsers();
    } catch (err) {
      errEl.textContent = err.message;
      errEl.classList.remove('hidden');
    } finally {
      submitBtn.disabled = false;
    }
  });
}

function openEditModal(userId, name, email, role, workstream, authority) {
  document.getElementById('modal-title').textContent      = 'Edit User';
  document.getElementById('modal-submit-btn').textContent = 'Save Changes';
  document.getElementById('edit-user-id').value = userId;
  document.getElementById('u-name').value  = name;
  document.getElementById('u-email').value = email;
  document.getElementById('u-role').value  = role;
  const wsEl = document.getElementById('u-workstream');
  if (wsEl) wsEl.value = workstream || '';
  const authEl = document.getElementById('u-authority');
  if (authEl) authEl.value = authority || 'ss';

  // Password field is not shown when editing — use Reset Password for that
  const pwGroup = document.getElementById('password-group');
  pwGroup.classList.add('hidden');
  document.getElementById('u-password').required = false;
  document.getElementById('u-password').value = '';

  document.getElementById('user-modal').classList.remove('hidden');
}

// ---------------------------------------------------------------------------
// Reset password modal
// ---------------------------------------------------------------------------
function setupPasswordModal() {
  const modal  = document.getElementById('pw-modal');
  const form   = document.getElementById('pw-form');
  const errEl  = document.getElementById('pw-error');

  const closeModal = () => {
    modal.classList.add('hidden');
    form.reset();
    errEl.classList.add('hidden');
  };

  document.getElementById('pw-modal-close').addEventListener('click', closeModal);
  document.getElementById('pw-cancel-btn').addEventListener('click', closeModal);
  modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errEl.classList.add('hidden');

    const userId      = document.getElementById('pw-user-id').value;
    const newPassword = document.getElementById('pw-new').value;
    const btn         = form.querySelector('button[type=submit]');

    btn.disabled = true;
    try {
      await api.patch(`/api/users/${userId}/password`, { new_password: newPassword });
      closeModal();
      alert('Password updated successfully.');
    } catch (err) {
      errEl.textContent = err.message;
      errEl.classList.remove('hidden');
    } finally {
      btn.disabled = false;
    }
  });
}

function openPasswordModal(userId, name) {
  document.getElementById('pw-user-id').value  = userId;
  document.getElementById('pw-modal-desc').textContent = `Set a new password for ${name}.`;
  document.getElementById('pw-new').value = '';
  document.getElementById('pw-modal').classList.remove('hidden');
}
