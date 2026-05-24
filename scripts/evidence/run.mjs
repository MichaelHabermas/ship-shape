#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { collectBundleStats } from './collectors/bundle-stats.mjs';
import { collectOpenApiValidation } from './collectors/openapi-validation.mjs';
import { collectOptionalArtifacts } from './collectors/optional-artifacts.mjs';
import { collectRepoMetadata } from './collectors/repo-metadata.mjs';
import { defaultRunId, parseArgs, validateRunId } from './lib/cli.mjs';
import { repoRelative, repoRoot } from './lib/fs-utils.mjs';
import { runCommand } from './lib/shell.mjs';

const RETENTION_KINDS = new Set(['source-evidence', 'scratch', 'generated-package']);

const collectors = [
  collectRepoMetadata,
  collectOpenApiValidation,
  collectBundleStats,
  collectOptionalArtifacts,
];

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function collectEnvironment() {
  const pnpm = await runCommand('pnpm', ['--version'], { cwd: repoRoot });
  return {
    generatedAt: new Date().toISOString(),
    cwd: repoRoot,
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    pnpm: pnpm.ok ? pnpm.stdout.trim() : null,
    env: {
      CI: process.env.CI || null,
      NODE_ENV: process.env.NODE_ENV || null,
    },
  };
}

async function collectGitStatus() {
  const commands = [
    ['git', ['rev-parse', '--abbrev-ref', 'HEAD']],
    ['git', ['rev-parse', 'HEAD']],
    ['git', ['status', '--short']],
  ];
  const [branch, commit, status] = await Promise.all(
    commands.map(([command, args]) => runCommand(command, args, { cwd: repoRoot }))
  );

  return {
    branch: branch.ok ? branch.stdout.trim() : null,
    commit: commit.ok ? commit.stdout.trim() : null,
    shortStatus: status.ok ? status.stdout : '',
    commandFailures: [branch, commit, status]
      .filter((result) => !result.ok)
      .map((result) => ({ code: result.code, stderr: result.stderr })),
  };
}

function renderGitStatus(git) {
  const lines = [
    `branch: ${git.branch || 'unknown'}`,
    `commit: ${git.commit || 'unknown'}`,
    '',
    'status --short:',
    git.shortStatus.trimEnd() || '(clean)',
    '',
  ];
  if (git.commandFailures.length > 0) {
    lines.push('command failures:', JSON.stringify(git.commandFailures, null, 2), '');
  }
  return lines.join('\n');
}

function failedClaimsFrom(collectorResults) {
  return collectorResults.flatMap((result) =>
    (result.claims || [])
      .filter((claim) => claim.status === 'failed')
      .map((claim) => ({ ...claim, collector: result.name }))
  );
}

function displayStatusFor(result) {
  return failedClaimsFrom([result]).length > 0 ? 'failed_claim' : result.status;
}

function renderSummary({ runId, phase, startedAt, completedAt, collectorResults }) {
  const counts = collectorResults.reduce(
    (acc, result) => {
      acc[result.status] = (acc[result.status] || 0) + 1;
      return acc;
    },
    { passed: 0, failed: 0, not_measured: 0 }
  );

  const failedClaims = failedClaimsFrom(collectorResults);
  const lines = [
    `# Evidence Run ${runId}`,
    '',
    `- Phase: ${phase}`,
    `- Started: ${startedAt}`,
    `- Completed: ${completedAt}`,
    `- Collectors: ${counts.passed} passed, ${counts.failed} failed, ${counts.not_measured} not measured`,
    `- Failed claims: ${failedClaims.length}`,
    '',
    '## Collector Results',
    '',
  ];

  for (const result of collectorResults) {
    lines.push(`- ${result.name}: ${result.status} - ${result.summary}`);
  }

  if (failedClaims.length > 0) {
    lines.push('', '## Failed Claims', '');
    for (const claim of failedClaims) {
      lines.push(`- ${claim.id} (${claim.collector}): ${claim.statement}`);
    }
  }

  lines.push('', '## Files', '', '- manifest.json', '- environment.json', '- git-status.txt', '- claims.json', '- collectors/*.json', '');
  return lines.join('\n');
}

function retentionFromOptions(options) {
  const kind = String(options.retention || options.retentionKind || 'scratch');
  if (!RETENTION_KINDS.has(kind)) {
    throw new Error(`Invalid retention kind "${kind}". Use one of: ${[...RETENTION_KINDS].join(', ')}.`);
  }
  return {
    kind,
    note: options.retentionNote ? String(options.retentionNote) : null,
  };
}

async function main() {
  const { options } = parseArgs(process.argv.slice(2));
  const phase = String(options.phase || 'local');
  const runId = validateRunId(String(options.runId || defaultRunId()));
  const retention = retentionFromOptions(options);
  const runDir = resolve(repoRoot, 'my-docs/evidence-runs', runId);
  const collectorsDir = resolve(runDir, 'collectors');
  const startedAt = new Date().toISOString();

  await mkdir(collectorsDir, { recursive: true });

  const environment = await collectEnvironment();
  const git = await collectGitStatus();
  await writeJson(resolve(runDir, 'environment.json'), environment);
  await writeFile(resolve(runDir, 'git-status.txt'), renderGitStatus(git));

  const collectorResults = [];
  for (const collect of collectors) {
    const result = await collect({ phase, runId, runDir });
    collectorResults.push(result);
    await writeJson(resolve(collectorsDir, `${result.name}.json`), result);
  }

  const completedAt = new Date().toISOString();
  const claims = collectorResults.flatMap((result) =>
    (result.claims || []).map((claim) => ({
      ...claim,
      collector: result.name,
      evidence: `collectors/${result.name}.json`,
    }))
  );
  const failedClaims = claims.filter((claim) => claim.status === 'failed');
  const manifest = {
    runId,
    phase,
    status:
      collectorResults.some((result) => result.status === 'failed') || failedClaims.length > 0
        ? 'failed'
        : 'completed',
    startedAt,
    completedAt,
    retention,
    root: repoRoot,
    outputDir: repoRelative(runDir),
    files: {
      manifest: 'manifest.json',
      environment: 'environment.json',
      gitStatus: 'git-status.txt',
      summary: 'SUMMARY.md',
      claims: 'claims.json',
    },
    failedClaims: failedClaims.map((claim) => ({
      id: claim.id,
      collector: claim.collector,
      evidence: claim.evidence,
    })),
    collectors: collectorResults.map((result) => ({
      name: result.name,
      status: result.status,
      summary: result.summary,
      output: `collectors/${result.name}.json`,
    })),
  };

  await writeJson(resolve(runDir, 'claims.json'), claims);
  await writeJson(resolve(runDir, 'manifest.json'), manifest);
  await writeFile(resolve(runDir, 'SUMMARY.md'), renderSummary({ runId, phase, startedAt, completedAt, collectorResults }));

  console.log(`Evidence run written to ${repoRelative(runDir)}`);
  for (const result of collectorResults) {
    console.log(`${displayStatusFor(result).padEnd(12)} ${result.name} - ${result.summary}`);
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
