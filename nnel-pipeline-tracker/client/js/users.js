/* users.js - User Management page (admin only) */
'use strict';

let currentUser  = null;
let allUsers     = [];
let showDeleted  = false; // deleted (deactivated) accounts are hidden by default

document.addEventListener('DOMContentLoaded', async () => {
  currentUser = await api.getMe();
  if (!currentUser) return;

  // Non-admins have no business here
  if (currentUser.system_role !== 'admin') {
    window.location.href = '/';
    return;
  }

  api.initSidebar(currentUser);

  // Password show/hide - delegate from document so it works inside modals
  document.addEventListener('click', e => {
    const toggle = e.target.closest('.pw-toggle');
    if (!toggle) return;
    const input = document.getElementById(toggle.dataset.target);
    if (!input) return;
    const show = input.type === 'password';
    input.type         = show ? 'text' : 'password';
    toggle.textContent = show ? 'Hide' : 'Show';
  });

  document.getElementById('show-deleted-toggle').addEventListener('change', (e) => {
    showDeleted = e.target.checked;
    renderTable();
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
  const card  = document.getElementById('users-card');
  const users = showDeleted ? allUsers : allUsers.filter(u => u.is_active);

  if (allUsers.length === 0) {
    card.innerHTML = '<div class="card-body"><div class="empty">No users yet.</div></div>';
    return;
  }
  if (users.length === 0) {
    card.innerHTML = '<div class="card-body"><div class="empty">No active users. Check "Show deleted users" above to see deleted accounts.</div></div>';
    return;
  }

  const rows = users.map(u => {
    const roleBadge = u.system_role === 'admin'
      ? '<span class="badge badge-green">Admin</span>'
      : u.system_role === 'project_manager'
        ? '<span class="badge badge-blue">Project Manager</span>'
        : '<span class="badge badge-gray">User</span>';
    const statusBadge = !u.is_active
      ? '<span class="badge badge-red">Deleted</span>'
      : u.is_pending
        ? '<span class="badge badge-amber">Pending Invite</span>'
        : '<span class="badge badge-green">Active</span>';
    const isSelf      = u.id === currentUser.id;

    const statusBtn = isSelf ? '' : (u.is_active
      ? `<button class="btn btn-ghost btn-sm" data-action="delete" data-id="${u.id}" data-name="${api.fmt.escape(u.full_name)}" style="color:var(--red-700);">Delete</button>`
      : `<button class="btn btn-primary btn-sm" data-action="activate" data-id="${u.id}" data-name="${api.fmt.escape(u.full_name)}">Activate</button>`);

    const resendBtn = (u.is_pending && u.is_active)
      ? `<button class="btn btn-ghost btn-sm" data-action="resend-invite" data-id="${u.id}" data-name="${api.fmt.escape(u.full_name)}">Resend Invite</button>`
      : '';

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
          ${resendBtn}
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
      confirmActivate(uid, name);
      break;
    case 'delete':
      showDeleteUserModal(uid, name);
      break;
    case 'resend-invite':
      resendInvite(uid, name, btn);
      break;
  }
}

// ---------------------------------------------------------------------------
// Resend a pending invite (regenerates the token, invalidating the old link)
// ---------------------------------------------------------------------------
async function resendInvite(userId, name, btn) {
  btn.disabled = true;
  btn.textContent = 'Sending…';
  try {
    await api.post(`/api/users/${userId}/resend-invite`, {});
    btn.textContent = 'Sent!';
    setTimeout(() => { btn.textContent = 'Resend Invite'; btn.disabled = false; }, 2000);
  } catch (err) {
    alert('Could not resend invite: ' + err.message);
    btn.textContent = 'Resend Invite';
    btn.disabled = false;
  }
}

// ---------------------------------------------------------------------------
// Reactivating a deleted (deactivated) account - low stakes, fully
// reversible either way, so a plain confirm is enough here.
// ---------------------------------------------------------------------------
async function confirmActivate(userId, name) {
  if (!confirm(`Activate account for ${name}?`)) return;
  try {
    await api.patch(`/api/users/${userId}/status`, { is_active: true });
    await loadUsers();
  } catch (err) {
    alert('Error: ' + err.message);
  }
}

// ---------------------------------------------------------------------------
// Delete user - same ceremony as deleting a project: explain what actually
// happens, require typing DELETE to confirm. Under the hood this is the
// same is_active=0 the Activate button reverses - accounts are never hard-
// deleted, so audit_log, project_members, and every historical record that
// references this user id stays intact and an admin can always undo it.
// The server independently blocks deleting your own account (defence in
// depth - this button is already hidden for isSelf, but the check lives
// server-side regardless).
// ---------------------------------------------------------------------------
function showDeleteUserModal(userId, name) {
  document.getElementById('delete-user-modal')?.remove();

  const modal = document.createElement('div');
  modal.id = 'delete-user-modal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:200;display:flex;align-items:center;justify-content:center;padding:24px;';
  modal.innerHTML = `
    <div class="card" style="width:100%;max-width:440px;overflow:hidden;">
      <div class="card-header" style="border-left:4px solid var(--red-700);">
        <h3 style="color:var(--red-700);">Delete User</h3>
        <button class="btn btn-ghost btn-sm" id="dum-close">✕</button>
      </div>
      <div class="card-body" style="display:flex;flex-direction:column;gap:16px;">
        <p style="font-size:14px;">You are about to delete <strong>${api.fmt.escape(name)}</strong>'s account.
          They will no longer be able to sign in. The account and its full history
          (audit log entries, project memberships, gate decisions, documents) are
          preserved and can be restored at any time by activating it again.</p>
        <p class="text-sm text-muted">Type <strong>DELETE</strong> below to confirm:</p>
        <input type="text" id="dum-confirm" placeholder="Type DELETE here" autocomplete="off"
          style="border:2px solid var(--border);border-radius:var(--radius-control);padding:9px 12px;font-size:14px;width:100%;">
        <div id="dum-error" class="error-msg hidden"></div>
        <div class="flex gap-8" style="justify-content:flex-end;">
          <button class="btn btn-ghost" id="dum-cancel">Cancel</button>
          <button class="btn btn-danger" id="dum-delete" disabled>Delete User</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(modal);

  const confirmInput = modal.querySelector('#dum-confirm');
  const deleteBtn     = modal.querySelector('#dum-delete');
  const errEl         = modal.querySelector('#dum-error');
  const close         = () => modal.remove();

  modal.querySelector('#dum-close').addEventListener('click', close);
  modal.querySelector('#dum-cancel').addEventListener('click', close);
  // Deliberately no click-outside-closes-modal - see setupUserModal for why.

  confirmInput.addEventListener('input', () => {
    deleteBtn.disabled = confirmInput.value !== 'DELETE';
  });

  deleteBtn.addEventListener('click', async () => {
    if (confirmInput.value !== 'DELETE') return;
    errEl.classList.add('hidden');
    deleteBtn.disabled = true;
    try {
      await api.patch(`/api/users/${userId}/status`, { is_active: false });
      close();
      await loadUsers();
    } catch (err) {
      errEl.textContent = err.message;
      errEl.classList.remove('hidden');
      deleteBtn.disabled = false;
    }
  });
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
  // Deliberately no click-outside-closes-modal: dragging to select text and
  // releasing past the modal's edge used to register as "clicked outside"
  // and silently discard the form.

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

  // Password field is not shown when editing - use Reset Password for that
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
  // Deliberately no click-outside-closes-modal: dragging to select text and
  // releasing past the modal's edge used to register as "clicked outside"
  // and silently discard the form.

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
