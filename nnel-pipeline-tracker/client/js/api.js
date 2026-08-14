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
   * Populates the header user menu on every page.
   * Call once after getMe() resolves. Expects the page to have:
   *   <span id="user-name">      — username label
   *   <div id="user-avatar">     — avatar circle (gets the first letter)
   *   <div id="avatar-dropdown"> — dropdown container (gets menu items)
   */
  initUserMenu(user) {
    const nameEl    = document.getElementById('user-name');
    const avatarEl  = document.getElementById('user-avatar');
    const dropdownEl= document.getElementById('avatar-dropdown');
    if (!user || !dropdownEl) return;

    if (nameEl)   nameEl.textContent   = user.full_name;
    if (avatarEl) avatarEl.textContent = user.full_name.trim().charAt(0).toUpperCase();

    const ROLE_LABELS = { admin: 'Administrator', project_manager: 'Project Manager', user: 'User' };
    const roleLabel = ROLE_LABELS[user.system_role] || 'User';
    const iconTemplates = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none" style="vertical-align:middle;margin-right:6px;"><rect x="2" y="1" width="10" height="12" rx="1" stroke="currentColor" stroke-width="1.5"/><line x1="4.5" y1="5" x2="9.5" y2="5" stroke="currentColor" stroke-width="1.5" stroke-linecap="square"/><line x1="4.5" y1="8" x2="9.5" y2="8" stroke="currentColor" stroke-width="1.5" stroke-linecap="square"/><line x1="4.5" y1="11" x2="7.5" y2="11" stroke="currentColor" stroke-width="1.5" stroke-linecap="square"/></svg>`;
    const iconUsers     = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none" style="vertical-align:middle;margin-right:6px;"><circle cx="7" cy="4.5" r="2.5" stroke="currentColor" stroke-width="1.5"/><path d="M1.5 13C1.5 10 4 8 7 8s5.5 2 5.5 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="square"/></svg>`;
    const iconSignOut   = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none" style="vertical-align:middle;margin-right:6px;"><polyline points="9.5,4.5 12.5,7 9.5,9.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="square" stroke-linejoin="miter"/><line x1="12.5" y1="7" x2="5" y2="7" stroke="currentColor" stroke-width="1.5" stroke-linecap="square"/><polyline points="5,2 2,2 2,12 5,12" stroke="currentColor" stroke-width="1.5" stroke-linecap="square" stroke-linejoin="miter"/></svg>`;

    const adminLinks = user.system_role === 'admin' ? `
      <a href="/templates.html" class="dd-item">${iconTemplates}Templates</a>
      <a href="/users.html"     class="dd-item">${iconUsers}Users</a>
      <hr class="dd-divider">` : user.system_role === 'project_manager' ? `
      <a href="/templates.html" class="dd-item">${iconTemplates}Templates</a>
      <hr class="dd-divider">` : '';

    dropdownEl.innerHTML = `
      <div class="avatar-dropdown-inner">
        <div class="avatar-dropdown-header">
          <div class="dd-name">${this.fmt.escape(user.full_name)}</div>
          <div class="dd-role">${roleLabel}</div>
        </div>
        ${adminLinks}
        <button class="dd-item dd-danger" id="logout-btn">${iconSignOut}Sign out</button>
      </div>`;

    dropdownEl.querySelector('#logout-btn').addEventListener('click', () => this.logout());
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
