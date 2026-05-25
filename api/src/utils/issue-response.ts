import type { BelongsTo, IssueProperties } from '@ship/shared';
import type { IssueMetadataRow } from '../db/documents-repository.js';

export type IssueListRow = IssueMetadataRow;

export function mapIssueListItem(row: IssueMetadataRow, belongsTo: BelongsTo[] = []) {
  const props: Partial<IssueProperties> = (row.properties ?? {});
  return {
    id: row.id,
    title: row.title,
    state: props.state || 'backlog',
    priority: props.priority || 'medium',
    source: props.source || 'internal',
    updated_at: row.updated_at,
    ...(props.estimate !== undefined && props.estimate !== null ? { estimate: props.estimate } : {}),
    ...(row.assignee_name ? { assignee_name: row.assignee_name } : {}),
    ...(props.assignee_id ? { assignee_id: props.assignee_id } : {}),
    ...(row.ticket_number !== null ? { ticket_number: row.ticket_number, display_id: `#${row.ticket_number}` } : {}),
    ...(row.assignee_archived ? { assignee_archived: true } : {}),
    ...(props.rejection_reason ? { rejection_reason: props.rejection_reason } : {}),
    ...(props.due_date ? { due_date: props.due_date } : {}),
    ...(props.is_system_generated ? { is_system_generated: true } : {}),
    ...(props.accountability_target_id ? { accountability_target_id: props.accountability_target_id } : {}),
    ...(props.accountability_type ? { accountability_type: props.accountability_type } : {}),
    ...(row.started_at ? { started_at: row.started_at } : {}),
    ...(row.completed_at ? { completed_at: row.completed_at } : {}),
    ...(row.cancelled_at ? { cancelled_at: row.cancelled_at } : {}),
    ...(row.reopened_at ? { reopened_at: row.reopened_at } : {}),
    ...(row.converted_from_id ? { converted_from_id: row.converted_from_id } : {}),
    ...(belongsTo.length > 0 ? { belongs_to: belongsTo } : {}),
  };
}

export type IssueActionItemRow = {
  id: string;
  title: string;
  state: string | null;
  priority: string | null;
  ticket_number: number | null;
  due_date: string | null;
  is_system_generated: boolean | null;
  accountability_type: string | null;
  accountability_target_id: string | null;
  target_title: string | null;
};

export function mapIssueActionItemRow(row: IssueActionItemRow, today: Date) {
  let daysOverdue = 0;
  if (row.due_date) {
    const dueDate = new Date(row.due_date + 'T00:00:00');
    const diffTime = today.getTime() - dueDate.getTime();
    daysOverdue = Math.floor(diffTime / (1000 * 60 * 60 * 24));
  }

  return {
    id: row.id,
    title: row.title,
    state: row.state || 'backlog',
    priority: row.priority || 'medium',
    ticket_number: row.ticket_number,
    display_id: `#${row.ticket_number}`,
    due_date: row.due_date,
    is_system_generated: row.is_system_generated ?? false,
    accountability_type: row.accountability_type,
    accountability_target_id: row.accountability_target_id,
    target_title: row.target_title,
    days_overdue: daysOverdue,
  };
}

export type IssueHistoryRow = {
  id: string;
  field: string;
  old_value: string | null;
  new_value: string | null;
  created_at: Date;
  automated_by: string | null;
  changed_by_id: string | null;
  changed_by_name: string | null;
};

export function mapIssueHistoryRow(row: IssueHistoryRow) {
  return {
    id: row.id,
    field: row.field,
    old_value: row.old_value,
    new_value: row.new_value,
    created_at: row.created_at,
    changed_by: row.changed_by_id ? {
      id: row.changed_by_id,
      name: row.changed_by_name,
    } : null,
    automated_by: row.automated_by,
  };
}

export type IssueIterationAuthorRow = {
  id: string;
  name: string;
  email: string;
};

export type IssueStoredIterationRow = {
  id: string;
  issue_id: string;
  status: string;
  what_attempted: string | null;
  blockers_encountered: string | null;
  author_id: string;
  created_at: Date;
  updated_at: Date;
};

export function mapStoredIssueIterationRow(
  iteration: IssueStoredIterationRow,
  author: IssueIterationAuthorRow
) {
  return {
    id: iteration.id,
    issue_id: iteration.issue_id,
    status: iteration.status,
    what_attempted: iteration.what_attempted,
    blockers_encountered: iteration.blockers_encountered,
    author: {
      id: author.id,
      name: author.name,
      email: author.email,
    },
    created_at: iteration.created_at,
    updated_at: iteration.updated_at,
  };
}

export type IssueIterationListRow = {
  id: string;
  issue_id: string;
  status: string;
  what_attempted: string | null;
  blockers_encountered: string | null;
  author_id: string;
  created_at: Date;
  updated_at: Date;
  author_name: string;
  author_email: string;
};

export function mapListedIssueIterationRow(row: IssueIterationListRow) {
  return {
    id: row.id,
    issue_id: row.issue_id,
    status: row.status,
    what_attempted: row.what_attempted,
    blockers_encountered: row.blockers_encountered,
    author: {
      id: row.author_id,
      name: row.author_name,
      email: row.author_email,
    },
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}
