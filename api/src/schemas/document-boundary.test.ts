/** Keeps document boundary enums aligned across shared types, DB schema, runtime Zod, and OpenAPI. */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  ACCOUNTABILITY_TYPE_VALUES,
  BELONGS_TO_TYPE_VALUES,
  DOCUMENT_TYPE_VALUES,
  DOCUMENT_VISIBILITY_VALUES,
  INFERRED_PROJECT_STATUS_VALUES,
  ISSUE_PRIORITY_OPTIONS,
  ISSUE_PRIORITY_OPTIONS_FULL,
  ISSUE_PRIORITY_VALUES,
  ISSUE_SOURCE_VALUES,
  ISSUE_STATE_OPTIONS,
  ISSUE_STATE_VALUES,
} from '@ship/shared';
import {
  accountabilityTypeValues,
  belongsToTypeValues,
  createIssueRequestSchema,
  documentTypeValues,
  documentVisibilityValues,
  inferredProjectStatusSchema,
  inferredProjectStatusValues,
  issuePriorityValues,
  issuePropertiesSchema,
  issueSourceValues,
  issueStateValues,
  updateIssueRequestSchema,
} from './document-boundary.js';
import { DocumentTypeSchema } from '../openapi/schemas/documents.js';
import {
  BelongsToTypeSchema,
  DocumentVisibilitySchema,
  IssueSourceSchema,
} from '../openapi/schemas/common.js';
import {
  AccountabilityTypeSchema,
  CreateIssueSchema,
  IssuePrioritySchema,
  IssueStateSchema,
  UpdateIssueSchema,
} from '../openapi/schemas/issues.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const sharedDocumentTypes = readFileSync(
  resolve(repoRoot, 'shared/src/types/document.ts'),
  'utf8'
);
const dbSchema = readFileSync(resolve(repoRoot, 'api/src/db/schema.sql'), 'utf8');

const sortValues = (values: readonly string[]) => [...values].sort();

const parseQuotedValues = (source: string): string[] =>
  Array.from(source.matchAll(/'([^']+)'/g))
    .map(match => match[1])
    .filter((value): value is string => value !== undefined);

const parseDbDocumentTypes = () => {
  const match = dbSchema.match(/CREATE TYPE document_type AS ENUM \(([^)]+)\)/);

  expect(match, 'database document_type enum should exist').not.toBeNull();
  const enumBody = match?.[1];
  expect(enumBody, 'database document_type enum body should exist').toBeDefined();

  return parseQuotedValues(enumBody);
};

const parseDbVisibilityValues = () => {
  const match = dbSchema.match(/visibility TEXT[\s\S]*?CHECK \(visibility IN \(([^)]+)\)\)/);

  expect(match, 'database visibility check should exist').not.toBeNull();
  const visibilityList = match?.[1];
  expect(visibilityList, 'database visibility check values should exist').toBeDefined();

  return parseQuotedValues(visibilityList);
};

