import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { repoRoot } from './lib/repo.mjs';

const ENUM_SOURCE = join(repoRoot, 'shared/src/enums/document-enums.ts');

/** @deprecated document_type values removed by migration 033 */
export const DEPRECATED_DOCUMENT_TYPE_TOKENS = ['sprint_plan', 'sprint_retro', 'sprint_review'];

export function loadDocumentTypeValues() {
  const source = readFileSync(ENUM_SOURCE, 'utf8');
  const match = source.match(/export const DOCUMENT_TYPE_VALUES = \[([\s\S]*?)\] as const/);
  if (!match) throw new Error('Could not parse DOCUMENT_TYPE_VALUES from document-enums.ts');
  return [...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

export function loadIssueStateValues() {
  const source = readFileSync(ENUM_SOURCE, 'utf8');
  const match = source.match(/export const ISSUE_STATE_VALUES = \[([\s\S]*?)\] as const/);
  if (!match) throw new Error('Could not parse ISSUE_STATE_VALUES from document-enums.ts');
  return [...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

export function loadFacts() {
  return {
    documentTypes: loadDocumentTypeValues(),
    issueStates: loadIssueStateValues(),
    deprecatedDocumentTypeTokens: DEPRECATED_DOCUMENT_TYPE_TOKENS,
  };
}
