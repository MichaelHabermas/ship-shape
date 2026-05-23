#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { repoRoot } from './lib/repo.mjs';
import { loadFacts } from './facts.mjs';

const checkOnly = process.argv.includes('--check');

const TARGETS = [
  {
    file: 'docs/claude-reference/data-model.md',
    id: 'document-type-enum',
    source: 'shared/src/enums/document-enums.ts',
    render: (facts) => renderEnumBlock(facts.documentTypes),
  },
  {
    file: 'docs/claude-reference/glossary.md',
    id: 'document-type-enum',
    source: 'shared/src/enums/document-enums.ts',
    render: (facts) => renderGlossaryList(facts.documentTypes),
  },
];

function renderEnumBlock(values) {
  const lines = values.map((v) => `- \`${v}\``).join('\n');
  return `<!-- docs:generated start id="document-type-enum" source="shared/src/enums/document-enums.ts" -->
${lines}
<!-- docs:generated end id="document-type-enum" -->`;
}

function renderGlossaryList(values) {
  const items = values.map((v) => `- **${v}**`).join('\n');
  return `<!-- docs:generated start id="document-type-enum" source="shared/src/enums/document-enums.ts" -->
${items}
<!-- docs:generated end id="document-type-enum" -->`;
}

function replaceBlock(source, id, rendered) {
  const start = new RegExp(`<!-- docs:generated start id="${id}"[^>]*-->[\\s\\S]*?<!-- docs:generated end id="${id}" -->`);
  if (!start.test(source)) {
    throw new Error(`Missing generated marker block id="${id}"`);
  }
  return source.replace(start, rendered);
}

let changed = 0;
for (const target of TARGETS) {
  const path = join(repoRoot, target.file);
  const facts = loadFacts();
  const rendered = target.render(facts);
  const source = readFileSync(path, 'utf8');
  const next = replaceBlock(source, target.id, rendered);
  if (next !== source) {
    changed++;
    if (!checkOnly) writeFileSync(path, next);
  }
}

if (checkOnly && changed > 0) {
  console.error(`Stale generated doc blocks: ${changed}`);
  process.exit(1);
}

console.log(checkOnly ? `Generated blocks up to date (${TARGETS.length} files)` : `Rendered ${changed} file(s)`);
