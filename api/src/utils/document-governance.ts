/** Governance fields that must only change via governed approval/lifecycle routes. */
export const GOVERNANCE_PROPERTY_KEYS = [
  'plan_approval',
  'review_approval',
  'retro_approval',
  'review_rating',
  'public_feedback_enabled',
  'submitted_at',
] as const;

/** RACI fields that must only be changed by workspace admins on generic document PATCH. */
export const RACI_PROPERTY_KEYS = [
  'accountable_id',
  'owner_id',
  'consulted_ids',
  'informed_ids',
] as const;

export type GovernancePropertyKey = (typeof GOVERNANCE_PROPERTY_KEYS)[number];
export type RaciPropertyKey = (typeof RACI_PROPERTY_KEYS)[number];

export function findForbiddenGovernanceKeys(
  properties: Record<string, unknown> | undefined
): GovernancePropertyKey[] {
  if (!properties) return [];
  return GOVERNANCE_PROPERTY_KEYS.filter((key) =>
    Object.prototype.hasOwnProperty.call(properties, key)
  );
}

export function findForbiddenRaciKeys(
  properties: Record<string, unknown> | undefined
): RaciPropertyKey[] {
  if (!properties) return [];
  return RACI_PROPERTY_KEYS.filter((key) =>
    Object.prototype.hasOwnProperty.call(properties, key)
  );
}

export function formatForbiddenGovernanceKeys(keys: readonly string[]): string {
  return keys.join(', ');
}

/** Strip governance keys from merged properties (defense in depth after explicit rejection). */
export function stripForbiddenGovernanceKeys<T extends Record<string, unknown>>(properties: T): T {
  const next = { ...properties };
  for (const key of GOVERNANCE_PROPERTY_KEYS) {
    delete next[key];
  }
  return next;
}

const WEEKLY_ACCOUNTABILITY_TYPES = new Set(['weekly_plan', 'weekly_retro']);

/** Set submitted_at on first content save for weekly accountability docs (server-only). */
export function stampWeeklyAccountabilitySubmittedAt(
  documentType: string | undefined,
  properties: Record<string, unknown>,
  contentChanged: boolean
): Record<string, unknown> {
  if (!contentChanged || !documentType || !WEEKLY_ACCOUNTABILITY_TYPES.has(documentType)) {
    return properties;
  }
  if (properties.submitted_at != null && properties.submitted_at !== undefined) {
    return properties;
  }
  return { ...properties, submitted_at: new Date().toISOString() };
}
