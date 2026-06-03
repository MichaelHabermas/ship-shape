// Document core mapper extracts shared row fields for public API and webhook adapters.
import type { DocumentType } from '@ship/shared';

export type DocumentCoreSourceRow = {
  id: string;
  title: string;
  document_type: DocumentType;
};

export type DocumentCoreFields = {
  id: string;
  title: string;
  document_type: DocumentType;
};

export function documentCoreFromRow(row: DocumentCoreSourceRow): DocumentCoreFields {
  return {
    id: row.id,
    title: row.title,
    document_type: row.document_type,
  };
}

export function documentWebhookResourceFromCore(core: DocumentCoreFields) {
  return {
    id: core.id,
    title: core.title,
    document_type: core.document_type,
    api_url: `/api/v1/documents/${core.id}`,
    ui_url: `/documents/${core.id}`,
  };
}
