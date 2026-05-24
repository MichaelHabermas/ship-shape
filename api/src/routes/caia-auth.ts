/**
 * CAIA Authentication Routes
 *
 * Provides OAuth-based PIV smartcard authentication via Treasury's CAIA
 * (Customer Authentication & Identity Architecture) OAuth server.
 *
 * Key differences from FPKI Validator:
 * - CAIA's `sub` claim is NOT persistent (changes on re-provisioning)
 * - Email is the primary identifier for user matching
 * - No x509_subject_dn claim (CAIA acts as broker, doesn't expose certificate details)
 */

import { Router, Request, Response } from 'express';
import { pool } from '../db/client.js';
import {
  isCAIAConfigured,
  getAuthorizationUrl,
  handleCallback,
} from '../services/caia.js';
import { sendInternalError } from '../utils/route-http.js';
import { linkUserToWorkspaceViaInvite } from '../services/invite-acceptance.js';
import {
  generateSecureSessionId,
  storeOAuthState,
  consumeOAuthState,
} from '../services/oauth-state.js';
import { SESSION_TIMEOUT_MS } from '@ship/shared';
import { logAuditEvent } from '../services/audit.js';
import { sessionCookieOptions } from '../config/session-cookies.js';
import { safeRelativeReturnTo } from '../security/redirects.js';

const router = Router();

/**
 * Basic email format validation
 * Validates federal .gov/.mil email addresses
 */
const EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.(gov|mil)$/i;

function isValidEmail(email: string): boolean {
  return EMAIL_REGEX.test(email) && email.length <= 254;
}

// GET /api/auth/caia/status - Check if CAIA auth is available
router.get('/status', async (_req: Request, res: Response): Promise<void> => {
  const available = await isCAIAConfigured();
  res.json({
    success: true,
    data: {
      available,
    },
  });
});

// GET /api/auth/caia/login - Initiate CAIA login flow
router.get('/login', async (req: Request, res: Response): Promise<void> => {
  const configured = await isCAIAConfigured();
  if (!configured) {
    res.status(503).json({
      success: false,
      error: { code: 'CAIA_NOT_CONFIGURED', message: 'CAIA authentication not configured' },
    });
    return;
  }

  try {
    const { url, state, nonce, codeVerifier } = await getAuthorizationUrl();

    // Store OAuth state in database (survives server restarts)
    await storeOAuthState(state, nonce, codeVerifier);

    res.json({
      success: true,
      data: { authorizationUrl: url },
    });
  } catch (error) {
    sendInternalError(res, error, 'CAIA login initiation error:', {
      success: false,
      error: { code: 'CAIA_INIT_ERROR', message: 'Failed to initiate CAIA login' },
    });
  }
});

