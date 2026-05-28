// Realtime WebSocket event payloads shared between API broadcast and web subscribers.

import type { IssueState } from '../enums/document-enums.js';

/** Payload for `accountability:updated` events on the global events socket. */
export type AccountabilityUpdatedPayload =
  | { type: 'week_issues'; targetId: string }
  | { type: 'standup'; targetId: string }
  | { type: 'weekly_review'; targetId: string }
  | { type: 'week_start'; targetId: string }
  | { type: 'weekly_plan'; targetId: string }
  | { type: 'project_plan'; targetId: string }
  | { type: 'project_retro'; targetId: string }
  | { type: string; targetId: string }
  | { documentId: string; documentType: string }
  | { issueId: string; state: IssueState };

export type RealtimeEventType = 'accountability:updated' | 'connected' | 'pong';

export type RealtimeEvent =
  | { type: 'connected'; data: Record<string, never> }
  | { type: 'pong'; data: Record<string, never> }
  | { type: 'accountability:updated'; data: AccountabilityUpdatedPayload };
