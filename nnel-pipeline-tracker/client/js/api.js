/* api.js - lightweight API client shared by all pages */
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
   * empty element: <aside class="sidebar" id="sidebar"></aside> - this
   * function owns everything inside it.
   *
   * Collapse behaviour: the user's expand/collapse preference is
   * remembered (localStorage) and reused on every page EXCEPT the project
   * view, which always starts collapsed - checklists and tabs need the
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
    const iconFolder    = `<svg width="16" height="16" viewBox="0 0 14 14" fill="none"><path d="M1.5 3.5c0-.55.45-1 1-1h3l1 1.3h5.5c.55 0 1 .45 1 1V10.5c0 .55-.45 1-1 1h-9.5c-.55 0-1-.45-1-1V3.5Z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>`;
    const iconDocs      = `<svg width="16" height="16" viewBox="0 0 14 14" fill="none"><path d="M3 1.5h5.5L11 4v8.5H3V1.5Z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M8.5 1.5V4H11" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><line x1="4.8" y1="7" x2="9.2" y2="7" stroke="currentColor" stroke-width="1.2" stroke-linecap="square"/><line x1="4.8" y1="9.3" x2="9.2" y2="9.3" stroke="currentColor" stroke-width="1.2" stroke-linecap="square"/></svg>`;
    const iconSignOut   = `<svg width="15" height="15" viewBox="0 0 14 14" fill="none"><polyline points="9.5,4.5 12.5,7 9.5,9.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="square" stroke-linejoin="miter"/><line x1="12.5" y1="7" x2="5" y2="7" stroke="currentColor" stroke-width="1.5" stroke-linecap="square"/><polyline points="5,2 2,2 2,12 5,12" stroke="currentColor" stroke-width="1.5" stroke-linecap="square" stroke-linejoin="miter"/></svg>`;
    const iconChevronsLeft  = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><polyline points="8.5,2.5 3.5,7 8.5,11.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="square" stroke-linejoin="miter"/><polyline points="12,2.5 7,7 12,11.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="square" stroke-linejoin="miter"/></svg>`;
    const iconChevronsRight = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><polyline points="5.5,2.5 10.5,7 5.5,11.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="square" stroke-linejoin="miter"/><polyline points="2,2.5 7,7 2,11.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="square" stroke-linejoin="miter"/></svg>`;

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
      // Admins and PMs get the portfolio-wide VDR (every project's document
      // register); everyone else gets their own personal upload footprint.
      // Matches how PMs are treated everywhere else in the app.
      { href: '/vdr.html', label: 'VDR', icon: iconFolder,
        match: p => p === '/vdr.html', visible: ['admin','project_manager'].includes(user.system_role) },
      { href: '/documents.html', label: 'Documents', icon: iconDocs,
        match: p => p === '/documents.html', visible: !['admin','project_manager'].includes(user.system_role) },
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
      <div class="sidebar-recents" id="sidebar-recents">
        <hr class="sidebar-divider">
        <div class="sidebar-recents-heading">Recents</div>
        <div id="sidebar-recents-list"></div>
      </div>
      <div class="sidebar-toggle-row">
        <button type="button" class="sidebar-toggle" id="sidebar-toggle-btn">
          <span id="sidebar-toggle-icon">${iconChevronsLeft}</span><span class="sidebar-toggle-label">Collapse</span>
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

    const toggleBtn  = document.getElementById('sidebar-toggle-btn');
    const toggleIcon = document.getElementById('sidebar-toggle-icon');
    const applyCollapsed = () => {
      sidebar.classList.toggle('collapsed', collapsed);
      toggleBtn.title = collapsed ? 'Expand sidebar' : 'Collapse sidebar';
      toggleIcon.innerHTML = collapsed ? iconChevronsRight : iconChevronsLeft;
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

    // Unread notifications badge - best-effort, never blocks sidebar rendering
    this.get('/api/notifications/unread-count').then(({ count }) => {
      const badge = document.getElementById('sidebar-notif-badge');
      if (badge && count > 0) {
        badge.textContent = count > 99 ? '99+' : String(count);
        badge.classList.remove('hidden');
      }
    }).catch(() => {});

    // Recents - projects this user has actually been active on lately.
    // Best-effort, same as the badge above.
    this.get('/api/projects/recent').then(items => {
      const list = document.getElementById('sidebar-recents-list');
      if (!list) return;

      if (!items.length) {
        list.innerHTML = `<div class="sidebar-recents-empty">No recent activity</div>`;
        return;
      }

      list.innerHTML = items.map(p => `
        <a href="/project.html?id=${p.id}" class="sidebar-recent-link">
          <span class="sidebar-recent-name">${this.fmt.escape(p.name.toUpperCase())}</span>
        </a>`).join('');

      // Marquee-on-hover, but only for names that actually overflow their
      // width - measured directly rather than guessed, so short names never
      // twitch and long ones scroll exactly far enough to reveal the end.
      list.querySelectorAll('.sidebar-recent-link').forEach(link => {
        const nameEl = link.querySelector('.sidebar-recent-name');
        link.addEventListener('mouseenter', () => {
          const overflow = nameEl.scrollWidth - nameEl.clientWidth;
          if (overflow > 2) {
            nameEl.style.transition = `transform ${Math.max(1.2, overflow / 40)}s linear`;
            nameEl.style.transform = `translateX(-${overflow}px)`;
          }
        });
        link.addEventListener('mouseleave', () => {
          nameEl.style.transition = 'transform 0.25s ease';
          nameEl.style.transform = 'translateX(0)';
        });
      });
    }).catch(() => {});

    this.startPresenceHeartbeat();
  },

  // Pings "I'm here" once immediately and then every 60s for as long as this
  // page stays open - see server/routes/presence.js for what "active" means.
  // Called once from initSidebar(), so every authenticated page gets it for
  // free without needing its own setup.
  startPresenceHeartbeat() {
    const HEARTBEAT_MS = 60000;
    const beat = () => this.post('/api/presence/heartbeat', {}).catch(() => {});
    beat();
    setInterval(beat, HEARTBEAT_MS);
  },

  /**
   * Renders a Teams/Google-Docs-style overlapping avatar stack from a list
   * of { full_name } objects. Caps how many circles show and folds the rest
   * into a "+N" badge.
   */
  buildAvatarStack(users, { max = 6, emptyText = 'No one else is active right now' } = {}) {
    if (!users || users.length === 0) {
      return `<div class="avatar-stack-empty">${this.fmt.escape(emptyText)}</div>`;
    }
    const shown    = users.slice(0, max);
    const overflow = users.length - shown.length;
    const items = shown.map(u => `
      <div class="avatar-stack-item" title="${this.fmt.escape(u.full_name)}">
        ${this.fmt.escape(u.full_name.trim().charAt(0).toUpperCase())}
      </div>`).join('');
    const moreBadge = overflow > 0
      ? `<div class="avatar-stack-item avatar-stack-more" title="${overflow} more active">+${overflow}</div>`
      : '';
    return `<div class="avatar-stack">${items}${moreBadge}</div>`;
  },

  // Shared icon set - geometric line icons (stroke=currentColor, square
  // linecaps/miter joins to match the rest of the app) used in place of
  // emoji everywhere. Each is a bare <svg> string; wrap with inline
  // style="vertical-align:middle;margin-right:6px;" at the call site same
  // as any other inline icon in this app.
  icons: {
    document:    `<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="2" y="1" width="10" height="12" rx="1" stroke="currentColor" stroke-width="1.4"/><line x1="4.5" y1="5" x2="9.5" y2="5" stroke="currentColor" stroke-width="1.4" stroke-linecap="square"/><line x1="4.5" y1="8" x2="9.5" y2="8" stroke="currentColor" stroke-width="1.4" stroke-linecap="square"/></svg>`,
    pencil:      `<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M9.5 2.5 11.5 4.5 4.5 11.5H2.5V9.5L9.5 2.5Z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><line x1="8" y1="4" x2="10" y2="6" stroke="currentColor" stroke-width="1.3"/></svg>`,
    trash:       `<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2.5 4h9M5.5 4V2.5h3V4M3.5 4l.5 8h6l.5-8" stroke="currentColor" stroke-width="1.3" stroke-linecap="square" stroke-linejoin="round"/><line x1="5.7" y1="6" x2="5.9" y2="10" stroke="currentColor" stroke-width="1.1"/><line x1="8.3" y1="6" x2="8.1" y2="10" stroke="currentColor" stroke-width="1.1"/></svg>`,
    lock:        `<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="2.5" y="6.5" width="9" height="6" rx="1" stroke="currentColor" stroke-width="1.4"/><path d="M4.3 6.5V4.7a2.7 2.7 0 0 1 5.4 0V6.5" stroke="currentColor" stroke-width="1.4"/></svg>`,
    unlock:      `<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="2.5" y="6.5" width="9" height="6" rx="1" stroke="currentColor" stroke-width="1.4"/><path d="M4.3 6.5V4.7a2.7 2.7 0 0 1 5.2-1.1" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>`,
    warning:     `<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 1.8 12.8 12H1.2L7 1.8Z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><line x1="7" y1="5.5" x2="7" y2="8.3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><circle cx="7" cy="10.2" r="0.7" fill="currentColor"/></svg>`,
    printer:     `<svg width="15" height="15" viewBox="0 0 14 14" fill="none"><rect x="3" y="5" width="8" height="4.5" stroke="currentColor" stroke-width="1.3"/><path d="M4 5V2h6v3" stroke="currentColor" stroke-width="1.3"/><path d="M4 9.5v2.5h6V9.5" stroke="currentColor" stroke-width="1.3"/></svg>`,
    paperclip:   `<svg width="13" height="14" viewBox="0 0 12 14" fill="none"><path d="M9 4v5.2a3 3 0 1 1-6 0V3a2 2 0 1 1 4 0v6a1 1 0 1 1-2 0V4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    checkCircle: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6.5" stroke="currentColor" stroke-width="1.4"/><polyline points="5,8.2 7,10.2 11,6" stroke="currentColor" stroke-width="1.5" stroke-linecap="square" stroke-linejoin="miter"/></svg>`,
    emptyCircle: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6.5" stroke="currentColor" stroke-width="1.4"/></svg>`,
    clipboard:   `<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="2.5" y="2" width="9" height="11" rx="1" stroke="currentColor" stroke-width="1.3"/><rect x="5" y="1" width="4" height="2" rx="0.5" stroke="currentColor" stroke-width="1.2"/><line x1="4.5" y1="6" x2="9.5" y2="6" stroke="currentColor" stroke-width="1.2"/><line x1="4.5" y1="8.5" x2="9.5" y2="8.5" stroke="currentColor" stroke-width="1.2"/></svg>`,
    chainLink:   `<svg width="15" height="15" viewBox="0 0 14 14" fill="none"><rect x="1.5" y="4.5" width="6" height="5" rx="2.5" stroke="currentColor" stroke-width="1.3"/><rect x="6.5" y="4.5" width="6" height="5" rx="2.5" stroke="currentColor" stroke-width="1.3"/></svg>`,
    clock:       `<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="6" stroke="currentColor" stroke-width="1.4"/><polyline points="7,3.5 7,7 9.5,8.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="square"/></svg>`,
    settings:    `<svg width="15" height="15" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="2" stroke="currentColor" stroke-width="1.3"/><path d="M7 1.5v1.4M7 11.1v1.4M12.5 7h-1.4M2.9 7H1.5M10.7 3.3l-1 1M4.3 9.7l-1 1M10.7 10.7l-1-1M4.3 4.3l-1-1" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>`,
    send:        `<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M12.5 1.5 6 8M12.5 1.5 8.5 12.5 6 8 1.5 5.5 12.5 1.5Z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>`,
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
