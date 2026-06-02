#!/usr/bin/env node
// Fails when active docs reintroduce the removed deterministic PM chat contract.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const targets = [
  'FLEETGRAPH.md',
  'PRESEARCH.md',
  'REVIEWER_GUIDE.md',
  'AGENTS.md',
  'my-docs/MEMORY.md',
  'my-docs/AI_COST_ANALYSIS.md',
  'my-docs/project-weeks-sot/week-5/DECISION_LOG-w5.md',
  'my-docs/project-weeks-sot/week-5/ARCHITECTURE.md',
  'my-docs/evals/fleetgraph-chat-behavior/README.md',
  'docs/context-manifest.md',
];

const denyPatterns = [
  { id: 'bounded-capsule-not-chat', pattern: /bounded capsule, not generic chat/i },
  { id: 'zero-model-context-chat', pattern: /zero model calls.*context chat|context chat.*zero model calls/i },
  { id: 'deterministic-context-chat-answer', pattern: /deterministicContextChatAnswer/ },
  { id: 'ci-deterministic-chat-default', pattern: /CI-safe checks remain deterministic and no-model/i },
  { id: 'chat-remain-deterministic', pattern: /explain, refine, dismiss, and resolve paths remain deterministic.*chat|chat remain deterministic/i },
  { id: 'fleetgraph-chat-deterministic-flag', pattern: /FLEETGRAPH_CHAT_DETERMINISTIC/ },
  { id: 'chat-offline-answer', pattern: /chatOfflineAnswer/ },
];

function walkMdFiles(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      if (entry === 'node_modules' || entry === 'evidence' || entry === '.git') continue;
      walkMdFiles(full, out);
    } else if (entry.endsWith('.md') && full.includes(`${path.sep}my-docs${path.sep}`)) {
      out.push(full);
    }
  }
  return out;
}

const files = [...new Set([...targets.map((rel) => path.join(repoRoot, rel)), ...walkMdFiles(path.join(repoRoot, 'my-docs'))])];
const allowRemovalMention = new Set([
  'my-docs/project-weeks-sot/week-5/DECISION_LOG-w5.md',
  'my-docs/engineering-lessons.md',
]);

const issues = [];

for (const file of files) {
  if (!statSync(file, { throwIfNoEntry: false })?.isFile()) continue;
  const rel = path.relative(repoRoot, file);
  const text = readFileSync(file, 'utf8');
  for (const { id, pattern } of denyPatterns) {
    if (id === 'deterministic-context-chat-answer' && allowRemovalMention.has(rel)) continue;
    if (pattern.test(text)) {
      issues.push(`${rel}: matched ${id}`);
    }
  }
}

if (issues.length > 0) {
  console.error('FleetGraph chat contract check failed:\n' + issues.map((line) => `  - ${line}`).join('\n'));
  process.exit(1);
}

console.log(`FleetGraph chat contract check passed (${files.length} files).`);
