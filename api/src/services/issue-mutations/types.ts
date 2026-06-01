import type { PoolClient } from 'pg';
import type { IssueProperties } from '@ship/shared';
import type { Principal } from '../../security/principal.js';
import type { DocumentActor } from '../document-access.js';
import {
  type createIssueRequestSchema,
  type updateIssueRequestSchema,
} from '../../schemas/document-boundary.js';
import type { z } from 'zod';

export type IssueMutationResult<T> =
  | { ok: true; status: number; body: T }
  | { ok: false; status: number; body: Record<string, unknown> };

export type TicketNumberRow = { next_number: number };
export type CountRow = { count: string | number };
export type IssueTitlePropertiesRow = {
  id: string;
  title: string;
  properties: IssueProperties | Record<string, unknown> | null;
};
export type IssuePropertiesRow = {
  id: string;
  properties: IssueProperties | Record<string, unknown> | null;
};
export type IncompleteChildRow = {
  id: string;
  title: string;
  ticket_number: number | null;
  state: string | null;
};
export type OldSprintRow = {
  sprint_number: string | null;
  sprint_start_date: Date | string | null;
};

export type CreateIssueInput = {
  client: PoolClient;
  actor: DocumentActor;
  principal: Principal;
  userId: string;
  workspaceId: string;
  data: z.infer<typeof createIssueRequestSchema>;
};

export type UpdateIssueInput = {
  client: PoolClient;
  actor: DocumentActor;
  principal: Principal;
  userId: string;
  workspaceId: string;
  issueId: string;
  data: z.infer<typeof updateIssueRequestSchema>;
};

export function toCount(value: string | number): number {
  return typeof value === 'number' ? value : Number(value);
}

export async function workspaceAdvisoryLock(client: PoolClient, workspaceId: string): Promise<void> {
  const workspaceIdHex = workspaceId.replace(/-/g, '').substring(0, 15);
  const lockKey = parseInt(workspaceIdHex, 16);
  await client.query('SELECT pg_advisory_xact_lock($1)', [lockKey]);
}
