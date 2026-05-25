import { Request } from 'express';
import { pool } from '../db/client.js';

export interface AuditEventInput {
  workspaceId?: string | null;
  /** User ID of the actor. Optional for failed login attempts where user is unknown. */
  actorUserId?: string | null;
  impersonatingUserId?: string | null;
  action: string;
  resourceType?: string;
  resourceId?: string;
  details?: Record<string, unknown>;
  req?: Request;
}

export async function logAuditEvent(input: AuditEventInput): Promise<void> {
  const {
    workspaceId,
    actorUserId,
    impersonatingUserId,
    action,
    resourceType,
    resourceId,
    details,
    req,
  } = input;

  const ipAddress = req?.ip || req?.socket?.remoteAddress || null;
  const userAgent = req?.get('user-agent') || null;

  try {
    await pool.query(
      `INSERT INTO audit_logs (workspace_id, actor_user_id, impersonating_user_id, action, resource_type, resource_id, details, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [workspaceId || null, actorUserId || null, impersonatingUserId || null, action, resourceType || null, resourceId || null, details ? JSON.stringify(details) : null, ipAddress, userAgent]
    );
  } catch (error) {
    // Log but don't fail the request if audit logging fails
    console.error('Failed to log audit event:', error);
  }
}
