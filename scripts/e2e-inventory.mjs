#!/usr/bin/env node
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const e2eDir = path.join(root, 'e2e');

function getSpecFiles(dir) {
  return readdirSync(dir)
    .filter((file) => file.endsWith('.spec.ts'))
    .sort()
    .map((file) => path.join(dir, file));
}

function countMatches(text, regex) {
  return [...text.matchAll(regex)].length;
}

function sumWaitBudgetMs(text) {
  return [...text.matchAll(/waitForTimeout\s*\(\s*(\d+)/g)]
    .reduce((sum, match) => sum + Number(match[1]), 0);
}

function topRows(rows, key, limit = 12) {
  return [...rows]
    .sort((a, b) => b[key] - a[key])
    .slice(0, limit)
    .filter((row) => row[key] > 0);
}

const packageJson = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const specs = getSpecFiles(e2eDir);
const specSet = new Set(specs.map((filePath) => path.relative(root, filePath)));
const laneScripts = Object.entries(packageJson.scripts ?? {})
  .filter(([name, command]) => name.startsWith('test:e2e:') && command.startsWith('./scripts/run-e2e.sh'))
  .map(([name, command]) => ({
    name,
    files: [...command.matchAll(/\be2e\/[^\s]+\.spec\.ts\b/g)].map((match) => match[0]),
  }));
const rows = specs.map((filePath) => {
  const text = readFileSync(filePath, 'utf8');
  const relativePath = path.relative(root, filePath);

  return {
    file: relativePath,
    lines: text.split('\n').length,
    tests: countMatches(text, /\btest\s*\(/g),
    waits: countMatches(text, /waitForTimeout\s*\(/g),
    waitBudgetMs: sumWaitBudgetMs(text),
    loginSignals: countMatches(text, /\/login|admin123|Sign in|login\(/g),
    apiSignals: countMatches(text, /\b(?:page\.)?request\.(?:get|post|patch|put|delete|fetch)\s*\(/g),
  };
});

const totals = rows.reduce((acc, row) => ({
  specs: acc.specs + 1,
  tests: acc.tests + row.tests,
  waits: acc.waits + row.waits,
  waitBudgetMs: acc.waitBudgetMs + row.waitBudgetMs,
  loginSignals: acc.loginSignals + row.loginSignals,
  apiSignals: acc.apiSignals + row.apiSignals,
}), {
  specs: 0,
  tests: 0,
  waits: 0,
  waitBudgetMs: 0,
  loginSignals: 0,
  apiSignals: 0,
});

const duplicateUmbrellaCandidates = [
  'e2e/features-real.spec.ts',
  'e2e/mentions.spec.ts',
  'e2e/images.spec.ts',
  'e2e/file-attachments.spec.ts',
  'e2e/tables.spec.ts',
  'e2e/toggle.spec.ts',
  'e2e/inline-code.spec.ts',
  'e2e/syntax-highlighting.spec.ts',
  'e2e/emoji.spec.ts',
  'e2e/backlinks.spec.ts',
].filter((file) => rows.some((row) => row.file === file));

function printSection(title, sectionRows, formatter) {
  console.log(`\n${title}`);
  if (sectionRows.length === 0) {
    console.log('  none');
    return;
  }
  for (const row of sectionRows) {
    console.log(`  ${formatter(row)}`);
  }
}

console.log('E2E Inventory (static only; no tests executed)');
console.log(`Specs: ${totals.specs}`);
console.log(`Regex test() mentions: ${totals.tests} (approximate; Playwright --list is authoritative)`);
console.log(`waitForTimeout calls: ${totals.waits}`);
console.log(`Declared fixed wait budget: ${(totals.waitBudgetMs / 1000).toFixed(1)}s`);
console.log(`Login/setup signals: ${totals.loginSignals}`);
console.log(`API request signals: ${totals.apiSignals}`);

const laneRefs = new Map();
const missingLaneRefs = [];
for (const lane of laneScripts) {
  for (const file of lane.files) {
    if (!specSet.has(file)) {
      missingLaneRefs.push({ lane: lane.name, file });
      continue;
    }
    const owners = laneRefs.get(file) ?? [];
    owners.push(lane.name);
    laneRefs.set(file, owners);
  }
}

const omittedSpecs = [...specSet].filter((file) => !laneRefs.has(file)).sort();
const duplicatedSpecs = [...laneRefs.entries()]
  .filter(([, lanes]) => lanes.length > 1)
  .sort(([a], [b]) => a.localeCompare(b));

console.log(`Lane scripts: ${laneScripts.length}`);
console.log(`Specs omitted from lanes: ${omittedSpecs.length}`);
console.log(`Specs in multiple lanes: ${duplicatedSpecs.length}`);

printSection('Largest specs by test declarations', topRows(rows, 'tests'), (row) =>
  `${row.file}: ${row.tests} tests, ${row.lines} lines`
);

printSection('Largest fixed-wait budgets', topRows(rows, 'waitBudgetMs'), (row) =>
  `${row.file}: ${(row.waitBudgetMs / 1000).toFixed(1)}s across ${row.waits} waits`
);

printSection('Most repeated login/setup signals', topRows(rows, 'loginSignals'), (row) =>
  `${row.file}: ${row.loginSignals} signals`
);

printSection('Most API-shaped Playwright specs', topRows(rows, 'apiSignals'), (row) =>
  `${row.file}: ${row.apiSignals} request calls`
);

console.log('\nLane membership issues');
if (missingLaneRefs.length === 0) {
  console.log('  Missing lane refs: none');
} else {
  console.log('  Missing lane refs:');
  for (const { lane, file } of missingLaneRefs) {
    console.log(`    ${lane}: ${file}`);
  }
}
if (omittedSpecs.length === 0) {
  console.log('  Omitted specs: none');
} else {
  console.log('  Omitted specs:');
  for (const file of omittedSpecs) {
    console.log(`    ${file}`);
  }
}
if (duplicatedSpecs.length === 0) {
  console.log('  Specs in multiple lanes: none');
} else {
  console.log('  Specs in multiple lanes:');
  for (const [file, lanes] of duplicatedSpecs) {
    console.log(`    ${file}: ${lanes.join(', ')}`);
  }
}

console.log('\nHeuristic duplicate umbrella coverage candidates');
for (const file of duplicateUmbrellaCandidates) {
  const lanes = laneRefs.get(file);
  const membership = lanes ? lanes.join(', ') : 'omitted from lanes';
  console.log(`  ${file}: ${membership}`);
}
