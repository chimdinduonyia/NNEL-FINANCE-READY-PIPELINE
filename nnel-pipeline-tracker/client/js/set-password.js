/* set-password.js — invite-acceptance page logic */
'use strict';

document.addEventListener('DOMContentLoaded', async () => {
  const token = new URLSearchParams(window.location.search).get('token');

  const loadingEl = document.getElementById('invite-loading');
  const invalidEl = document.getElementById('invite-invalid');
  const formWrap  = document.getElementById('invite-form-wrap');

  if (!token) {
    loadingEl.classList.add('hidden');
    invalidEl.classList.remove('hidden');
    return;
  }

  let invitee;
  try {
    invitee = await api.get(`/api/auth/invite/${encodeURIComponent(token)}`);
  } catch {
    loadingEl.classList.add('hidden');
    invalidEl.classList.remove('hidden');
    return;
  }

  document.getElementById('invite-greeting').textContent =
    `Welcome, ${invitee.full_name} — activate your account (${invitee.email}) below.`;
  loadingEl.classList.add('hidden');
  formWrap.classList.remove('hidden');

  // Password show/hide
  document.querySelectorAll('.pw-toggle').forEach(toggle => {
    toggle.addEventListener('click', () => {
      const input = document.getElementById(toggle.dataset.target);
      const show  = input.type === 'password';
      input.type        = show ? 'text' : 'password';
      toggle.textContent = show ? 'Hide' : 'Show';
    });
  });

  const form         = document.getElementById('invite-form');
  const errorEl      = document.getElementById('error-msg');
  const btn          = document.getElementById('submit-btn');
  const pwInput      = document.getElementById('password');
  const confirmInput = document.getElementById('confirm-password');
  const matchEl      = document.getElementById('pw-match');

  // Mirrors the server-side rules in server/routes/auth.js passwordStrengthError()
  const RULES = {
    length:  pw => pw.length >= 12,
    letter:  pw => /[A-Za-z]/.test(pw),
    number:  pw => /[0-9]/.test(pw),
    special: pw => /[^A-Za-z0-9]/.test(pw),
  };

  function passwordValid(pw) {
    return Object.values(RULES).every(fn => fn(pw));
  }

  function updateRules() {
    const pw = pwInput.value;
    document.querySelectorAll('#pw-rules li').forEach(li => {
      li.classList.toggle('met', RULES[li.dataset.rule](pw));
    });
  }

  function updateMatch() {
    const pw      = pwInput.value;
    const confirm = confirmInput.value;
    if (!confirm) {
      matchEl.classList.add('hidden');
    } else {
      const isMatch = pw === confirm;
      matchEl.textContent = isMatch ? 'Passwords match' : 'Passwords do not match';
      matchEl.classList.remove('hidden');
      matchEl.classList.toggle('match', isMatch);
      matchEl.classList.toggle('no-match', !isMatch);
    }
  }

  function updateSubmitState() {
    const pw      = pwInput.value;
    const confirm = confirmInput.value;
    btn.disabled = !(passwordValid(pw) && confirm.length > 0 && pw === confirm);
  }

  pwInput.addEventListener('input', () => { updateRules(); updateMatch(); updateSubmitState(); });
  confirmInput.addEventListener('input', () => { updateMatch(); updateSubmitState(); });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorEl.classList.add('hidden');

    const password = pwInput.value;
    const confirm  = confirmInput.value;

    if (password !== confirm) {
      errorEl.textContent = 'Passwords do not match.';
      errorEl.classList.remove('hidden');
      return;
    }
    if (!passwordValid(password)) {
      errorEl.textContent = 'Password does not meet the requirements above.';
      errorEl.classList.remove('hidden');
      return;
    }

    btn.disabled    = true;
    btn.textContent = 'Setting password…';

    try {
      const result = await api.post('/api/auth/accept-invite', { token, password });
      if (result?.token) {
        api.setToken(result.token);
        window.location.href = '/';
      }
    } catch (err) {
      errorEl.textContent = err.message || 'Could not set password.';
      errorEl.classList.remove('hidden');
      btn.disabled    = false;
      btn.textContent = 'Set Password & Sign In';
    }
  });
});
