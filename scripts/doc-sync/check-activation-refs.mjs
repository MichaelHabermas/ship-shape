#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { repoRoot } from './lib/repo.mjs';

const strict = process.argv.includes('--strict');

const docsToScan = [
  'AGENTS.md',
  '.claude/CLAUDE.md',
  '.claude/rules/reference-docs.md',
  '.agents/skills/assessment-audit/SKILL.md',
  '.agents/skills/ship-deploy/SKILL.md',
  '.agents/skills/ship-philosophy-reviewer/SKILL.md',
  '.agents/skills/ship-worktree-preflight/SKILL.md',
  '.claude/skills/ship-deploy/SKILL.md',
  '.claude/skills/ship-philosophy-reviewer/SKILL.md',
  '.claude/skills/ship-worktree-preflight/SKILL.md',
  'docs/claude-reference/commands.md',
  'docs/claude-reference/testing.md',
];

const externalSlashCommands = new Set([
  '/e2e-test-runner',
]);

const externalSlashFallbacks = new Map([
  ['/e2e-test-runner', 'pnpm test:e2e:run'],
]);

const localSkillDirs = [
  '.agents/skills',
  '.claude/skills',
];

const findings = [];

for (const doc of docsToScan) {
  const fullPath = join(repoRoot, doc);
  if (!existsSync(fullPath)) {
    findings.push({ doc, section: 'file', issue: 'Activation doc missing on disk', severity: 'Critical' });
    continue;
  }

  const source = readFileSync(fullPath, 'utf8');
  const lines = source.split('\n');

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const lineNumber = index + 1;

    for (const match of line.matchAll(/(?:^|[\s`(])(?<command>\/(?:ship-[a-z0-9:_-]+|e2e-test-runner|workflows:[a-z0-9:_-]+))/g)) {
      const command = match.groups?.command;
      if (!command) continue;
      const name = command.slice(1);

      if (externalSlashCommands.has(command)) {
        const fallback = externalSlashFallbacks.get(command);
        if (fallback && source.includes(fallback)) continue;

        findings.push({
          doc,
          section: `line ${lineNumber}`,
          issue: `External slash command is not repo-local and needs a documented fallback: ${command}`,
          severity: 'Warning',
        });
        continue;
      }

      if (!hasLocalSkill(name)) {
        findings.push({
          doc,
          section: `line ${lineNumber}`,
          issue: `Missing repo-local skill for slash command: ${command}`,
          severity: 'Critical',
        });
      }
    }

    for (const match of line.matchAll(/`(?<path>\.\/scripts\/[\w./@-]+)`/g)) {
      const scriptPath = match.groups?.path;
      if (!scriptPath) continue;
      if (!existsSync(join(repoRoot, scriptPath))) {
        findings.push({
          doc,
          section: `line ${lineNumber}`,
          issue: `Missing script path: ${scriptPath}`,
          severity: 'Critical',
        });
      }
    }

    for (const match of line.matchAll(/(?<path>\/Users\/[^\s`)]+)/g)) {
      const absolutePath = match.groups?.path;
      if (!absolutePath) continue;
      const rel = relative(repoRoot, absolutePath);
      if (rel.startsWith('..')) {
        findings.push({
          doc,
          section: `line ${lineNumber}`,
          issue: `External absolute local path in activation-readable docs: ${absolutePath}`,
          severity: 'Warning',
        });
      }
    }
  }
}

console.log('Activation reference check');
console.log(`Targets scanned: ${docsToScan.length}`);
console.log(`Findings: ${findings.length}`);

if (findings.length > 0) {
  console.log('\n| Doc | Section | Issue | Severity |');
  console.log('|-----|---------|-------|----------|');
  for (const row of findings) {
    console.log(`| ${row.doc} | ${row.section} | ${row.issue} | ${row.severity} |`);
  }
}

if (strict && findings.some((finding) => finding.severity === 'Critical')) {
  process.exit(1);
}

function hasLocalSkill(name) {
  return localSkillDirs.some((dir) => existsSync(join(repoRoot, dir, name, 'SKILL.md')));
}
