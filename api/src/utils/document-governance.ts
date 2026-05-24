/** Governance fields that must only change via governed approval/lifecycle routes. */
export const GOVERNANCE_PROPERTY_KEYS = [
  'plan_approval',
  'review_approval',
  'retro_approval',
  'review_rating',
  'public_feedback_enabled',
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

export function stripForbiddenGovernanceKeys<T extends Record<string, unknown>>(
  properties: T,
  options: { isAdmin: boolean }
): T {
  if (options.isAdmin) return properties;
  const next = { ...properties };
  for (const key of GOVERNANCE_PROPERTY_KEYS) {
    delete next[key];
  }
  return next;
}
