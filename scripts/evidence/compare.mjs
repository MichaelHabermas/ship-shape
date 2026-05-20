#!/usr/bin/env node
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs, validateRunId } from './lib/cli.mjs';
import { exists, repoRelative, repoRoot } from './lib/fs-utils.mjs';

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function latestRunIds() {
  const runsDir = resolve(repoRoot, 'my-docs/evidence-runs');
  if (!(await exists(runsDir))) return [];
  const entries = await readdir(runsDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .slice(-2);
}

function indexBy(items, key) {
  return new Map(items.map((item) => [item[key], item]));
}

function compareCollectors(base, target) {
  const baseByName = indexBy(base.collectors || [], 'name');
  const targetByName = indexBy(target.collectors || [], 'name');
  const names = [...new Set([...baseByName.keys(), ...targetByName.keys()])].sort();

  return names.map((name) => {
    const baseCollector = baseByName.get(name) || null;
    const targetCollector = targetByName.get(name) || null;
    return {
      name,
      baseStatus: baseCollector?.status || 'missing',
      targetStatus: targetCollector?.status || 'missing',
      changed: (baseCollector?.status || 'missing') !== (targetCollector?.status || 'missing'),
      baseSummary: baseCollector?.summary || null,
      targetSummary: targetCollector?.summary || null,
    };
  });
}

function compareClaims(baseClaims, targetClaims) {
  const baseById = indexBy(baseClaims, 'id');
  const targetById = indexBy(targetClaims, 'id');
  const ids = [...new Set([...baseById.keys(), ...targetById.keys()])].sort();

  return ids
    .map((id) => {
      const baseClaim = baseById.get(id) || null;
      const targetClaim = targetById.get(id) || null;
      return {
        id,
        collector: targetClaim?.collector || baseClaim?.collector || null,
        baseStatus: baseClaim?.status || 'missing',
        targetStatus: targetClaim?.status || 'missing',
        changed: (baseClaim?.status || 'missing') !== (targetClaim?.status || 'missing'),
        targetStatement: targetClaim?.statement || null,
      };
    })
    .filter((claim) => claim.changed);
}

function renderMarkdown(comparison) {
  const lines = [
    `# Evidence Compare ${comparison.baseRunId}..${comparison.targetRunId}`,
    '',
    `- Base: ${comparison.baseRunId}`,
    `- Target: ${comparison.targetRunId}`,
    `- Collector status changes: ${comparison.collectors.filter((collector) => collector.changed).length}`,
    `- Claim status changes: ${comparison.changedClaims.length}`,
    '',
    '## Collectors',
    '',
  ];

  for (const collector of comparison.collectors) {
    lines.push(
      `- ${collector.name}: ${collector.baseStatus} -> ${collector.targetStatus}${collector.changed ? ' changed' : ''}`
    );
  }

  lines.push('', '## Changed Claims', '');
  if (comparison.changedClaims.length === 0) {
    lines.push('- None');
  } else {
    for (const claim of comparison.changedClaims) {
      lines.push(`- ${claim.id}: ${claim.baseStatus} -> ${claim.targetStatus}`);
    }
  }

  lines.push('');
  return lines.join('\n');
}

async function main() {
  const { options, positional } = parseArgs(process.argv.slice(2));
  const inferred = await latestRunIds();
  const baseRunId = validateRunId(String(options.baseRunId || positional[0] || inferred[0] || ''));
  const targetRunId = validateRunId(String(options.targetRunId || positional[1] || inferred[1] || ''));

  if (!baseRunId || !targetRunId) {
    throw new Error('Provide two run ids, or run evidence:compare after at least two evidence runs exist.');
  }
  if (baseRunId === targetRunId) {
    throw new Error(`Cannot compare evidence run "${baseRunId}" to itself.`);
  }

  const baseDir = resolve(repoRoot, 'my-docs/evidence-runs', baseRunId);
  const targetDir = resolve(repoRoot, 'my-docs/evidence-runs', targetRunId);
  const base = await readJson(resolve(baseDir, 'manifest.json'));
  const target = await readJson(resolve(targetDir, 'manifest.json'));
  const baseClaims = await readJson(resolve(baseDir, 'claims.json'));
  const targetClaims = await readJson(resolve(targetDir, 'claims.json'));
  const comparison = {
    baseRunId,
    targetRunId,
    generatedAt: new Date().toISOString(),
    collectors: compareCollectors(base, target),
    changedClaims: compareClaims(baseClaims, targetClaims),
  };
  const outputPath = resolve(targetDir, `COMPARE-${baseRunId}.json`);
  const markdownPath = resolve(targetDir, `COMPARE-${baseRunId}.md`);

  await writeFile(outputPath, `${JSON.stringify(comparison, null, 2)}\n`);
  await writeFile(markdownPath, renderMarkdown(comparison));

  console.log(`Evidence compare written to ${repoRelative(outputPath)}`);
  console.log(`Markdown compare written to ${repoRelative(markdownPath)}`);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
