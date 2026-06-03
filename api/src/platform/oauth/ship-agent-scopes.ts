// Canonical read scopes for the first-party Ship Agent OAuth app and delegated tokens.
import type { PublicApiScope } from '@ship/shared';

export const SHIP_AGENT_READ_SCOPES = [
  'documents:read',
  'issues:read',
  'sprints:read',
] as const satisfies readonly PublicApiScope[];

export type ShipAgentReadScope = (typeof SHIP_AGENT_READ_SCOPES)[number];
