/**
 * Admin Credentials Routes
 *
 * Provides admin endpoints for configuring CAIA OAuth credentials.
 * Credentials are stored in AWS Secrets Manager.
 */

import { Router, Request, Response } from 'express';
import { authMiddleware, superAdminMiddleware } from '../middleware/auth.js';
import { logAuditEvent } from '../services/audit.js';
import {
  isCAIAConfigured,
  validateIssuerDiscovery,
  resetCAIAClient,
} from '../services/caia.js';
import {
  getCAIACredentials,
  saveCAIACredentials,
  getCAIASecretPath,
  getChangedFields,
  type CAIACredentials,
} from '../services/secrets-manager.js';
import { sendInternalError } from '../utils/route-http.js';
import { getAuthenticatedUserContext } from '../utils/auth-context.js';

const router = Router();

// Get base URL from environment
function getBaseUrl(): string {
  return process.env.APP_BASE_URL || '';
}

// Get auto-derived redirect URI (must match CAIA client registration)
function getRedirectUri(): string {
  const baseUrl = getBaseUrl();
  return baseUrl ? `${baseUrl}/api/auth/piv/callback` : '';
}

/**
 * Render the admin credentials page HTML
 * Uses JavaScript fetch() for form submission - no page reloads
 */
function renderPage(options: {
  currentConfig: {
    issuerUrl: string;
    clientId: string;
    hasClientSecret: boolean;
  };
  isConfigured: boolean;
  redirectUri: string;
  secretPath: string;
}): string {
  const { currentConfig, isConfigured, redirectUri, secretPath } = options;

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>CAIA Credentials - Ship Admin</title>
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif;
      background: #0a0a0b;
      color: #e4e4e7;
      margin: 0;
      padding: 20px;
      min-height: 100vh;
    }
    .container { max-width: 600px; margin: 0 auto; }
    h1 { color: #fff; margin-bottom: 8px; }
    .subtitle { color: #71717a; margin-bottom: 24px; }
    .card {
      background: #18181b;
      border: 1px solid #27272a;
      border-radius: 8px;
      padding: 24px;
      margin-bottom: 16px;
    }
    .status {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 4px 12px;
      border-radius: 9999px;
      font-size: 14px;
      margin-bottom: 16px;
    }
    .status.configured { background: #052e16; color: #4ade80; }
    .status.not-configured { background: #450a0a; color: #f87171; }
    .field { margin-bottom: 16px; }
    label {
      display: block;
      font-size: 14px;
      font-weight: 500;
      margin-bottom: 6px;
      color: #a1a1aa;
    }
    input, textarea {
      width: 100%;
      padding: 10px 12px;
      background: #27272a;
      border: 1px solid #3f3f46;
      border-radius: 6px;
      color: #e4e4e7;
      font-size: 14px;
    }
    input:focus, textarea:focus {
      outline: none;
      border-color: #3b82f6;
    }
    input:read-only {
      background: #1f1f23;
      color: #71717a;
    }
    .hint {
      font-size: 12px;
      color: #71717a;
      margin-top: 4px;
    }
    button {
      background: #3b82f6;
      color: white;
      border: none;
      padding: 10px 20px;
      border-radius: 6px;
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
      width: 100%;
    }
    button:hover { background: #2563eb; }
    button:disabled { background: #3f3f46; cursor: not-allowed; }
    .btn-secondary {
      background: #27272a;
      border: 1px solid #3f3f46;
    }
    .btn-secondary:hover { background: #3f3f46; }
    .alert {
      padding: 12px 16px;
      border-radius: 6px;
      margin-bottom: 16px;
      font-size: 14px;
      display: none;
    }
    .alert.show { display: block; }
    .alert.error { background: #450a0a; border: 1px solid #7f1d1d; color: #fca5a5; }
    .alert.success { background: #052e16; border: 1px solid #166534; color: #86efac; }
    .alert.warning { background: #451a03; border: 1px solid #92400e; color: #fcd34d; }
    .back-link {
      display: inline-block;
      color: #3b82f6;
      text-decoration: none;
      margin-bottom: 16px;
    }
    .back-link:hover { text-decoration: underline; }
    .info-box {
      background: #1e3a5f;
      border: 1px solid #2563eb;
      border-radius: 6px;
      padding: 16px;
      margin-bottom: 16px;
    }
    .info-box h3 { margin: 0 0 8px; color: #93c5fd; font-size: 14px; }
    .info-box p { margin: 0; font-size: 13px; color: #bfdbfe; }
    .info-box code {
      background: #1e40af;
      padding: 2px 6px;
      border-radius: 4px;
      font-family: monospace;
    }
    .button-group {
      display: flex;
      gap: 12px;
      margin-top: 16px;
    }
    .button-group button {
      flex: 1;
    }
    .spinner {
      display: inline-block;
      width: 14px;
      height: 14px;
      border: 2px solid #fff;
      border-radius: 50%;
      border-top-color: transparent;
      animation: spin 1s linear infinite;
      margin-right: 8px;
      vertical-align: middle;
    }
    @keyframes spin {
      to { transform: rotate(360deg); }
    }
  </style>
</head>
<body>
  <div class="container">
    <a href="/" class="back-link">← Back to Ship</a>

    <h1>CAIA Credentials</h1>
    <p class="subtitle">Configure Treasury CAIA OAuth integration for PIV authentication</p>

    <div id="alert-error" class="alert error"></div>
    <div id="alert-success" class="alert success"></div>
    <div id="alert-warning" class="alert warning"></div>

    <div class="card">
      <div id="status-badge" class="status ${isConfigured ? 'configured' : 'not-configured'}">
        <span>${isConfigured ? '✓ Configured' : '○ Not Configured'}</span>
      </div>

      <div class="info-box">
        <h3>Secrets Manager Storage</h3>
        <p>
          Credentials are stored in AWS Secrets Manager at:<br>
          <code>${escapeHtml(secretPath)}</code>
        </p>
      </div>

      <div class="field">
        <label for="issuer_url">Issuer URL *</label>
        <input
          type="url"
          id="issuer_url"
          value="${escapeHtml(currentConfig.issuerUrl)}"
          placeholder="https://caia.treasury.gov"
        />
        <p class="hint">The CAIA OAuth issuer URL (OIDC discovery endpoint base)</p>
      </div>

      <div class="field">
        <label for="client_id">Client ID *</label>
        <input
          type="text"
          id="client_id"
          value="${escapeHtml(currentConfig.clientId)}"
          placeholder="your-client-id"
        />
        <p class="hint">OAuth client identifier registered with CAIA</p>
      </div>

      <div class="field">
        <label for="client_secret">Client Secret *</label>
        <input
          type="password"
          id="client_secret"
          placeholder="${currentConfig.hasClientSecret ? '••••••••••••••••' : 'Enter client secret'}"
        />
        <p class="hint">
          OAuth client secret.
          ${currentConfig.hasClientSecret ? 'Leave blank to keep existing secret.' : ''}
        </p>
      </div>

      <div class="field">
        <label>Redirect URI (auto-derived)</label>
        <input type="text" value="${escapeHtml(redirectUri)}" readonly />
        <p class="hint">Register this URI with CAIA. Derived from APP_BASE_URL.</p>
      </div>

      <div class="button-group">
        <button type="button" id="save-btn">Save Credentials</button>
      </div>
    </div>

    <div class="card">
      <h3 style="margin-top: 0; color: #e4e4e7;">Test Configuration</h3>
      <p style="color: #71717a; font-size: 14px; margin-bottom: 16px;">
        Test that the issuer URL is reachable and returns valid OIDC metadata.
        Note: Client ID/Secret cannot be fully validated until a real login attempt.
      </p>
      <button type="button" id="test-btn" class="btn-secondary">
        Test CAIA Connection
      </button>
    </div>
  </div>

  <script>
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
        // Fetch CSRF token first
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
          // Show warning if validation failed
          if (data.warning) {
            showWarning('Warning: ' + data.warning);
          }
          // Clear password field after successful save
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
        // Fetch CSRF token first
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

    // Attach event listeners (CSP blocks inline onclick handlers)
    document.getElementById('save-btn').addEventListener('click', saveCredentials);
    document.getElementById('test-btn').addEventListener('click', testConnection);
  </script>
</body>
</html>
  `;
}

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * GET /api/admin/credentials - Show credential configuration page
 */
router.get('/', authMiddleware, superAdminMiddleware, async (_req: Request, res: Response): Promise<void> => {
  // Fetch current config from Secrets Manager
  const result = await getCAIACredentials();

  const currentConfig = {
    issuerUrl: result.credentials?.issuer_url || '',
    clientId: result.credentials?.client_id || '',
    hasClientSecret: !!result.credentials?.client_secret,
  };

  const html = renderPage({
    currentConfig,
    isConfigured: result.configured,
    redirectUri: getRedirectUri(),
    secretPath: getCAIASecretPath(),
  });

  res.setHeader('Content-Type', 'text/html');
  res.send(html);
});

/**
 * POST /api/admin/credentials/save - Save credentials via JSON API
 */
router.post('/save', authMiddleware, superAdminMiddleware, async (req: Request, res: Response): Promise<void> => {
  const { userId: actorUserId } = getAuthenticatedUserContext(req);
  const { issuer_url, client_id, client_secret } = req.body;
  const submittedIssuerUrl = (issuer_url || '').trim();
  const submittedClientId = (client_id || '').trim();

  // Validate required fields
  if (!submittedIssuerUrl || !submittedClientId) {
    res.status(400).json({
      success: false,
      error: { message: 'Issuer URL and Client ID are required' },
    });
    return;
  }

  // Get existing credentials to check what changed
  const existingResult = await getCAIACredentials();
  const existingCreds = existingResult.credentials;

  // Build new credentials (keep existing secret if not provided)
  const newSecret = client_secret || existingCreds?.client_secret;
  if (!newSecret) {
    res.status(400).json({
      success: false,
      error: { message: 'Client Secret is required' },
    });
    return;
  }

  const newCredentials: CAIACredentials = {
    issuer_url: submittedIssuerUrl,
    client_id: submittedClientId,
    client_secret: newSecret,
  };

  // Validate issuer discovery before saving (but save anyway with warning if it fails)
  console.log('[AdminCredentials] Validating credentials before save...');
  console.log(`[AdminCredentials]   Issuer URL: ${newCredentials.issuer_url}`);
  console.log(`[AdminCredentials]   Client ID: ${newCredentials.client_id}`);

  let validationWarning: string | null = null;
  try {
    await validateIssuerDiscovery(
      newCredentials.issuer_url,
      newCredentials.client_id,
      newCredentials.client_secret
    );
    console.log('[AdminCredentials] Validation passed, proceeding to save...');
  } catch (err) {
    const error = err as Error & { cause?: unknown; code?: string };
    const errorMessage = error.message || 'Unknown error';
    console.error('[AdminCredentials] Validation FAILED (will save anyway):');
    console.error(`[AdminCredentials]   Message: ${errorMessage}`);
    console.error(`[AdminCredentials]   Name: ${error.name}`);
    if (error.code) {
      console.error(`[AdminCredentials]   Code: ${error.code}`);
    }
    if (error.cause) {
      console.error('[AdminCredentials]   Cause:', error.cause);
    }
    // Store warning but continue with save
    validationWarning = `Issuer discovery failed: ${errorMessage}`;
    console.log('[AdminCredentials] Proceeding to save despite validation failure...');
  }

  // Determine which fields changed for audit logging
  const changedFields = getChangedFields(existingCreds, newCredentials);

  // Save to Secrets Manager
  try {
    await saveCAIACredentials(newCredentials);

    // Reset CAIA client to pick up new credentials
    resetCAIAClient();

    // Audit log the change
    await logAuditEvent({
      actorUserId,
      action: 'admin.update_caia_credentials',
      details: {
        changedFields,
        secretPath: getCAIASecretPath(),
      },
      req,
    });

    // Build success message with optional warning
    let message = 'Credentials saved successfully!';
    if (validationWarning) {
      message += ` Warning: ${validationWarning}`;
    } else {
      message += ' Issuer discovery validated.';
    }

    res.json({
      success: true,
      message,
      warning: validationWarning || undefined,
    });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';

    await logAuditEvent({
      actorUserId,
      action: 'admin.update_caia_credentials_failed',
      details: {
        error: errorMessage,
        secretPath: getCAIASecretPath(),
      },
      req,
    });

    sendInternalError(res, err, '[AdminCredentials] Save failed:', {
      success: false,
      error: { message: `Failed to save credentials: ${errorMessage}` },
    });
  }
});

/**
 * POST /api/admin/credentials/test-api - Test CAIA connection via JSON API
 */
router.post('/test-api', authMiddleware, superAdminMiddleware, async (req: Request, res: Response): Promise<void> => {
  const { userId: actorUserId } = getAuthenticatedUserContext(req);
  const configured = await isCAIAConfigured();
  if (!configured) {
    res.status(400).json({
      success: false,
      error: { message: 'CAIA is not configured. Save credentials first.' },
    });
    return;
  }

  try {
    // Fetch credentials and test discovery
    const result = await getCAIACredentials();
    if (!result.credentials) {
      throw new Error('Credentials not found');
    }

    const { issuer } = await validateIssuerDiscovery(
      result.credentials.issuer_url,
      result.credentials.client_id,
      result.credentials.client_secret
    );

    await logAuditEvent({
      actorUserId,
      action: 'admin.test_caia_connection',
      details: { success: true, issuer },
      req,
    });

    res.json({
      success: true,
      message: `CAIA connection successful! Issuer: ${issuer}`,
    });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';

    await logAuditEvent({
      actorUserId,
      action: 'admin.test_caia_connection',
      details: { success: false, error: errorMessage },
      req,
    });

    sendInternalError(res, err, '[AdminCredentials] CAIA test failed:', {
      success: false,
      error: { message: `CAIA connection failed: ${errorMessage}` },
    });
  }
});

/**
 * POST /api/admin/credentials/test - Legacy redirect-based test (kept for compatibility)
 */
router.post('/test', authMiddleware, superAdminMiddleware, async (req: Request, res: Response): Promise<void> => {
  const { userId: actorUserId } = getAuthenticatedUserContext(req);
  const configured = await isCAIAConfigured();
  if (!configured) {
    res.redirect('/api/admin/credentials?error=' + encodeURIComponent('CAIA is not configured. Save credentials first.'));
    return;
  }

  try {
    const result = await getCAIACredentials();
    if (!result.credentials) {
      throw new Error('Credentials not found');
    }

    const { issuer } = await validateIssuerDiscovery(
      result.credentials.issuer_url,
      result.credentials.client_id,
      result.credentials.client_secret
    );

    await logAuditEvent({
      actorUserId,
      action: 'admin.test_caia_connection',
      details: { success: true, issuer },
      req,
    });

    res.redirect('/api/admin/credentials?success=' + encodeURIComponent(`CAIA connection successful! Issuer: ${issuer}`));
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';

    await logAuditEvent({
      actorUserId,
      action: 'admin.test_caia_connection',
      details: { success: false, error: errorMessage },
      req,
    });

    res.redirect('/api/admin/credentials?error=' + encodeURIComponent(`CAIA connection failed: ${errorMessage}`));
  }
});

/**
 * GET /api/admin/credentials/status - API endpoint for credential status
 */
router.get('/status', authMiddleware, superAdminMiddleware, async (_req: Request, res: Response): Promise<void> => {
  const result = await getCAIACredentials();

  res.json({
    success: true,
    data: {
      configured: result.configured,
      issuerUrl: result.credentials?.issuer_url || null,
      clientId: result.credentials?.client_id || null,
      hasClientSecret: !!result.credentials?.client_secret,
      redirectUri: getRedirectUri(),
      secretPath: getCAIASecretPath(),
      error: result.error,
    },
  });
});

export default router;
