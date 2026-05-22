import type { IssueProperties } from '@ship/shared';
import type { IssueMetadataRow } from '../db/documents-repository.js';
import type { BelongsToEntry } from './document-crud.js';

export type IssueListRow = IssueMetadataRow;

export function mapIssueListItem(row: IssueMetadataRow, belongsTo: BelongsToEntry[] = []) {
  const props: Partial<IssueProperties> = (row.properties ?? {}) as Partial<IssueProperties>;
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
