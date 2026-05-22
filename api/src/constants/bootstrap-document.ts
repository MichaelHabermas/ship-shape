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

export function pickBootstrapDocumentProperties(
  properties: Record<string, unknown> | null
): Record<string, unknown> | null {
  if (!properties) return null;

  const picked: Record<string, unknown> = {};
  for (const key of BOOTSTRAP_DOCUMENT_PROPERTY_KEYS) {
    if (properties[key] !== undefined) {
      picked[key] = properties[key];
    }
  }

  return Object.keys(picked).length > 0 ? picked : null;
}
