/* signup.js - create-account page logic */
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

  const form         = document.getElementById('signup-form');
  const errorEl      = document.getElementById('error-msg');
  const btn          = document.getElementById('submit-btn');
  const pwInput      = document.getElementById('password');
  const confirmInput = document.getElementById('confirm-password');
  const matchEl      = document.getElementById('pw-match');

  // Mirrors the server-side rules in server/routes/auth.js signup() - 
  // this is purely for instant feedback; the server re-checks everything.
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
    errorEl.textContent = '';

    const fullName   = document.getElementById('full-name').value.trim();
    const email      = document.getElementById('email').value.trim();
    const workstream = document.getElementById('workstream').value;
    const password   = pwInput.value;
    const confirm    = confirmInput.value;

    if (!fullName || !email || !workstream) {
      errorEl.textContent = 'Please fill in all fields.';
      errorEl.classList.remove('hidden');
      return;
    }
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
    btn.textContent = 'Creating account…';

    try {
      const result = await api.signup(fullName, email, password, workstream);
      if (result?.token) window.location.href = '/';
    } catch (err) {
      errorEl.textContent = err.message || 'Could not create account.';
      errorEl.classList.remove('hidden');
      btn.disabled    = false;
      btn.textContent = 'Create Account';
    }
  });
});
