/* approvals.js — dedicated Approval Requests page for gate approvers
 * Reuses GET /api/decisions/pending -- the same endpoint that already
 * powers the "Decisions awaiting you" banner on the dashboard. That
 * endpoint is already scoped server-side to stages where the calling
 * user is next in the approval chain, so no new backend logic was needed
 * here -- this page just gives that queue its own full view.
 */
'use strict';

document.addEventListener('DOMContentLoaded', async () => {
  const currentUser = await api.getMe();
  if (!currentUser) return;
  api.initSidebar(currentUser);

  const listEl = document.getElementById('approvals-list');
  let pending;
  try {
    pending = await api.get('/api/decisions/pending');
  } catch (err) {
    listEl.innerHTML = `<div class="error-msg">${api.fmt.escape(err.message || 'Could not load approval requests.')}</div>`;
    return;
  }

  if (!pending.length) {
    listEl.innerHTML = '<div class="empty">No approval requests waiting on you right now.</div>';
    return;
  }

  const rows = pending.map(d => `
    <div class="pending-item">
      <div style="flex:1;min-width:0;">
        <div class="item-project">${api.fmt.escape(d.project_name)}</div>
        <div class="item-stage">Stage ${d.stage_number}: ${api.fmt.escape(d.stage_name)}
          · CAPEX ${api.fmt.currency(d.capex_at_submission ?? d.capex_usd)}
          · Position ${d.chain_position}/${d.total_in_chain} in chain</div>
      </div>
      <div class="item-wait">${d.days_waiting}d waiting</div>
      <a href="/project.html?id=${d.project_id}&tab=gate" class="btn btn-primary btn-sm">Review</a>
    </div>`).join('');

  listEl.innerHTML = `<div class="card" style="overflow:hidden;">${rows}</div>`;
});
