// Document webhook helpers build public event payloads from document rows.
import type { WebhookEvent, WebhookEventResource } from '@ship/shared';
import type { DocumentAccessRow } from './types.js';
import {
  documentCoreFromRow,
  documentWebhookResourceFromCore,
} from './document-core.js';

type DocumentWebhookInput = {
  workspaceId: string;
  actorUserId: string;
  row: DocumentAccessRow;
};

export function buildDocumentCreatedWebhookEvent(input: DocumentWebhookInput): WebhookEvent {
  return {
    type: 'document.created',
    workspace_id: input.workspaceId,
    idempotency_key: `document.created:${input.row.id}`,
    resource: documentWebhookResourceMetadata(input.row),
    payload: {
      document: documentWebhookResource(input.row),
      actor: { id: input.actorUserId },
    },
  };
}

function documentWebhookResource(row: DocumentAccessRow) {
  return documentWebhookResourceFromCore(documentCoreFromRow(row));
}

function documentWebhookResourceMetadata(row: DocumentAccessRow): WebhookEventResource {
  return {
    kind: 'document',
    id: row.id,
    document_type: row.document_type,
  };
}
