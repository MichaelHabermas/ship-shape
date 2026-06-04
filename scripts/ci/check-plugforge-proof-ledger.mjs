#!/usr/bin/env node
// PlugForge proof ledger checker validates atom classification, proof commands, and named gaps.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const defaultLedgerPath = path.join(rootDir, 'my-docs', 'project-weeks-sot', 'week-6', 'proof-ledger.yaml');
const rawArgs = process.argv.slice(2);
const args = new Set(rawArgs);
const enforce = args.has('--enforce');
const ledgerPathArg = process.argv.find(arg => arg.startsWith('--ledger='));
const ledgerPath = ledgerPathArg
  ? path.resolve(rootDir, ledgerPathArg.slice('--ledger='.length))
  : defaultLedgerPath;

const filters = {
  priorities: parseFilter('priority'),
  areas: parseFilter('area'),
  classes: parseFilter('class'),
  statuses: parseFilter('status'),
};

const validStatuses = new Set([
  'proven',
  'partial',
  'missing',
  'manual_pending',
  'open_decision',
  'non_scope',
  'covered_by',
]);
const validTestability = new Set(['unit', 'api', 'e2e', 'metric', 'manual', 'none']);
const validRequirementClasses = new Set([
  'functional',
  'metric',
  'documentation',
  'submission',
  'manual',
  'open_decision',
  'non_scope',
]);
const validPriorities = new Set(['P0', 'P1', 'P2']);
const enforceTestability = new Set(['unit', 'api', 'e2e', 'metric']);
const requiredFields = [
  'id',
  'source',
  'section',
  'requirement',
  'requirement_class',
  'testability',
  'priority',
  'status',
  'proof_command',
  'proof_files',
  'pending_test',
  'manual_evidence',
  'covered_by',
  'gap',
];

if (!existsSync(ledgerPath)) {
  console.error(`PlugForge proof ledger not found: ${path.relative(rootDir, ledgerPath)}`);
  process.exit(1);
}

const entries = parseLedger(readFileSync(ledgerPath, 'utf8'));
const problems = [];
const ids = new Set();
const fileContents = new Map();
const coverageReferences = [];

if (entries.length === 0) {
  problems.push('Ledger contains no requirements.');
}

for (const entry of entries) {
  const label = entry.id || '(missing id)';
  for (const field of requiredFields) {
    if (!hasValue(entry[field])) {
      problems.push(`${label}: missing required field ${field}`);
    }
  }

  if (!/^W6-[A-Z]+-\d{3}$/.test(entry.id ?? '')) {
    problems.push(`${label}: id must match W6-AREA-001`);
  }
  if (ids.has(entry.id)) {
    problems.push(`${label}: duplicate id`);
  }
  ids.add(entry.id);

  if (!validStatuses.has(entry.status ?? '')) {
    problems.push(`${label}: invalid status ${entry.status}`);
  }
  if (!validTestability.has(entry.testability ?? '')) {
    problems.push(`${label}: invalid testability ${entry.testability}`);
  }
  if (!validRequirementClasses.has(entry.requirement_class ?? '')) {
    problems.push(`${label}: invalid requirement_class ${entry.requirement_class}`);
  }
  if (!validPriorities.has(entry.priority ?? '')) {
    problems.push(`${label}: invalid priority ${entry.priority}`);
  }
  if (filters.priorities.length > 0 && !filters.priorities.includes(entry.priority)) {
    continue;
  }
  if (filters.areas.length > 0 && !filters.areas.includes(areaFor(entry.id))) {
    continue;
  }
  if (filters.classes.length > 0 && !filters.classes.includes(entry.requirement_class)) {
    continue;
  }
  if (filters.statuses.length > 0 && !filters.statuses.includes(entry.status)) {
    continue;
  }

  if (entry.status === 'proven') {
    if (isNone(entry.proof_command)) problems.push(`${label}: proven item must name proof_command`);
    if (isNone(entry.proof_files)) problems.push(`${label}: proven item must name proof_files`);
    if (!isNone(entry.gap)) problems.push(`${label}: proven item should use gap: "none"`);
  }

  if ((entry.status === 'partial' || entry.status === 'missing' || entry.status === 'manual_pending') && isNone(entry.gap)) {
    problems.push(`${label}: ${entry.status} item must name a concrete gap`);
  }

  if (
    enforce &&
    (entry.priority === 'P0' || entry.priority === 'P1') &&
    enforceTestability.has(entry.testability) &&
    entry.status !== 'proven'
  ) {
    problems.push(`${label}: enforce mode requires P0/P1 ${entry.testability} requirements to be proven`);
  }

  if (
    (entry.priority === 'P0' || entry.priority === 'P1') &&
    enforceTestability.has(entry.testability) &&
    (entry.status === 'partial' || entry.status === 'missing') &&
    isNone(entry.pending_test)
  ) {
    problems.push(`${label}: missing or partial testable item must name a pending_test`);
  }

  if (isDocumentationLike(entry) && !['covered_by', 'open_decision', 'non_scope'].includes(entry.status) && isNone(entry.manual_evidence)) {
    problems.push(`${label}: manual/documentation/submission item must name manual_evidence`);
  }

  if (entry.status === 'covered_by') {
    if (isNone(entry.covered_by)) {
      problems.push(`${label}: covered_by item must point to an existing id`);
    } else {
      coverageReferences.push({ id: entry.id, coveredBy: entry.covered_by });
    }
    if (!isNone(entry.proof_command) || !isNone(entry.proof_files) || !isNone(entry.pending_test) || !isNone(entry.manual_evidence)) {
      problems.push(`${label}: covered_by item should not duplicate proof, pending tests, or manual evidence`);
    }
  } else if (!isNone(entry.covered_by)) {
    problems.push(`${label}: covered_by must be none unless status is covered_by`);
  }

  if (entry.status === 'open_decision' || entry.status === 'non_scope') {
    if (entry.requirement_class !== entry.status) {
      problems.push(`${label}: ${entry.status} item must use requirement_class ${entry.status}`);
    }
    if (!isNone(entry.proof_command) || !isNone(entry.proof_files) || !isNone(entry.pending_test) || !isNone(entry.manual_evidence) || !isNone(entry.covered_by)) {
      problems.push(`${label}: ${entry.status} item must not pretend to have proof, pending tests, manual evidence, or coverage`);
    }
  }

  if (entry.requirement_class === 'open_decision' && entry.status !== 'open_decision') {
    problems.push(`${label}: open_decision class must use open_decision status`);
  }
  if (entry.requirement_class === 'non_scope' && entry.status !== 'non_scope') {
    problems.push(`${label}: non_scope class must use non_scope status`);
  }

  for (const field of ['proof_files', 'pending_test']) {
    if (isNone(entry[field])) continue;
    for (const item of splitPaths(entry[field])) {
      if (!existsSync(path.resolve(rootDir, item))) {
        problems.push(`${label}: ${field} path does not exist: ${item}`);
      }
    }
  }

  if (
    (entry.priority === 'P0' || entry.priority === 'P1') &&
    enforceTestability.has(entry.testability) &&
    (entry.status === 'partial' || entry.status === 'missing') &&
    !isNone(entry.pending_test)
  ) {
    const pendingFiles = splitPaths(entry.pending_test);
    const hasMatchingPendingId = pendingFiles.some(item => {
      const absolutePath = path.resolve(rootDir, item);
      if (!existsSync(absolutePath)) return false;
      if (!fileContents.has(absolutePath)) {
        fileContents.set(absolutePath, readFileSync(absolutePath, 'utf8'));
      }
      return fileContents.get(absolutePath).includes(entry.id);
    });
    if (!hasMatchingPendingId) {
      problems.push(`${label}: pending_test file must mention the requirement id`);
    }
  }
}

