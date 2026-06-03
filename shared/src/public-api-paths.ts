// Relative /api/v1 path suffixes shared by API registry, SDK, and OpenAPI.
export const PUBLIC_API_V1_BASE = '/api/v1';

export const PUBLIC_API_RELATIVE_PATHS = {
  openapi: '/openapi.json',
  me: '/me',
  fleetgraphAttentionContexts: '/fleetgraph/attention-contexts',
  documents: '/documents',
  document: '/documents/:id',
  issues: '/issues',
  issue: '/issues/:id',
  sprints: '/sprints',
  sprint: '/sprints/:id',
  sprintIssues: '/sprints/:id/issues',
  webhooks: '/webhooks',
  webhookDeliveries: '/webhooks/deliveries',
  webhookDeliveryReplay: '/webhooks/deliveries/:id/replay',
} as const;