describe('document boundary contracts', () => {
  it('keeps document type values aligned across shared, DB, runtime, and OpenAPI', () => {
    const runtime = sortValues(documentTypeValues);

    expect(sortValues(DOCUMENT_TYPE_VALUES)).toEqual(runtime);
    expect(sortValues(parseDbDocumentTypes())).toEqual(runtime);
    expect(sortValues(DocumentTypeSchema.options)).toEqual(runtime);
  });

  it('keeps common boundary values aligned across shared, runtime, and OpenAPI', () => {
    const contracts = [
      {
        name: 'DocumentVisibility',
        shared: DOCUMENT_VISIBILITY_VALUES,
        db: parseDbVisibilityValues(),
        runtime: documentVisibilityValues,
        openapi: DocumentVisibilitySchema.options,
      },
      {
        name: 'BelongsToType',
        shared: BELONGS_TO_TYPE_VALUES,
        runtime: belongsToTypeValues,
        openapi: BelongsToTypeSchema.options,
      },
      {
        name: 'IssueState',
        shared: ISSUE_STATE_VALUES,
        runtime: issueStateValues,
        openapi: IssueStateSchema.options,
      },
      {
        name: 'IssuePriority',
        shared: ISSUE_PRIORITY_VALUES,
        runtime: issuePriorityValues,
        openapi: IssuePrioritySchema.options,
      },
      {
        name: 'IssueSource',
        shared: ISSUE_SOURCE_VALUES,
        runtime: issueSourceValues,
        openapi: IssueSourceSchema.options,
      },
      {
        name: 'AccountabilityType',
        shared: ACCOUNTABILITY_TYPE_VALUES,
        runtime: accountabilityTypeValues,
        openapi: AccountabilityTypeSchema.options,
      },
      {
        name: 'InferredProjectStatus',
        shared: INFERRED_PROJECT_STATUS_VALUES,
        runtime: inferredProjectStatusValues,
        openapi: inferredProjectStatusSchema.options,
      },
    ];

    for (const contract of contracts) {
      const runtime = sortValues(contract.runtime);

      expect(sortValues(contract.shared), `${contract.name} shared values`).toEqual(runtime);
      expect(sortValues(contract.openapi), `${contract.name} OpenAPI values`).toEqual(runtime);

      if ('db' in contract) {
        expect(sortValues(contract.db), `${contract.name} DB values`).toEqual(runtime);
      }
    }
  });

  it('keeps ISSUE_STATE_OPTIONS exhaustive and aligned with ISSUE_STATE_VALUES', () => {
    const fromOptions = ISSUE_STATE_OPTIONS.map((option) => option.value);

    expect(new Set(fromOptions).size).toBe(fromOptions.length);
    expect(sortValues(fromOptions)).toEqual(sortValues(ISSUE_STATE_VALUES));
  });

  it('keeps ISSUE_PRIORITY UI options within ISSUE_PRIORITY_VALUES', () => {
    const contextMenuValues = ISSUE_PRIORITY_OPTIONS.map((option) => option.value);
    const sidebarValues = ISSUE_PRIORITY_OPTIONS_FULL.map((option) => option.value);

    expect(new Set(contextMenuValues).size).toBe(contextMenuValues.length);
    expect(new Set(sidebarValues).size).toBe(sidebarValues.length);
    expect(sortValues(sidebarValues)).toEqual(sortValues(ISSUE_PRIORITY_VALUES));

    for (const value of contextMenuValues) {
      expect(ISSUE_PRIORITY_VALUES).toContain(value);
    }
  });

  it('keeps issue request schemas shared between runtime validation and OpenAPI', () => {
    expect(Object.keys(CreateIssueSchema.shape)).toEqual(Object.keys(createIssueRequestSchema.shape));
    expect(Object.keys(UpdateIssueSchema.shape)).toEqual(Object.keys(updateIssueRequestSchema.shape));

    expect(createIssueRequestSchema.parse({ title: 'New issue' })).toMatchObject({
      title: 'New issue',
      state: 'backlog',
      priority: 'medium',
      belongs_to: [],
      source: 'internal',
      is_system_generated: false,
    });
    expect(CreateIssueSchema.parse({ title: 'New issue' })).toEqual(
      createIssueRequestSchema.parse({ title: 'New issue' })
    );
  });

  it('keeps issue properties aligned with shared issue property keys', () => {
    const issuePropertiesMatch = sharedDocumentTypes.match(
      /export interface IssueProperties \{([\s\S]*?)\n\}/
    );

    expect(issuePropertiesMatch, 'shared IssueProperties interface should exist').not.toBeNull();
    const issuePropertiesBody = issuePropertiesMatch?.[1];
    expect(issuePropertiesBody, 'shared IssueProperties body should exist').toBeDefined();

    const sharedKeys = Array.from(
      issuePropertiesBody.matchAll(/^\s{2}([a-zA-Z_][a-zA-Z0-9_]*)\??:/gm),
      match => match[1]
    ).filter((key): key is string => key !== undefined);
    const runtimeKeys = Object.keys(issuePropertiesSchema.shape);

    expect(sortValues(runtimeKeys)).toEqual(sortValues(sharedKeys));
  });
});
