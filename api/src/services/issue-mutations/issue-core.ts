// Issue core mapper extracts shared document-row fields for public, session, and webhook adapters.
import {
  ISSUE_SOURCE_VALUES,
  asIssuePriority,
  asIssueState,
  type IssuePriority,
  type IssueSource,
  type IssueState,
} from '@ship/shared';
import { z } from 'zod';

export type IssuePropertiesRow = Record<string, unknown> | null;

export type IssueCoreSourceRow = {
  id: string;
  title: string;
  ticket_number: number | null;
  properties: IssuePropertiesRow;
};

export type IssueCoreFields = {
  id: string;
  title: string;
  ticket_number: number | null;
  display_id: string;
  state: IssueState;
  priority: IssuePriority;
  assignee_id: string | null;
  source: IssueSource;
  estimate?: number;
  due_date?: string;
  is_system_generated?: boolean;
  accountability_target_id?: string | null;
  accountability_type?: string | null;
  rejection_reason?: string | null;
};

export function issueDisplayId(ticketNumber: number | null): string {
  return ticketNumber === null ? '' : `#${ticketNumber}`;
}

export function issueCoreFromDocumentRow(row: IssueCoreSourceRow): IssueCoreFields {
  const props = row.properties ?? {};
  const state = asIssueState(props.state);
  const priority = asIssuePriority(props.priority);
  const assigneeId = uuidOrNull(props.assignee_id);
  const source = asIssueSource(props.source);

  const core: IssueCoreFields = {
    id: row.id,
    title: row.title,
    ticket_number: row.ticket_number,
    display_id: issueDisplayId(row.ticket_number),
    state,
    priority,
    assignee_id: assigneeId,
    source,
  };

  if (typeof props.estimate === 'number') core.estimate = props.estimate;
  if (typeof props.due_date === 'string') core.due_date = props.due_date;
  if (typeof props.is_system_generated === 'boolean') core.is_system_generated = props.is_system_generated;
  const accountabilityTargetId = uuidOrNull(props.accountability_target_id);
  if (accountabilityTargetId) {
    core.accountability_target_id = accountabilityTargetId;
  }
  if (typeof props.accountability_type === 'string') core.accountability_type = props.accountability_type;
  if (typeof props.rejection_reason === 'string') core.rejection_reason = props.rejection_reason;

  return core;
}

function uuidOrNull(value: unknown): string | null {
  const parsed = z.string().uuid().safeParse(value);
  return parsed.success ? parsed.data : null;
}

function asIssueSource(value: unknown): IssueSource {
  if (typeof value === 'string' && (ISSUE_SOURCE_VALUES as readonly string[]).includes(value)) {
    return value as IssueSource;
  }
  return 'internal';
}

export function webhookIssueResourceFromCore(core: IssueCoreFields) {
  return {
    id: core.id,
    title: core.title,
    display_id: core.display_id,
    ticket_number: core.ticket_number,
    state: core.state,
    assignee_id: core.assignee_id,
    api_url: `/api/v1/issues/${core.id}`,
    ui_url: `/documents/${core.id}`,
  };
}
