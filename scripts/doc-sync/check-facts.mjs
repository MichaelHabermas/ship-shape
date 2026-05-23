#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadDocTargets } from './lib/expand-targets.mjs';
import { repoRoot } from './lib/repo.mjs';
import { DEPRECATED_DOCUMENT_TYPE_TOKENS, loadFacts } from './facts.mjs';

const strict = process.argv.includes('--strict');

/** @type {{ doc: string, section: string, issue: string, severity: string }[]} */
const findings = [];

const facts = loadFacts();
const markerStart = /<!-- docs:generated start id="document-type-enum"/;
const markerEnd = /<!-- docs:generated end id="document-type-enum"/;

for (const doc of loadDocTargets()) {
  const fullPath = join(repoRoot, doc);
  let source;
  try {
    source = readFileSync(fullPath, 'utf8');
  } catch {
    continue;
  }

  for (const token of DEPRECATED_DOCUMENT_TYPE_TOKENS) {
    const legacyPattern = new RegExp(`legacy\\s+\`${token}\`|legacy\\s+${token}|replacing legacy \`${token}\``, 'i');
    if (source.includes(token) && !legacyPattern.test(source)) {
      findings.push({
        doc,
        section: 'deprecated enum token',
        issue: `Contains deprecated document_type token: ${token}`,
        severity: 'Warning',
      });
    }
  }

  if (markerStart.test(source) && markerEnd.test(source)) {
    const startIdx = source.search(markerStart);
    const endIdx = source.search(markerEnd);
    const block = source.slice(startIdx, endIdx);
    for (const value of facts.documentTypes) {
      const present =
        block.includes(`\`${value}\``) ||
        block.includes(`'${value}'`) ||
        block.includes(`**${value}**`);
      if (!present) {
        findings.push({
          doc,
          section: 'document-type-enum generated block',
          issue: `Generated block missing document type: ${value}`,
          severity: 'Warning',
        });
      }
    }
  }
}

console.log('Doc facts check');
console.log(`Targets scanned: ${loadDocTargets().length}`);
console.log(`Findings: ${findings.length}`);

if (findings.length > 0) {
  console.log('\n| Doc | Section | Issue | Severity |');
  console.log('|-----|---------|-------|----------|');
  for (const row of findings) {
    console.log(`| ${row.doc} | ${row.section} | ${row.issue} | ${row.severity} |`);
  }
}

if (strict && findings.length > 0) process.exit(1);
