/* api.js — lightweight API client shared by all pages */
'use strict';

const TOKEN_KEY = 'nnel_frp_token';

const api = {
  getToken() { return localStorage.getItem(TOKEN_KEY); },
  setToken(t) { localStorage.setItem(TOKEN_KEY, t); },
  clearToken() { localStorage.removeItem(TOKEN_KEY); },

  async _fetch(method, url, body) {
    const headers = { 'Content-Type': 'application/json' };
    const token = this.getToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      cache: 'no-store',
    });

    if (res.status === 401) {
      this.clearToken();
      if (!window.location.pathname.includes('login')) {
        window.location.href = '/login.html';
      }
      return null;
    }

    if (!res.ok) {
      let msg;
      try { msg = (await res.json()).error; } catch { msg = res.statusText; }
      const err = new Error(msg || `HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }

    return res.json();
  },

  get(url)          { return this._fetch('GET',    url); },
  post(url, body)   { return this._fetch('POST',   url, body); },
  patch(url, body)  { return this._fetch('PATCH',  url, body); },
  delete(url)       { return this._fetch('DELETE', url); },

  async getMe() {
    try { return await this._fetch('GET', '/api/auth/me'); }
    catch { return null; }
  },

  async login(email, password) {
    const data = await this._fetch('POST', '/api/auth/login', { email, password });
    if (data?.token) this.setToken(data.token);
    return data;
  },

  async signup(full_name, email, password, workstream) {
    const data = await this._fetch('POST', '/api/auth/signup', { full_name, email, password, workstream });
    if (data?.token) this.setToken(data.token);
    return data;
  },

  logout() {
    this.clearToken();
    window.location.href = '/login.html';
  },

  /**
   * Builds the app-wide collapsible left sidebar (nav + account snippet).
   * Call once after getMe() resolves. Expects the page to have a single
   * empty element: <aside class="sidebar" id="sidebar"></aside> — this
   * function owns everything inside it.
   *
   * Collapse behaviour: the user's expand/collapse preference is
   * remembered (localStorage) and reused on every page EXCEPT the project
   * view, which always starts collapsed — checklists and tabs need the
   * width. Manually toggling on the project page still updates the shared
   * preference for other pages.
   */
  initSidebar(user) {
    const sidebar = document.getElementById('sidebar');
    if (!user || !sidebar) return;

    const ROLE_LABELS = { admin: 'Administrator', project_manager: 'Project Manager', user: 'User' };
    const roleLabel = ROLE_LABELS[user.system_role] || 'User';

    const iconDashboard = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="1.5" y="1.5" width="5.5" height="5.5" stroke="currentColor" stroke-width="1.4"/><rect x="9" y="1.5" width="5.5" height="5.5" stroke="currentColor" stroke-width="1.4"/><rect x="1.5" y="9" width="5.5" height="5.5" stroke="currentColor" stroke-width="1.4"/><rect x="9" y="9" width="5.5" height="5.5" stroke="currentColor" stroke-width="1.4"/></svg>`;
    const iconBell      = `<svg width="16" height="16" viewBox="0 0 14 14" fill="none"><path d="M7 1.5C5 1.5 4 3 4 5v2L2.5 9.5h9L10 7V5c0-2-1-3.5-3-3.5Z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M5.5 11.3a1.5 1.5 0 0 0 3 0" stroke="currentColor" stroke-width="1.4"/></svg>`;
    const iconApproval  = `<svg width="16" height="16" viewBox="0 0 14 14" fill="none"><rect x="2" y="1" width="10" height="12" rx="1" stroke="currentColor" stroke-width="1.4"/><polyline points="4.5,7 6,8.5 9.5,4.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="square" stroke-linejoin="miter"/></svg>`;
    const iconTemplates = `<svg width="16" height="16" viewBox="0 0 14 14" fill="none"><rect x="2" y="1" width="10" height="12" rx="1" stroke="currentColor" stroke-width="1.4"/><line x1="4.5" y1="5" x2="9.5" y2="5" stroke="currentColor" stroke-width="1.4" stroke-linecap="square"/><line x1="4.5" y1="8" x2="9.5" y2="8" stroke="currentColor" stroke-width="1.4" stroke-linecap="square"/><line x1="4.5" y1="11" x2="7.5" y2="11" stroke="currentColor" stroke-width="1.4" stroke-linecap="square"/></svg>`;
    const iconUsers     = `<svg width="16" height="16" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="4.5" r="2.5" stroke="currentColor" stroke-width="1.4"/><path d="M1.5 13C1.5 10 4 8 7 8s5.5 2 5.5 5" stroke="currentColor" stroke-width="1.4" stroke-linecap="square"/></svg>`;
    const iconSignOut   = `<svg width="15" height="15" viewBox="0 0 14 14" fill="none"><polyline points="9.5,4.5 12.5,7 9.5,9.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="square" stroke-linejoin="miter"/><line x1="12.5" y1="7" x2="5" y2="7" stroke="currentColor" stroke-width="1.5" stroke-linecap="square"/><polyline points="5,2 2,2 2,12 5,12" stroke="currentColor" stroke-width="1.5" stroke-linecap="square" stroke-linejoin="miter"/></svg>`;
    const iconCollapse  = `<svg width="15" height="15" viewBox="0 0 14 14" fill="none"><rect x="1.5" y="1.5" width="11" height="11" rx="1.5" stroke="currentColor" stroke-width="1.4"/><line x1="5.5" y1="1.5" x2="5.5" y2="12.5" stroke="currentColor" stroke-width="1.4"/></svg>`;

    const path = window.location.pathname;
    const navItems = [
      { href: '/', label: 'Dashboard', icon: iconDashboard,
        match: p => p === '/' || p === '/index.html', visible: true },
      { href: '/notifications.html', label: 'Notifications', icon: iconBell,
        match: p => p === '/notifications.html', visible: true, badgeId: 'sidebar-notif-badge' },
      { href: '/approvals.html', label: 'Approval Requests', icon: iconApproval,
        match: p => p === '/approvals.html', visible: user.is_gate_approver === true },
      { href: '/templates.html', label: 'Templates', icon: iconTemplates,
        match: p => p === '/templates.html', visible: ['admin','project_manager'].includes(user.system_role) },
      { href: '/users.html', label: 'Users', icon: iconUsers,
        match: p => p === '/users.html', visible: user.system_role === 'admin' },
    ].filter(i => i.visible);

    const navHtml = navItems.map(i => `
      <a href="${i.href}" class="sidebar-link ${i.match(path) ? 'active' : ''}" title="${i.label}">
        ${i.icon}<span class="sidebar-link-label">${i.label}</span>
        ${i.badgeId ? `<span class="sidebar-link-badge hidden" id="${i.badgeId}"></span>` : ''}
      </a>`).join('');

    const STORAGE_KEY = 'nnel_sidebar_collapsed';
    const isProjectView = path === '/project.html';
    let collapsed = isProjectView ? true : localStorage.getItem(STORAGE_KEY) === '1';

    sidebar.innerHTML = `
      <a href="/" class="sidebar-brand">
        <img src="/img/nnel-logo-light.png" alt="NNEL">
        <span class="sidebar-brand-text">Finance-Ready Pipeline</span>
      </a>
      <nav class="sidebar-nav">${navHtml}</nav>
      <div class="sidebar-toggle-row">
        <button type="button" class="sidebar-toggle" id="sidebar-toggle-btn">
          ${iconCollapse}<span class="sidebar-toggle-label">Collapse</span>
        </button>
      </div>
      <div class="sidebar-account">
        <div class="sidebar-account-row" id="sidebar-account-row">
          <div class="sidebar-account-avatar">${user.full_name.trim().charAt(0).toUpperCase()}</div>
          <div class="sidebar-account-info">
            <div class="sidebar-account-name">${this.fmt.escape(user.full_name)}</div>
            <div class="sidebar-account-role">${roleLabel}</div>
          </div>
        </div>
        <div class="sidebar-account-dropdown" id="sidebar-account-dropdown">
          <div class="avatar-dropdown-inner">
            <div class="avatar-dropdown-header">
              <div class="dd-name">${this.fmt.escape(user.full_name)}</div>
              <div class="dd-role">${roleLabel}</div>
            </div>
            <button class="dd-item dd-danger" id="logout-btn">${iconSignOut}Sign out</button>
          </div>
        </div>
      </div>`;

    const toggleBtn = document.getElementById('sidebar-toggle-btn');
    const applyCollapsed = () => {
      sidebar.classList.toggle('collapsed', collapsed);
      toggleBtn.title = collapsed ? 'Expand sidebar' : 'Collapse sidebar';
    };
    applyCollapsed();

    toggleBtn.addEventListener('click', () => {
      collapsed = !collapsed;
      localStorage.setItem(STORAGE_KEY, collapsed ? '1' : '0');
      applyCollapsed();
    });

    const accountRow = document.getElementById('sidebar-account-row');
    const accountDropdown = document.getElementById('sidebar-account-dropdown');
    accountRow.addEventListener('click', (e) => {
      e.stopPropagation();
      accountDropdown.classList.toggle('open');
    });
    document.addEventListener('click', () => accountDropdown.classList.remove('open'));

    document.getElementById('logout-btn').addEventListener('click', () => this.logout());

    // Unread notifications badge — best-effort, never blocks sidebar rendering
    this.get('/api/notifications/unread-count').then(({ count }) => {
      const badge = document.getElementById('sidebar-notif-badge');
      if (badge && count > 0) {
        badge.textContent = count > 99 ? '99+' : String(count);
        badge.classList.remove('hidden');
      }
    }).catch(() => {});
  },

  // Helpers
  fmt: {
    currency(val, curr = 'USD') {
      const symbol = curr === 'NGN' ? '₦' : '$';
      const n = Number(val);
      if (n >= 1e9) return `${symbol}${(n/1e9).toFixed(1)}B`;
      if (n >= 1e6) return `${symbol}${(n/1e6).toFixed(1)}M`;
      if (n >= 1e3) return `${symbol}${(n/1e3).toFixed(0)}K`;
      return `${symbol}${n.toFixed(0)}`;
    },
    date(d) {
      if (!d) return '-';
      return new Date(d).toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' });
    },
    dateTime(d) {
      if (!d) return '-';
      return new Date(d).toLocaleString('en-GB', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' });
    },
    stage(n) {
      const names = ['Opportunity Screening','Preliminary Assessment','Full Feasibility',
                     'Financial Close / FID','First Disbursement','COD / Commissioning'];
      return names[n] ?? `Stage ${n}`;
    },
    statusBadge(status) {
      const map = {
        not_started: 'badge-gray',
        in_progress: 'badge-blue',
        submitted:   'badge-amber',
        approved:    'badge-green',
        conditional: 'badge-orange',
        rejected:    'badge-red',
        active:      'badge-green',
        on_hold:     'badge-amber',
        completed:   'badge-green',
        cancelled:   'badge-gray',
        go:          'badge-green',
        no_go:       'badge-red',
        conditional_decision: 'badge-orange',
      };
      const cls = map[status] || 'badge-gray';
      const label = status.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
      return `<span class="badge ${cls}">${label}</span>`;
    },
    escape(s) {
      return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    },
  },
};
