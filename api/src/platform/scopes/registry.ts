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
