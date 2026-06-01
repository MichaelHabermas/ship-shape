// Read-only JSONB property accessors for document API responses.
import type {
  ApprovalTracking,
  IssueProperties,
  ProgramProperties,
  ProjectProperties,
  WeekProperties,
} from '@ship/shared';
import {
  BOOTSTRAP_DOCUMENT_PROPERTY_KEYS,
  type BootstrapDocumentPropertyKey,
} from '../constants/bootstrap-document.js';

type JsonRecord = Record<string, unknown>;

function asRecord(raw: unknown): JsonRecord {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {};
  }
  return raw as JsonRecord;
}

function readString(props: JsonRecord, key: string): string | undefined {
  const value = props[key];
  return typeof value === 'string' ? value : undefined;
}

function readNullableString(props: JsonRecord, key: string): string | null | undefined {
  const value = props[key];
  if (value === null) return null;
  return typeof value === 'string' ? value : undefined;
}

function readNumber(props: JsonRecord, key: string): number | undefined {
  const value = props[key];
  return typeof value === 'number' ? value : undefined;
}

function readNullableNumber(props: JsonRecord, key: string): number | null | undefined {
  const value = props[key];
  if (value === null) return null;
  return typeof value === 'number' ? value : undefined;
}

function readStringArray(props: JsonRecord, key: string): string[] {
  const value = props[key];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

function readApprovalTracking(value: unknown): ApprovalTracking | null | undefined {
  if (value === null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as JsonRecord;
  const state = record.state;
  if (state !== null && state !== 'approved' && state !== 'changed_since_approved' && state !== 'changes_requested') {
    return undefined;
  }
  return {
    state: state,
    approved_by: readNullableString(record, 'approved_by') ?? null,
    approved_at: readNullableString(record, 'approved_at') ?? null,
    approved_version_id:
      typeof record.approved_version_id === 'number' ? record.approved_version_id : null,
    feedback: readNullableString(record, 'feedback') ?? null,
    comment: readNullableString(record, 'comment') ?? null,
  };
}

export type DocumentListFlattenedFields = {
  state?: IssueProperties['state'];
  priority?: IssueProperties['priority'];
  estimate?: number;
  assignee_id?: string;
  source?: IssueProperties['source'];
  prefix?: string;
  color?: string;
};

export function readIssueListFields(raw: unknown): DocumentListFlattenedFields {
  const props = asRecord(raw);
  const fields: DocumentListFlattenedFields = {};
  const state = readString(props, 'state');
  if (state) fields.state = state as IssueProperties['state'];
  const priority = readString(props, 'priority');
  if (priority) fields.priority = priority as IssueProperties['priority'];
  const estimate = readNumber(props, 'estimate');
  if (estimate !== undefined) fields.estimate = estimate;
  const assigneeId = readString(props, 'assignee_id');
  if (assigneeId) fields.assignee_id = assigneeId;
  const source = readString(props, 'source');
  if (source) fields.source = source as IssueProperties['source'];
  const prefix = readString(props, 'prefix');
  if (prefix) fields.prefix = prefix;
  const color = readString(props, 'color');
  if (color) fields.color = color;
  return fields;
}

export type DocumentDetailFlattenedFields = DocumentListFlattenedFields & {
  impact?: ProjectProperties['impact'];
  confidence?: ProjectProperties['confidence'];
  ease?: ProjectProperties['ease'];
  owner_id?: string | null;
  accountable_id?: string | null;
  consulted_ids?: string[];
  informed_ids?: string[];
  has_design_review?: boolean | null;
  design_review_notes?: string | null;
  status?: WeekProperties['status'];
  plan?: string | null;
  plan_approval?: ApprovalTracking | null;
  review_approval?: ApprovalTracking | null;
  review_rating?: WeekProperties['review_rating'];
  person_id?: string;
  assignee_ids?: string[];
};

export function readDocumentDetailFields(
  raw: unknown,
  documentType: string
): DocumentDetailFlattenedFields {
  const props = asRecord(raw);
  const fields: DocumentDetailFlattenedFields = readIssueListFields(props);

  if (documentType === 'project' || documentType === 'program') {
    fields.impact = readNullableNumber(props, 'impact') as ProjectProperties['impact'];
    fields.confidence = readNullableNumber(props, 'confidence') as ProjectProperties['confidence'];
    fields.ease = readNullableNumber(props, 'ease') as ProjectProperties['ease'];
    fields.owner_id = readNullableString(props, 'owner_id') ?? null;
    fields.accountable_id = readNullableString(props, 'accountable_id') ?? null;
    fields.consulted_ids = readStringArray(props, 'consulted_ids');
    fields.informed_ids = readStringArray(props, 'informed_ids');
    fields.has_design_review =
      props.has_design_review === null
        ? null
        : typeof props.has_design_review === 'boolean'
          ? props.has_design_review
          : null;
    fields.design_review_notes = readNullableString(props, 'design_review_notes') ?? null;
  }

  if (documentType === 'sprint') {
    const assigneeIds = readStringArray(props, 'assignee_ids');
    fields.assignee_ids = assigneeIds;
    fields.status = readString(props, 'status') as WeekProperties['status'];
    fields.plan = readNullableString(props, 'plan') ?? null;
    fields.plan_approval = readApprovalTracking(props.plan_approval) ?? null;
    fields.review_approval = readApprovalTracking(props.review_approval) ?? null;
    const reviewRating = props.review_rating;
    if (reviewRating && typeof reviewRating === 'object' && !Array.isArray(reviewRating)) {
      fields.review_rating = reviewRating as WeekProperties['review_rating'];
    }
  }

  if (documentType !== 'sprint') {
    fields.owner_id = readNullableString(props, 'owner_id') ?? null;
  }

  const personId = readString(props, 'person_id');
  if (personId) fields.person_id = personId;

  return fields;
}

export function readProgramListFields(raw: unknown): Pick<ProgramProperties, 'color' | 'emoji' | 'owner_id' | 'accountable_id' | 'consulted_ids' | 'informed_ids'> {
  const props = asRecord(raw);
  return {
    color: readString(props, 'color') ?? '#6366f1',
    emoji: readNullableString(props, 'emoji') ?? null,
    owner_id: readNullableString(props, 'owner_id') ?? null,
    accountable_id: readNullableString(props, 'accountable_id') ?? null,
    consulted_ids: readStringArray(props, 'consulted_ids'),
    informed_ids: readStringArray(props, 'informed_ids'),
  };
}

function assignBootstrapProperty<K extends BootstrapDocumentPropertyKey>(
  picked: Partial<Pick<IssueProperties, BootstrapDocumentPropertyKey>>,
  key: K,
  value: unknown
): void {
  if (value !== undefined) {
    picked[key] = value as IssueProperties[K];
  }
}

export function pickBootstrapDocumentProperties(
  properties: Record<string, unknown> | null
): Partial<Pick<IssueProperties, BootstrapDocumentPropertyKey>> | null {
  if (!properties) return null;

  const picked: Partial<Pick<IssueProperties, BootstrapDocumentPropertyKey>> = {};
  for (const key of BOOTSTRAP_DOCUMENT_PROPERTY_KEYS) {
    assignBootstrapProperty(picked, key, properties[key]);
  }

  return Object.keys(picked).length > 0 ? picked : null;
}

export function readOwnerIdFromProperties(raw: unknown): string | undefined {
  return readString(asRecord(raw), 'owner_id');
}

export function readPersonIdFromProperties(raw: unknown): string | undefined {
  return readString(asRecord(raw), 'person_id');
}

export function readAssigneeIdsFromProperties(raw: unknown): string[] {
  return readStringArray(asRecord(raw), 'assignee_ids');
}

export function readPropertyColor(raw: unknown): string | undefined {
  return readString(asRecord(raw), 'color');
}

export type ProjectBootstrapFields = DocumentDetailFlattenedFields & {
  emoji?: string | null;
  is_complete?: boolean | null;
  missing_fields?: string[];
  has_retro?: boolean;
  target_date?: string | null;
};

export function readProjectBootstrapFields(raw: unknown): ProjectBootstrapFields {
  const props = asRecord(raw);
  const detail = readDocumentDetailFields(props, 'project');
  return {
    ...detail,
    emoji: readNullableString(props, 'emoji') ?? null,
    is_complete:
      props.is_complete === null
        ? null
        : typeof props.is_complete === 'boolean'
          ? props.is_complete
          : null,
    missing_fields: readStringArray(props, 'missing_fields'),
    has_retro: typeof props.has_retro === 'boolean' ? props.has_retro : false,
    target_date: readNullableString(props, 'target_date') ?? null,
  };
}

export function readRestoredDocumentFields(
  raw: unknown,
  documentType: string
): DocumentDetailFlattenedFields & { program_id?: string } {
  const props = asRecord(raw);
  const fields = readDocumentDetailFields(props, documentType);
  const programId = readString(props, 'program_id');
  return {
    ...fields,
    ...(programId ? { program_id: programId } : {}),
  };
}
