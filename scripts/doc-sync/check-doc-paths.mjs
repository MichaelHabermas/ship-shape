#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadDocTargets } from './lib/expand-targets.mjs';
import { extractPathRefs } from './lib/extract-paths.mjs';
import { repoPathExists, repoRoot } from './lib/repo.mjs';

const strict = process.argv.includes('--strict');

/** @type {{ doc: string, section: string, issue: string, severity: string }[]} */
const findings = [];

for (const doc of loadDocTargets()) {
  const fullPath = join(repoRoot, doc);
  let source;
  try {
    source = readFileSync(fullPath, 'utf8');
  } catch {
    findings.push({ doc, section: 'file', issue: 'Doc target missing on disk', severity: 'Critical' });
    continue;
  }

  const refs = extractPathRefs(source, doc);
  const seen = new Set();
  for (const ref of refs) {
    const filePart = ref.path.split(':')[0];
    const key = `${ref.doc}:${ref.line}:${filePart}`;
    if (seen.has(key)) continue;
    seen.add(key);

    if (!repoPathExists(filePart)) {
      findings.push({
        doc: ref.doc,
        section: `line ${ref.line}`,
        issue: `Missing ${ref.kind} path: ${ref.path}`,
        severity: 'Critical',
      });
    }
  }
}

console.log('Doc path check');
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