for (const reference of coverageReferences) {
  if (!ids.has(reference.coveredBy)) {
    problems.push(`${reference.id}: covered_by target does not exist: ${reference.coveredBy}`);
  }
}

const counts = countBy(entries, entry => entry.status);
const byArea = countBy(entries, entry => areaFor(entry.id));
const byRequirementClass = countBy(entries, entry => entry.requirement_class);
const byTestability = countBy(entries, entry => entry.testability);

console.log(JSON.stringify({
  ledger: path.relative(rootDir, ledgerPath),
  atoms: entries.length,
  by_status: counts,
  by_area: byArea,
  by_requirement_class: byRequirementClass,
  by_testability: byTestability,
  enforce,
  filters,
}, null, 2));

if (problems.length > 0) {
  console.error('\nPlugForge proof ledger problems:');
  for (const problem of problems) console.error(`- ${problem}`);
  process.exit(1);
}

function parseLedger(text) {
  const entries = [];
  let current = null;

  for (const rawLine of text.split(/\r?\n/)) {
    const idMatch = rawLine.match(/^  - id:\s*(.+)$/);
    if (idMatch) {
      current = { id: parseScalar(idMatch[1]) };
      entries.push(current);
      continue;
    }

    if (!current) continue;
    const fieldMatch = rawLine.match(/^    ([A-Za-z0-9_]+):\s*(.*)$/);
    if (fieldMatch) {
      current[fieldMatch[1]] = parseScalar(fieldMatch[2]);
    }
  }

  return entries;
}

function parseScalar(value) {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function hasValue(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isNone(value) {
  return !hasValue(value) || value.trim().toLowerCase() === 'none';
}

function splitPaths(value) {
  return value
    .split(',')
    .map(part => part.trim())
    .filter(Boolean);
}

function areaFor(id) {
  return id?.split('-')[1] ?? 'UNKNOWN';
}

function countBy(entries, mapper) {
  return entries.reduce((acc, entry) => {
    const key = mapper(entry) || 'unknown';
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
}

function parseFilter(name) {
  const inline = rawArgs.find(arg => arg.startsWith(`--${name}=`));
  if (inline) return splitFilterValues(inline.slice(name.length + 3));

  const index = rawArgs.indexOf(`--${name}`);
  if (index === -1 || index === rawArgs.length - 1) return [];
  return splitFilterValues(rawArgs[index + 1]);
}

function splitFilterValues(value) {
  return value
    .split(',')
    .map(part => part.trim())
    .filter(Boolean);
}

function isDocumentationLike(entry) {
  return entry.requirement_class === 'documentation' || entry.requirement_class === 'submission' || entry.requirement_class === 'manual';
}