// GET /api/auth/caia/callback - Handle OAuth callback from CAIA
router.get('/callback', async (req: Request, res: Response): Promise<void> => {
  const { code, state, error, error_description } = req.query;

  // Handle OAuth errors from the authorization server
  if (error) {
    console.error('CAIA OAuth error:', error, error_description);
    await logAuditEvent({
      action: 'auth.caia_login_failed',
      details: { reason: 'oauth_error', error: String(error), errorDescription: String(error_description || '') },
      req,
    });
    res.redirect(`/login?error=${encodeURIComponent(String(error_description || error))}`);
    return;
  }

  // Validate and consume state from database (one-time use)
  if (!state || typeof state !== 'string') {
    console.error('CAIA callback: Missing state parameter');
    await logAuditEvent({
      action: 'auth.caia_login_failed',
      details: { reason: 'missing_state_param' },
      req,
    });
    res.redirect('/login?error=Missing+state');
    return;
  }

  const oauthState = await consumeOAuthState(state);
  if (!oauthState) {
    console.error('CAIA state not found or expired:', { state });
    await logAuditEvent({
      action: 'auth.caia_login_failed',
      details: { reason: 'invalid_or_expired_state' },
      req,
    });
    res.redirect('/login?error=Invalid+or+expired+state');
    return;
  }

  const { nonce: caiaNonce, codeVerifier } = oauthState;

  try {
    const { user: userInfo } = await handleCallback(
      String(code),
      { state, nonce: caiaNonce, codeVerifier }
    );

    // Extract user identity from CAIA claims
    // Note: CAIA doesn't provide x509_subject_dn (it's a broker)
    const email = userInfo.email;
    const name = buildNameFromClaims(userInfo.givenName, userInfo.familyName, email);

    if (!email) {
      console.error('CAIA callback: No email in userInfo', userInfo);
      await logAuditEvent({
        action: 'auth.caia_login_failed',
        details: { reason: 'no_email_in_token' },
        req,
      });
      res.redirect('/login?error=No+email+in+token');
      return;
    }

    // Validate email format (SEC-01: Basic regex check for .gov/.mil addresses)
    if (!isValidEmail(email)) {
      console.error('CAIA callback: Invalid email format', { email });
      await logAuditEvent({
        action: 'auth.caia_login_failed',
        details: { reason: 'invalid_email_format', email },
        req,
      });
      res.redirect('/login?error=Invalid+email+format');
      return;
    }

    // Find existing user by email only (CAIA doesn't provide x509_subject_dn)
    let user = await findUserByEmail(email);
    if (!user) {
      // No existing user - check for pending invite matching email
      const invite = await findPendingInviteByEmail(email);

      if (!invite) {
        // No invite = no access (CAIA users must be pre-invited)
        // Use generic message to avoid revealing invite system details (Issue #349)
        console.log(`CAIA login rejected: No invite found for ${email}`);
        await logAuditEvent({
          action: 'auth.caia_login_failed',
          details: { reason: 'no_invite', email },
          req,
        });
        res.redirect('/login?error=' + encodeURIComponent('You are not an authorized user of Ship'));
        return;
      }

      // Create user from invite
      user = await createUserFromInvite(invite, email, name);

      // Log the invite acceptance
      await logAuditEvent({
        workspaceId: invite.workspace_id,
        actorUserId: user.id,
        action: 'invite.accept_caia',
        resourceType: 'invite',
        resourceId: invite.id,
        details: { email, role: invite.role },
        req,
      });
    } else {
      // Existing user - process any pending invites to other workspaces
      const pendingInvites = await findAllPendingInvitesByEmail(email);

      for (const invite of pendingInvites) {
        const { isNewMembership } = await linkUserToWorkspaceViaInvite(user, invite);

        if (isNewMembership) {
          console.log(`CAIA login: Added existing user ${email} to workspace ${invite.workspace_name} via pending invite`);

          await logAuditEvent({
            workspaceId: invite.workspace_id,
            actorUserId: user.id,
            action: 'invite.accept_caia',
            resourceType: 'invite',
            resourceId: invite.id,
            details: { email, role: invite.role, existingUser: true },
            req,
          });
        }
      }
    }

    // Update last_auth_provider to track which provider was used
    await pool.query(
      'UPDATE users SET last_auth_provider = $1, updated_at = NOW() WHERE id = $2',
      ['caia', user.id]
    );

    // Session fixation prevention: delete any existing session
    const oldSessionId = req.cookies.session_id;
    if (oldSessionId) {
      await pool.query('DELETE FROM sessions WHERE id = $1', [oldSessionId]);
    }

    // Get user's workspaces
    const workspacesResult = await pool.query(
      `SELECT w.id, w.name, wm.role
       FROM workspaces w
       JOIN workspace_memberships wm ON w.id = wm.workspace_id
       WHERE wm.user_id = $1 AND w.archived_at IS NULL
       ORDER BY w.name`,
      [user.id]
    );

    const workspaces = workspacesResult.rows;
    let workspaceId = user.last_workspace_id;

    // Validate workspace access
    if (workspaceId && !workspaces.some((w: { id: string }) => w.id === workspaceId)) {
      workspaceId = null;
    }
    if (!workspaceId && workspaces.length > 0) {
      workspaceId = workspaces[0].id;
    }

    // Super-admins can log in without workspace membership
    if (!workspaceId && !user.is_super_admin && workspaces.length === 0) {
      console.log(`CAIA user ${email} has no workspace access`);
      await logAuditEvent({
        actorUserId: user.id,
        action: 'auth.caia_login_failed',
        details: { reason: 'no_workspace_access', email },
        req,
      });
      res.redirect('/login?error=' + encodeURIComponent('You are not authorized to access this application. Please contact an administrator to request access.'));
      return;
    }

    // Create new session
    const sessionId = generateSecureSessionId();
    const expiresAt = new Date(Date.now() + SESSION_TIMEOUT_MS);

    await pool.query(
      `INSERT INTO sessions (id, user_id, workspace_id, expires_at, last_activity, user_agent, ip_address)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        sessionId,
        user.id,
        workspaceId,
        expiresAt,
        new Date(),
        req.headers['user-agent'] || 'unknown',
        req.ip || req.socket.remoteAddress || 'unknown',
      ]
    );

    // Update last workspace preference
    if (workspaceId) {
      await pool.query(
        'UPDATE users SET last_workspace_id = $1, updated_at = NOW() WHERE id = $2',
        [workspaceId, user.id]
      );
    }

    // Log audit event
    await logAuditEvent({
      workspaceId: workspaceId || undefined,
      actorUserId: user.id,
      action: 'auth.caia_login',
      details: { csp: userInfo.csp },
      req,
    });

    // Set session cookie (always secure - OAuth flow requires HTTPS anyway)
    res.cookie('session_id', sessionId, sessionCookieOptions({ secure: true }));

    // Get returnTo from query param (preserved through OAuth flow)
    const redirectUrl = safeRelativeReturnTo(req.query.returnTo) ?? '/';

    // Redirect to app (OAuth state was already consumed from database above)
    res.redirect(redirectUrl);

  } catch (error) {
    console.error('CAIA callback error:', error);

    // Extract specific error message for user feedback
    let errorMessage = 'Authentication failed';
    const caiaError = error as { message?: string };
    const errorCode = 'callback_error';

    if (caiaError.message) {
      errorMessage = caiaError.message;
    }

    await logAuditEvent({
      action: 'auth.caia_login_failed',
      details: { reason: 'callback_error', errorCode, errorMessage },
      req,
    });

    res.redirect(`/login?error=${encodeURIComponent(errorMessage)}`);
  }
});

/**
 * Build a human-readable name from CAIA claims
 * Falls back to email prefix if names not available
 */
function buildNameFromClaims(givenName?: string, familyName?: string, email?: string): string {
  if (givenName && familyName) {
    return `${givenName} ${familyName}`;
  }
  if (givenName) {
    return givenName;
  }
  if (familyName) {
    return familyName;
  }
  // Fall back to email prefix
  if (email) {
    const prefix = email.split('@')[0] || 'Unknown';
    // Try to format "firstname.lastname" -> "Firstname Lastname"
    if (prefix.includes('.')) {
      return prefix
        .split('.')
        .map(part => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
        .join(' ');
    }
    return prefix;
  }
  return 'Unknown';
}

/**
 * Find user by email (case-insensitive)
 *
 * Note: CAIA doesn't provide x509_subject_dn, so we can only match by email.
 * This is different from FPKI which can match by either email OR subject DN.
 */
async function findUserByEmail(email: string): Promise<{
  id: string;
  email: string;
  name: string;
  is_super_admin: boolean;
  last_workspace_id: string | null;
} | null> {
  const result = await pool.query(
    `SELECT u.id, u.email, u.name, u.is_super_admin, u.last_workspace_id,
            EXISTS(SELECT 1 FROM workspace_memberships wm WHERE wm.user_id = u.id) as has_membership
     FROM users u
     WHERE LOWER(u.email) = LOWER($1)
     ORDER BY has_membership DESC, u.is_super_admin DESC, u.created_at ASC
     LIMIT 1`,
    [email]
  );
  return result.rows[0] || null;
}

/**
 * Invite record from database
 */
interface PendingInvite {
  id: string;
  workspace_id: string;
  workspace_name: string;
  email: string | null;
  role: 'admin' | 'member';
}

/**
 * Find a pending invite matching email (returns first/most recent)
 */
async function findPendingInviteByEmail(email: string): Promise<PendingInvite | null> {
  const result = await pool.query(
    `SELECT wi.id, wi.workspace_id, w.name as workspace_name, wi.email, wi.role
     FROM workspace_invites wi
     JOIN workspaces w ON wi.workspace_id = w.id
     WHERE wi.used_at IS NULL
       AND wi.expires_at > NOW()
       AND LOWER(wi.email) = LOWER($1)
     ORDER BY wi.created_at DESC
     LIMIT 1`,
    [email]
  );
  return result.rows[0] || null;
}

/**
 * Find ALL pending invites matching email (for existing users with multiple invites)
 * Issue #349: Existing users may have pending invites to other workspaces
 */
async function findAllPendingInvitesByEmail(email: string): Promise<PendingInvite[]> {
  const result = await pool.query(
    `SELECT wi.id, wi.workspace_id, w.name as workspace_name, wi.email, wi.role
     FROM workspace_invites wi
     JOIN workspaces w ON wi.workspace_id = w.id
     WHERE wi.used_at IS NULL
       AND wi.expires_at > NOW()
       AND LOWER(wi.email) = LOWER($1)
     ORDER BY wi.created_at DESC`,
    [email]
  );
  return result.rows;
}

/**
 * Create a new user from an invite and set up workspace membership
 * Note: No x509_subject_dn for CAIA users
 */
async function createUserFromInvite(
  invite: PendingInvite,
  email: string,
  name: string
): Promise<{
  id: string;
  email: string;
  name: string;
  is_super_admin: boolean;
  last_workspace_id: string | null;
}> {
  // Create user (no password - CAIA/PIV only, no x509_subject_dn for CAIA)
  const userResult = await pool.query(
    `INSERT INTO users (email, name, password_hash, last_workspace_id, last_auth_provider)
     VALUES ($1, $2, NULL, $3, 'caia')
     RETURNING id, email, name, is_super_admin, last_workspace_id`,
    [email, name, invite.workspace_id]
  );
  const user = userResult.rows[0];

  // Use shared service for membership + person doc + invite marking
  await linkUserToWorkspaceViaInvite(user, invite);

  console.log(`Created CAIA user from invite: ${email} -> workspace ${invite.workspace_name}`);
  return user;
}

export default router;
