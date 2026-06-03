// Webhook event enqueue and read-context capability fanout to subscriptions.
import type { DocumentType, WebhookEvent, WebhookEventType } from '@ship/shared';
import { requireWorkspaceMembership } from '../../services/document-access.js';
import { authorize } from '../../security/capabilities.js';
import type { Principal } from '../../security/principal.js';
import {
  expectedDocumentTypeForWebhookEvent,
  parseWebhookEvent,
  readScopeForWebhookEvent,
} from './events.js';
import { createDeliveryAttempt } from './webhook-delivery.js';
import type { WebhookSubscriptionRow } from './webhook-subscriptions.js';
import {
  type QueryRunner,
  requireWebhookRow,
  webhookDb,
} from './webhook-service-deps.js';

export type WebhookEventRow = {
  id: string;
  workspace_id: string;
  event_type: WebhookEventType;
  idempotency_key: string;
  payload: Record<string, unknown>;
  resource_kind: 'document' | null;
  resource_id: string | null;
  resource_document_type: DocumentType | null;
  created_at: Date;
};

export async function enqueueWebhookEvent(
  event: WebhookEvent,
  db: QueryRunner = webhookDb()
): Promise<{ eventId: string; deliveryIds: string[] }> {
  const parsed = parseWebhookEvent(event);
  const eventResult = await db.query<WebhookEventRow>(
    `INSERT INTO webhook_events (
       workspace_id,
       event_type,
       idempotency_key,
       payload,
       resource_kind,
       resource_id,
       resource_document_type
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (idempotency_key) DO NOTHING
     RETURNING id, workspace_id, event_type, idempotency_key, payload,
               resource_kind, resource_id, resource_document_type, created_at`,
    [
      parsed.workspace_id,
      parsed.type,
      parsed.idempotency_key,
      parsed.payload,
      parsed.resource.kind,
      parsed.resource.id,
      parsed.resource.document_type,
    ]
  );
  const eventRow = eventResult.rows[0];
  if (!eventRow) {
    const existing = await db.query<{ id: string }>(
      'SELECT id FROM webhook_events WHERE idempotency_key = $1',
      [parsed.idempotency_key]
    );
    return {
      eventId: requireWebhookRow(existing.rows[0], 'Webhook event conflict row not found').id,
      deliveryIds: [],
    };
  }

  const subscriptions = await db.query<WebhookSubscriptionRow>(
    `SELECT s.id, s.app_id, a.client_id, a.is_active AS app_is_active,
            s.workspace_id, s.event_type, s.target_url,
            s.read_subject_user_id, s.read_subject_scopes,
            s.read_context_source, s.read_context_version,
            s.signing_secret_ciphertext, s.signing_secret_iv, s.signing_secret_tag,
            s.active, s.created_at, s.updated_at
       FROM webhook_subscriptions s
       JOIN oauth_apps a ON a.id = s.app_id AND a.workspace_id = s.workspace_id
      WHERE s.workspace_id = $1
        AND s.event_type = $2
        AND s.active = TRUE`,
    [eventRow.workspace_id, eventRow.event_type]
  );

  const deliveryIds: string[] = [];
  for (const subscription of subscriptions.rows) {
    if (!(await shouldEnqueueWebhookForSubscription({
      db,
      event: eventRow,
      subscription,
    }))) {
      continue;
    }
    const delivery = await createDeliveryAttempt({
      subscriptionId: subscription.id,
      eventId: eventRow.id,
      workspaceId: eventRow.workspace_id,
      attemptNumber: 1,
      idempotencyKey: eventRow.idempotency_key,
      status: 'pending',
      nextAttemptAt: null,
      replayOfDeliveryId: null,
    }, db);
    if (delivery) deliveryIds.push(delivery.id);
  }

  return { eventId: eventRow.id, deliveryIds };
}

async function shouldEnqueueWebhookForSubscription(input: {
  db: QueryRunner;
  event: WebhookEventRow;
  subscription: WebhookSubscriptionRow;
}): Promise<boolean> {
  if (!input.subscription.app_is_active) return false;
  if (
    input.event.resource_kind !== 'document' ||
    !input.event.resource_id ||
    !input.event.resource_document_type ||
    !input.subscription.read_subject_user_id
  ) {
    return false;
  }

  const requiredScope = readScopeForWebhookEvent(input.event.event_type);
  if (!input.subscription.read_subject_scopes.includes(requiredScope)) return false;

  const actor = {
    userId: input.subscription.read_subject_user_id,
    workspaceId: input.event.workspace_id,
    isSuperAdmin: false,
  };
  if (!(await requireWorkspaceMembership(actor, input.db))) return false;

  const principal = webhookSubscriptionPrincipal(input.subscription, input.event.workspace_id);
  const expectedType = expectedDocumentTypeForWebhookEvent(
    input.event.event_type,
    input.event.resource_document_type
  );
  const decision = await authorize(input.db, principal, {
    resource: 'document',
    action: 'read',
    documentId: input.event.resource_id,
    expectedType,
    includeDeleted: input.event.event_type === 'document.deleted',
  });
  return decision.allowed;
}

function webhookSubscriptionPrincipal(
  subscription: WebhookSubscriptionRow,
  workspaceId: string
): Principal {
  const userId = subscription.read_subject_user_id;
  if (!userId) throw new Error('Webhook subscription subject missing');
  return {
    kind: 'oauth_access_token',
    tokenId: `webhook_subscription:${subscription.id}`,
    appId: subscription.app_id,
    clientId: subscription.client_id,
    userId,
    workspaceId,
    isSuperAdmin: false,
    scopes: subscription.read_subject_scopes,
  };
}
