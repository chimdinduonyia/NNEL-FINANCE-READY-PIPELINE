/* notifications.js — notifications page */
'use strict';

// Kept in sync by eye with server/routes/notifications.js's PROJECT_ACTIONS /
// ACCOUNT_ACTIONS lists — this is just the display label for each.
const ACTION_LABELS = {
  gate_decision_recorded:   'Gate decision recorded',
  stage_submitted:          'Stage submitted for gate review',
  stage_reopened:           'Stage re-opened',
  submission_recalled:      'Submission recalled',
  member_assigned:          'Team member added',
  member_removed:           'Team member removed',
  condition_closed:         'Condition closed',
  gate_conditions_resolved: 'All conditions resolved',
  project_updated:          'Project details updated',
  document_status_updated:  'Document status updated',
  user_updated:             'Your account was updated',
  user_status_changed:      'Your account status changed',
  user_password_reset:      'Your password was reset by an admin',
};

document.addEventListener('DOMContentLoaded', async () => {
  const currentUser = await api.getMe();
  if (!currentUser) return;
  api.initSidebar(currentUser);

  const listEl = document.getElementById('notif-list');
  let data;
  try {
    data = await api.get('/api/notifications');
  } catch (err) {
    listEl.innerHTML = `<div class="error-msg">${api.fmt.escape(err.message || 'Could not load notifications.')}</div>`;
    return;
  }

  const lastSeen = data.last_seen_at ? new Date(data.last_seen_at) : null;

  if (!data.items.length) {
    listEl.innerHTML = '<div class="empty">No notifications yet.</div>';
  } else {
    const rows = data.items.map(n => {
      const label = ACTION_LABELS[n.action] ?? n.action.replace(/_/g, ' ');
      const isNew = !lastSeen || new Date(n.created_at) > lastSeen;
      const context = n.project_id
        ? `<a href="/project.html?id=${n.project_id}">${api.fmt.escape(n.project_name)}</a>${n.stage_number != null ? ` · Stage ${n.stage_number}` : ''}`
        : 'Your account';
      return `<div class="notif-item ${isNew ? 'is-new' : ''}">
        <div class="notif-dot"></div>
        <div class="notif-body">
          <div class="notif-label">${api.fmt.escape(label)}</div>
          <div class="notif-meta">${context} · ${api.fmt.escape(n.actor_name)}</div>
        </div>
        <div class="notif-time">${api.fmt.dateTime(n.created_at)}</div>
      </div>`;
    }).join('');
    listEl.innerHTML = `<div class="card" style="overflow:hidden;">${rows}</div>`;
  }

  // Mark as seen now that the feed has actually been shown. Best-effort --
  // a failure here shouldn't be treated as a page error.
  api.post('/api/notifications/mark-seen', {}).catch(() => {});
});
