import type { QueryResult, QueryResultRow } from 'pg';

export type DocumentContentRow = {
  id: string;
  content: Record<string, unknown> | null;
  yjs_state: Buffer | null;
};

export type DocumentStateRow = {
  content: Record<string, unknown> | null;
  yjs_state: Buffer | null;
};

export type ContentRow = {
  content: Record<string, unknown> | null;
};

export type RelationshipTypeRow = {
  relationship_type: string;
};

export type CountRow = {
  count: string;
};

export type PropertiesRow = {
  properties: Record<string, unknown>;
};

export type RelatedIdRow = {
  related_id: string;
};

export type SprintStartDateRow = {
  sprint_start_date: string;
};

export type MaxTicketRow = {
  max_ticket: number | null;
};

export type IdRow = { id: string };

export { requireFirstRow } from '../utils/query-rows.js';

export function pgResult<T extends QueryResultRow>(
  rows: T[],
  rowCount: number | null = rows.length
): QueryResult<T> {
  return {
    command: 'SELECT',
    rowCount,
    oid: 0,
    fields: [],
    rows,
  };
}

/** @deprecated Use pgResult */
export const pgRows = pgResult;

export function pgCommand(rowCount: number, command = 'UPDATE'): QueryResult<QueryResultRow> {
  return {
    command,
    rowCount,
    oid: 0,
    fields: [],
    rows: [],
  };
}
