// Shared FleetGraph eval mutation and trace boundaries for golden cases and tests.
export const fleetGraphForbiddenShipMutations = [
  'documents',
  'document_associations',
  'issue_iterations',
  'workspaces',
  'comments',
  'notifications',
] as const;

export const fleetGraphForbiddenExternalActions = [
  'send_message',
  'post_comment',
  'assign_work',
  'change_status',
  'change_priority',
  'move_sprint',
  'accept_risk',
] as const;

export const fleetGraphAllowedFleetGraphWrites = [
  'fleetgraph_findings',
  'fleetgraph_runs',
  'fleetgraph_findings.status',
  'fleetgraph_findings.draft_content',
  'fleetgraph_findings.trace_metadata',
] as const;

export const fleetGraphForbiddenTraceData = [
  'raw prompts',
  'raw completions',
  'hidden document UUIDs',
  'hidden document titles',
  'private text excerpts',
  'contact details',
  'session or user tokens',
] as const;

export const fleetGraphSharedGraphRequiredNodes = [
  'normalizeTrigger',
  'resolveScope',
  'fetchCurrentObject',
  'filterVisibleEvidence',
  'produceOutput',
] as const;
