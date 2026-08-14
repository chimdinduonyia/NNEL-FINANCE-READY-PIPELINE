/* auth.js — login page logic */
'use strict';

document.addEventListener('DOMContentLoaded', async () => {
  // Already logged in → go straight to portfolio
  if (api.getToken()) {
    const me = await api.getMe();
    if (me) { window.location.href = '/'; return; }
  }

  // Password show/hide
  document.querySelectorAll('.pw-toggle').forEach(toggle => {
    toggle.addEventListener('click', () => {
      const input = document.getElementById(toggle.dataset.target);
      const show  = input.type === 'password';
      input.type        = show ? 'text' : 'password';
      toggle.textContent = show ? 'Hide' : 'Show';
    });
  });

  const form    = document.getElementById('login-form');
  const errorEl = document.getElementById('error-msg');
  const btn     = document.getElementById('submit-btn');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorEl.classList.add('hidden');
    errorEl.textContent = '';

    const email    = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value;

    btn.disabled    = true;
    btn.textContent = 'Signing in…';

    try {
      const result = await api.login(email, password);
      if (result?.token) window.location.href = '/';
    } catch (err) {
      errorEl.textContent = err.message || 'Sign-in failed. Check your credentials.';
      errorEl.classList.remove('hidden');
    } finally {
      btn.disabled    = false;
      btn.textContent = 'Sign In';
    }
  });
});
