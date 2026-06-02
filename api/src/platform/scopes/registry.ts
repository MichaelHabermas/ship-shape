// Canonical initial scope names. This list is data, not middleware logic; add
// future scopes here only when a real public surface needs them.
export const PUBLIC_API_SCOPES = [
  'documents:read',
  'documents:write',
  'issues:read',
  'issues:write',
  'sprints:read',
  'sprints:write',
  'webhooks:manage',
] as const;

export type PublicApiScope = (typeof PUBLIC_API_SCOPES)[number];
