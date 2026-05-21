import type { QueryResult, QueryResultRow } from 'pg';

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

export function pgCommand(rowCount: number, command = 'UPDATE'): QueryResult<QueryResultRow> {
  return {
    command,
    rowCount,
    oid: 0,
    fields: [],
    rows: [],
  };
}
