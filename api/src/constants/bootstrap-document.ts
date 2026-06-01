/** Allowlisted document.properties keys returned by /api/bootstrap list hydration. */
export const BOOTSTRAP_DOCUMENT_PROPERTY_KEYS = [
  'state',
  'priority',
  'estimate',
  'assignee_id',
  'source',
  'prefix',
  'color',
] as const;

export type BootstrapDocumentPropertyKey = (typeof BOOTSTRAP_DOCUMENT_PROPERTY_KEYS)[number];

export { pickBootstrapDocumentProperties } from '../utils/document-properties.js';
