import { pool } from '../db/client.js';
import { SESSION_TIMEOUT_MS, ABSOLUTE_SESSION_TIMEOUT_MS } from '@ship/shared';
import { evaluateSessionBinding, type SessionBindingDecision } from '../security/session-binding.js';

export type SessionValidationFailure =
  | 'invalid'
  | 'absolute_timeout'
  | 'inactivity_timeout'
  | 'membership_revoked'
  | 'binding_mismatch';

export interface ValidatedSession {
  sessionId: string;
  userId: string;
  workspaceId: string | null;
  isSuperAdmin: boolean;
}

export type SessionValidationResult =
  | { ok: true; session: ValidatedSession; activityUpdated: boolean; bindingDecision?: SessionBindingDecision }
  | { ok: false; reason: SessionValidationFailure };

const COOKIE_REFRESH_THRESHOLD_MS = 60 * 1000;

interface SessionRow {
  id: string;
  user_id: string;
  workspace_id: string | null;
  last_activity: Date;
  created_at: Date;
  is_super_admin: boolean;
  user_agent: string | null;
  ip_address: string | null;
}

/**
 * Shared session validation for HTTP middleware and WebSocket upgrade paths.
 * Enforces timeouts and workspace membership revocation (fail-closed).
 */
export async function validateAuthenticatedSession(
  sessionId: string,
  options: { updateActivity?: boolean; userAgent?: string | null; ipAddress?: string | null } = {}
): Promise<SessionValidationResult> {
  const { updateActivity = false, userAgent = null, ipAddress = null } = options;

  try {
    const result = await pool.query<SessionRow>(
      `SELECT s.id, s.user_id, s.workspace_id, s.last_activity, s.created_at,
              s.user_agent, s.ip_address,
              u.is_super_admin
       FROM sessions s
       JOIN users u ON s.user_id = u.id
       WHERE s.id = $1`,
      [sessionId]
    );

    const session = result.rows[0];
    if (!session) {
      return { ok: false, reason: 'invalid' };
    }

    const now = new Date();
    const lastActivity = new Date(session.last_activity);
    const createdAt = new Date(session.created_at);
    const inactivityMs = now.getTime() - lastActivity.getTime();
    const sessionAgeMs = now.getTime() - createdAt.getTime();

    if (sessionAgeMs > ABSOLUTE_SESSION_TIMEOUT_MS) {
      await pool.query('DELETE FROM sessions WHERE id = $1', [sessionId]);
      return { ok: false, reason: 'absolute_timeout' };
    }

    if (inactivityMs > SESSION_TIMEOUT_MS) {
      await pool.query('DELETE FROM sessions WHERE id = $1', [sessionId]);
      return { ok: false, reason: 'inactivity_timeout' };
    }

    if (session.workspace_id && !session.is_super_admin) {
      const membershipResult = await pool.query(
        'SELECT id FROM workspace_memberships WHERE workspace_id = $1 AND user_id = $2',
        [session.workspace_id, session.user_id]
      );

      if (!membershipResult.rows[0]) {
        await pool.query('DELETE FROM sessions WHERE id = $1', [sessionId]);
        return { ok: false, reason: 'membership_revoked' };
      }
    }

    const bindingDecision = evaluateSessionBinding({
      storedUserAgent: session.user_agent,
      currentUserAgent: userAgent,
      storedIpAddress: session.ip_address,
      currentIpAddress: ipAddress,
    });
    if (bindingDecision.level === 'deny') {
      await pool.query('DELETE FROM sessions WHERE id = $1', [sessionId]);
      return { ok: false, reason: 'binding_mismatch' };
    }
    if (bindingDecision.reasons.includes('missing_stored_binding') && (userAgent || ipAddress)) {
      await pool.query(
        `UPDATE sessions
         SET user_agent = COALESCE(user_agent, $1),
             ip_address = COALESCE(ip_address, $2)
         WHERE id = $3`,
        [userAgent, ipAddress, sessionId]
      );
    }

    let activityUpdated = false;
    if (updateActivity && inactivityMs > COOKIE_REFRESH_THRESHOLD_MS) {
      await pool.query('UPDATE sessions SET last_activity = $1 WHERE id = $2', [now, sessionId]);
      activityUpdated = true;
    }

    return {
      ok: true,
      activityUpdated,
      bindingDecision,
      session: {
        sessionId: session.id,
        userId: session.user_id,
        workspaceId: session.workspace_id,
        isSuperAdmin: session.is_super_admin,
      },
    };
  } catch (error) {
    console.error('Session validation error:', error);
    throw error;
  }
}
