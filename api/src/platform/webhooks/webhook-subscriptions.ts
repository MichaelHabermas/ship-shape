// Webhook subscription CRUD and scope checks for public API registration.
import type {
  PublicApiScope,
  PublicWebhookSubscription,
  PublicWebhookSubscriptionCreated,
  WebhookEventType,
} from '@ship/shared';
import type { PublicCursorPayload } from '../api/v1/pagination.js';
import {
  encryptWebhookSigningSecret,
  generateWebhookSigningSecret,
  hashWebhookSigningSecret,
} from './signature.js';
import { readScopeForWebhookEvent } from './events.js';
import {
  requireWebhookRow,
  webhookDb,
  webhookServiceDependencies,
} from './webhook-service-deps.js';

export class WebhookSubscriptionScopeError extends Error {
  constructor(readonly missingScope: PublicApiScope) {
    super(`Missing required webhook read scope: ${missingScope}`);
    this.name = 'WebhookSubscriptionScopeError';
  }
}

export function isWebhookSubscriptionScopeError(error: unknown): error is WebhookSubscriptionScopeError {
  return error instanceof WebhookSubscriptionScopeError;
}

export type WebhookReadContextSource = 'public_oauth' | 'portal_session';

export type WebhookSubscriptionReadContextSource = 'legacy' | WebhookReadContextSource;

export type WebhookSubscriptionRow = {
  id: string;
  app_id: string;
  client_id: string;
  app_is_active: boolean;
  workspace_id: string;
  event_type: WebhookEventType;
  target_url: string;
  read_subject_user_id: string | null;
  read_subject_scopes: PublicApiScope[];
  read_context_source: WebhookSubscriptionReadContextSource;
  read_context_version: number;
  signing_secret_ciphertext: string;
  signing_secret_iv: string;
  signing_secret_tag: string;
  active: boolean;
  created_at: Date;
  updated_at: Date;
};

export async function createWebhookSubscription(input: {
  appId: string;
  workspaceId: string;
  event: WebhookEventType;
  targetUrl: string;
  readSubjectUserId: string;
  readSubjectScopes: readonly PublicApiScope[];
  readContextSource: WebhookReadContextSource;
}): Promise<PublicWebhookSubscriptionCreated> {
  if (!input.readSubjectScopes.includes('webhooks:manage')) {
    throw new WebhookSubscriptionScopeError('webhooks:manage');
  }
  const requiredReadScope = readScopeForWebhookEvent(input.event);
  if (!input.readSubjectScopes.includes(requiredReadScope)) {
    throw new WebhookSubscriptionScopeError(requiredReadScope);
  }

  await webhookServiceDependencies.validateTargetUrl(input.targetUrl);
  const signingSecret = generateWebhookSigningSecret();
  const encrypted = encryptWebhookSigningSecret(signingSecret);
  const result = await webhookDb().query<WebhookSubscriptionRow>(
    `INSERT INTO webhook_subscriptions (
       app_id,
       workspace_id,
       event_type,
       target_url,
       read_subject_user_id,
       read_subject_scopes,
       read_context_source,
       read_context_version,
       signing_secret_hash,
       signing_secret_ciphertext,
       signing_secret_iv,
       signing_secret_tag
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, 1, $8, $9, $10, $11)
     RETURNING id, app_id, NULL::text AS client_id, TRUE AS app_is_active,
               workspace_id, event_type, target_url, read_subject_user_id,
               read_subject_scopes, read_context_source, read_context_version,
               signing_secret_ciphertext, signing_secret_iv, signing_secret_tag,
               active, created_at, updated_at`,
    [
      input.appId,
      input.workspaceId,
      input.event,
      input.targetUrl,
      input.readSubjectUserId,
      [...input.readSubjectScopes],
      input.readContextSource,
      hashWebhookSigningSecret(signingSecret),
      encrypted.ciphertext,
      encrypted.iv,
      encrypted.tag,
    ]
  );
  const row = requireWebhookRow(result.rows[0], 'Webhook subscription insert returned no row');
  return {
    ...publicSubscriptionFromRow(row),
    signing_secret: signingSecret,
  };
}

export async function listWebhookSubscriptions(input: {
  appId: string;
  workspaceId: string;
  limit: number;
  cursor?: PublicCursorPayload;
}): Promise<PublicWebhookSubscription[]> {
  const values: Array<string | number> = [input.appId, input.workspaceId];
  const cursorClause = input.cursor
    ? `AND (
         s.created_at < $3::timestamptz
         OR (s.created_at = $3::timestamptz AND s.id::text < $4)
       )`
    : '';
  if (input.cursor) values.push(input.cursor.timestamp, input.cursor.id);
  values.push(input.limit);
  const limitParam = values.length;

  const result = await webhookDb().query<WebhookSubscriptionRow>(
    `SELECT s.id, s.app_id, a.client_id, a.is_active AS app_is_active,
            s.workspace_id, s.event_type, s.target_url,
            s.read_subject_user_id, s.read_subject_scopes,
            s.read_context_source, s.read_context_version,
            signing_secret_ciphertext, signing_secret_iv, signing_secret_tag,
            s.active, s.created_at, s.updated_at
       FROM webhook_subscriptions s
       JOIN oauth_apps a ON a.id = s.app_id AND a.workspace_id = s.workspace_id
      WHERE s.app_id = $1
        AND s.workspace_id = $2
        ${cursorClause}
      ORDER BY s.created_at DESC, s.id::text DESC
      LIMIT $${limitParam}`,
    values
  );
  return result.rows.map(publicSubscriptionFromRow);
}

export function publicSubscriptionFromRow(row: WebhookSubscriptionRow): PublicWebhookSubscription {
  return {
    id: row.id,
    event: row.event_type,
    target_url: row.target_url,
    active: row.active,
    created_at: row.created_at.toISOString(),
  };
}
