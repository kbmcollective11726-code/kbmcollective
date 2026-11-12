(function () {
  // Written at build time from VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY (see vite.config.ts).
  var config = window.__KBM_AUTH_CONFIG__ || {};
  var SUPABASE_URL = typeof config.url === 'string' ? config.url : '';
  var SUPABASE_ANON = typeof config.anonKey === 'string' ? config.anonKey : '';

  var hash = window.location.hash || '';
  var search = window.location.search || '';
  var loadingView = document.getElementById('loading-view');
  var resetFormWrap = document.getElementById('reset-form');
  var successView = document.getElementById('success-view');
  var errorView = document.getElementById('error-view');
  var statusEl = document.getElementById('status');
  var detailEl = document.getElementById('detail');
  var errorStatusEl = document.getElementById('error-status');
  var errorDetailEl = document.getElementById('error-detail');
  var passwordForm = document.getElementById('password-form');
  var formErrorEl = document.getElementById('form-error');
  var submitBtn = document.getElementById('submit-btn');

  var recoveryAccessToken = null;

  function parseParam(key, h, s) {
    try {
      var fromHash = new URLSearchParams(h.replace(/^#/, ''));
      if (fromHash.get(key)) return fromHash.get(key);
      var fromSearch = new URLSearchParams(s.replace(/^\?/, ''));
      return fromSearch.get(key) || '';
    } catch (e) {
      return '';
    }
  }

  function hideAll() {
    if (loadingView) loadingView.style.display = 'none';
    if (resetFormWrap) resetFormWrap.style.display = 'none';
    if (successView) successView.style.display = 'none';
    if (errorView) errorView.style.display = 'none';
  }

  function showError(title, detail) {
    hideAll();
    if (errorView) errorView.style.display = 'block';
    if (errorStatusEl) errorStatusEl.textContent = title;
    if (errorDetailEl) errorDetailEl.textContent = detail || '';
  }

  function showPasswordForm() {
    hideAll();
    if (resetFormWrap) resetFormWrap.style.display = 'block';
  }

  function showSuccess() {
    hideAll();
    if (successView) successView.style.display = 'block';
  }

  function verifyRecoveryTokenHash(tokenHash) {
    return fetch(SUPABASE_URL.replace(/\/+$/, '') + '/auth/v1/verify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_ANON,
        Authorization: 'Bearer ' + SUPABASE_ANON,
      },
      body: JSON.stringify({ token_hash: tokenHash, type: 'recovery' }),
    }).then(function (res) {
      return res.json().then(function (body) {
        if (!res.ok || !body || !body.access_token) {
          throw new Error(body && body.msg ? body.msg : 'invalid');
        }
        return body;
      });
    });
  }

  function updatePassword(accessToken, newPassword) {
    return fetch(SUPABASE_URL.replace(/\/+$/, '') + '/auth/v1/user', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_ANON,
        Authorization: 'Bearer ' + accessToken,
      },
      body: JSON.stringify({
        password: newPassword,
        data: { must_change_password: false },
      }),
    }).then(function (res) {
      return res.json().then(function (body) {
        if (!res.ok) {
          var msg =
            (body && (body.msg || body.error_description || body.error)) ||
            'Could not save password. Try again.';
          throw new Error(msg);
        }
        return body;
      });
    });
  }

  function startWithAccessToken(accessToken) {
    recoveryAccessToken = accessToken;
    showPasswordForm();
  }

  function bindForm() {
    if (!passwordForm) return;
    passwordForm.addEventListener('submit', function (e) {
      e.preventDefault();
      if (!recoveryAccessToken) {
        formErrorEl.textContent = 'Your session expired. Request a new reset email.';
        return;
      }
      var pw = document.getElementById('password').value.trim();
      var confirm = document.getElementById('confirm').value.trim();
      formErrorEl.textContent = '';
      if (pw.length < 8) {
        formErrorEl.textContent = 'Password must be at least 8 characters.';
        return;
      }
      if (pw !== confirm) {
        formErrorEl.textContent = 'Passwords do not match.';
        return;
      }
      submitBtn.disabled = true;
      submitBtn.textContent = 'Saving…';
      updatePassword(recoveryAccessToken, pw)
        .then(function () {
          recoveryAccessToken = null;
          showSuccess();
        })
        .catch(function (err) {
          formErrorEl.textContent =
            err && err.message
              ? String(err.message)
              : 'Could not save password. Try again.';
          submitBtn.disabled = false;
          submitBtn.textContent = 'Save password';
        });
    });
  }

  bindForm();

  if (!SUPABASE_URL || !SUPABASE_ANON) {
    showError(
      'Password reset is temporarily unavailable',
      'Please try again in a few minutes. If it keeps happening, contact your event organizer.',
    );
    return;
  }

  var tokenHash = parseParam('token_hash', hash, search);
  var type = parseParam('type', hash, search);
  var combined = (hash || '') + '&' + (search || '');

  if (tokenHash && type === 'recovery') {
    verifyRecoveryTokenHash(tokenHash)
      .then(function (body) {
        startWithAccessToken(body.access_token);
      })
      .catch(function () {
        showError(
          'This reset link no longer works',
          'It may have expired or was already used. Open KBM Connect, tap Forgot password, and request a new email. Open that new email once in your mail app.',
        );
      });
    return;
  }

  if (combined.indexOf('access_token=') !== -1) {
    var hashQuery = hash ? hash.replace(/^#/, '') : '';
    var searchQuery = search ? search.replace(/^\?/, '') : '';
    var params = new URLSearchParams(hashQuery || searchQuery);
    var at = params.get('access_token');
    if (at) {
      startWithAccessToken(at);
      return;
    }
  }

  showError(
    'This reset link is not valid',
    'Open KBM Connect, tap Forgot password, and request a new email. Check your Junk or Spam folder.',
  );
})();
