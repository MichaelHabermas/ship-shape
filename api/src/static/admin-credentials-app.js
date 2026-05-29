function showError(msg) {
  const el = document.getElementById('alert-error');
  el.textContent = msg;
  el.classList.add('show');
  document.getElementById('alert-success').classList.remove('show');
}

function showSuccess(msg) {
  const el = document.getElementById('alert-success');
  el.textContent = msg;
  el.classList.add('show');
  document.getElementById('alert-error').classList.remove('show');
}

function clearAlerts() {
  document.getElementById('alert-error').classList.remove('show');
  document.getElementById('alert-success').classList.remove('show');
  document.getElementById('alert-warning').classList.remove('show');
}

function showWarning(msg) {
  const el = document.getElementById('alert-warning');
  el.textContent = msg;
  el.classList.add('show');
}

function updateStatus(configured) {
  const badge = document.getElementById('status-badge');
  if (configured) {
    badge.className = 'status configured';
    badge.innerHTML = '<span>✓ Configured</span>';
  } else {
    badge.className = 'status not-configured';
    badge.innerHTML = '<span>○ Not Configured</span>';
  }
}

function setButtonLoading(btnId, loading) {
  const btn = document.getElementById(btnId);
  if (loading) {
    btn.disabled = true;
    btn.dataset.originalText = btn.textContent;
    btn.innerHTML = '<span class="spinner"></span>Saving...';
  } else {
    btn.disabled = false;
    btn.textContent = btn.dataset.originalText || 'Save';
  }
}

async function saveCredentials() {
  clearAlerts();

  const issuerUrl = document.getElementById('issuer_url').value.trim();
  const clientId = document.getElementById('client_id').value.trim();
  const clientSecret = document.getElementById('client_secret').value;

  if (!issuerUrl || !clientId) {
    showError('Issuer URL and Client ID are required');
    return;
  }

  setButtonLoading('save-btn', true);

  try {
    const csrfRes = await fetch('/api/csrf-token', { credentials: 'include' });
    const csrfData = await csrfRes.json();
    const csrfToken = csrfData.token;

    const res = await fetch('/api/admin/credentials/save', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-csrf-token': csrfToken,
      },
      credentials: 'include',
      body: JSON.stringify({
        issuer_url: issuerUrl,
        client_id: clientId,
        client_secret: clientSecret || undefined,
      }),
    });

    const data = await res.json();

    if (data.success) {
      showSuccess(data.message || 'Credentials saved successfully!');
      updateStatus(true);
      if (data.warning) {
        showWarning('Warning: ' + data.warning);
      }
      document.getElementById('client_secret').placeholder = '••••••••••••••••';
      document.getElementById('client_secret').value = '';
    } else {
      showError(data.error?.message || 'Failed to save credentials');
    }
  } catch (err) {
    showError('Network error: ' + err.message);
  } finally {
    setButtonLoading('save-btn', false);
  }
}

async function testConnection() {
  clearAlerts();

  const btn = document.getElementById('test-btn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>Testing...';

  try {
    const csrfRes = await fetch('/api/csrf-token', { credentials: 'include' });
    const csrfData = await csrfRes.json();
    const csrfToken = csrfData.token;

    const res = await fetch('/api/admin/credentials/test-api', {
      method: 'POST',
      headers: { 'x-csrf-token': csrfToken },
      credentials: 'include',
    });

    const data = await res.json();

    if (data.success) {
      showSuccess(data.message || 'Connection successful');
    } else {
      showError(data.error?.message || 'Connection test failed');
    }
  } catch (err) {
    showError('Network error: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Test CAIA Connection';
  }
}

document.getElementById('save-btn').addEventListener('click', saveCredentials);
document.getElementById('test-btn').addEventListener('click', testConnection);
