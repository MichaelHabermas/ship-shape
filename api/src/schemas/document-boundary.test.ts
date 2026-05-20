import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  accountabilityTypeValues,
  belongsToTypeValues,
  createIssueRequestSchema,
  documentTypeValues,
  documentVisibilityValues,
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

const parseQuotedValues = (source: string) =>
  Array.from(source.matchAll(/'([^']+)'/g), match => match[1]!);

const parseSharedUnion = (typeName: string) => {
  const match = sharedDocumentTypes.match(new RegExp(`export type ${typeName} =([\\s\\S]*?);`));

  expect(match, `shared type ${typeName} should exist`).not.toBeNull();

  return parseQuotedValues(match![1]!);
};

const parseDbDocumentTypes = () => {
  const match = dbSchema.match(/CREATE TYPE document_type AS ENUM \(([^)]+)\)/);

  expect(match, 'database document_type enum should exist').not.toBeNull();

  return parseQuotedValues(match![1]!);
};

const parseDbVisibilityValues = () => {
  const match = dbSchema.match(/visibility TEXT[\s\S]*?CHECK \(visibility IN \(([^)]+)\)\)/);

  expect(match, 'database visibility check should exist').not.toBeNull();

  return parseQuotedValues(match![1]!);
};

describe('document boundary contracts', () => {
  it('keeps document type values aligned across shared, DB, runtime, and OpenAPI', () => {
    const runtime = sortValues(documentTypeValues);

    expect(sortValues(parseSharedUnion('DocumentType'))).toEqual(runtime);
    expect(sortValues(parseDbDocumentTypes())).toEqual(runtime);
    expect(sortValues(DocumentTypeSchema.options)).toEqual(runtime);
  });

  it('keeps common boundary values aligned across shared, runtime, and OpenAPI', () => {
    const contracts = [
      {
        name: 'DocumentVisibility',
        shared: parseSharedUnion('DocumentVisibility'),
        db: parseDbVisibilityValues(),
        runtime: documentVisibilityValues,
        openapi: DocumentVisibilitySchema.options,
      },
      {
        name: 'BelongsToType',
        shared: parseSharedUnion('BelongsToType'),
        runtime: belongsToTypeValues,
        openapi: BelongsToTypeSchema.options,
      },
      {
        name: 'IssueState',
        shared: parseSharedUnion('IssueState'),
        runtime: issueStateValues,
        openapi: IssueStateSchema.options,
      },
      {
        name: 'IssuePriority',
        shared: parseSharedUnion('IssuePriority'),
        runtime: issuePriorityValues,
        openapi: IssuePrioritySchema.options,
      },
      {
        name: 'IssueSource',
        shared: parseSharedUnion('IssueSource'),
        runtime: issueSourceValues,
        openapi: IssueSourceSchema.options,
      },
      {
        name: 'AccountabilityType',
        shared: parseSharedUnion('AccountabilityType'),
        runtime: accountabilityTypeValues,
        openapi: AccountabilityTypeSchema.options,
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

    const sharedKeys = Array.from(
      issuePropertiesMatch![1]!.matchAll(/^\s{2}([a-zA-Z_][a-zA-Z0-9_]*)\??:/gm),
      match => match[1]!
    );
    const runtimeKeys = Object.keys(issuePropertiesSchema.shape);

    expect(sortValues(runtimeKeys)).toEqual(sortValues(sharedKeys));
  });
});
