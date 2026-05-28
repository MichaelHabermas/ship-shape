#!/usr/bin/env node
// Runs FleetGraph proof gates and renders the static reviewer evidence packet.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildProofPacket } from './proof-model.mjs';
import { renderHtml } from './render-html.mjs';
import { renderMarkdown } from './render-markdown.mjs';
import { redactProofValue } from './redact.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '../..');
const outputRoot = path.join(repoRoot, 'my-docs/evidence/fleetgraph-proof');
const runsRoot = path.join(outputRoot, 'runs');

const options = parseArgs(process.argv.slice(2));
const generatedAt = new Date();
const runId = `fleetgraph-proof-${timestampForPath(generatedAt)}`;
const runDir = path.join(runsRoot, runId);

await mkdir(runDir, { recursive: true });

const commandResults = [];
if (!options.noRefreshEvals) {
  commandResults.push(runCommand('product surface eval', ['pnpm', 'fleetgraph:eval:surface']));
}
if (!options.skipTests) {
  commandResults.push(runCommand('shared package build', ['pnpm', 'build:shared']));
  commandResults.push(runCommand('FleetGraph proof tests', [
    'pnpm',
    '--filter',
    '@ship/api',
    'test',
    'src/fleetgraph/eval/eval.test.ts',
    'src/fleetgraph/eval/executable-golden-cases.test.ts',
    'src/fleetgraph/eval/product-surface.test.ts',
    'src/fleetgraph/api-contract.test.ts',
  ], {
    DATABASE_URL: process.env.DATABASE_URL ?? 'postgresql://ship:ship_dev_password@localhost:5432/ship_test_audit',
  }));
}
if (options.withE2e) {
  commandResults.push(runCommand('FleetGraph attention loop E2E', [
    'pnpm',
    'test:e2e:run',
    'e2e/fleetgraph-attention-loop.spec.ts',
  ]));
} else {
  commandResults.push({
    name: 'FleetGraph attention loop E2E',
    command: 'pnpm test:e2e:run e2e/fleetgraph-attention-loop.spec.ts',
    status: 'skipped',
    durationMs: 0,
    note: 'Skipped by default; pass --with-e2e to run the focused browser proof.',
  });
}

const e2ePassed = commandResults.some((result) =>
  result.name === 'FleetGraph attention loop E2E' && result.status === 'pass'
);

const packet = redactProofValue(buildProofPacket({
  generatedAt: generatedAt.toISOString(),
  runId,
  target: options.mode,
  git: gitInfo(),
  goldenCaseIndex: await readGoldenCaseIndex(),
  executedCaseIds: await readExecutableGoldenCaseIds(),
  executedScenarioIds: e2ePassed ? new Set(['context-chat-human-gate', 'source-condition-resolved']) : new Set(),
  productSurface: await readJsonIfExists(path.join(repoRoot, 'my-docs/evals/fleetgraph-product-surface/latest.json')),
  environments: await environmentChecks(options),
  commandResults,
  artifacts: artifactPlan(runId),
}));

const json = `${JSON.stringify(packet, null, 2)}\n`;
const latestHtml = renderHtml(packet, { artifactBase: '../../../' });
const runHtml = renderHtml(packet, { artifactBase: '../../../../../' });
const markdown = renderMarkdown(packet);

await writeFile(path.join(runDir, 'proof.json'), json);
await writeFile(path.join(runDir, 'proof.html'), runHtml);
await writeFile(path.join(runDir, 'proof.md'), markdown);
await writeFile(path.join(outputRoot, 'latest.json'), json);
await writeFile(path.join(outputRoot, 'latest.html'), latestHtml);
await writeFile(path.join(outputRoot, 'latest.md'), markdown);
await copyFile(path.join(runDir, 'proof.json'), path.join(runDir, 'manifest.json'));

console.log(`FleetGraph proof ${packet.verdict}: ${path.relative(repoRoot, path.join(outputRoot, 'latest.html'))}`);
if (packet.risks.length) {
  console.log('Risks:');
  for (const risk of packet.risks) console.log(`- ${risk}`);
}
process.exitCode = packet.verdict === 'fail' ? 1 : 0;

function parseArgs(args) {
  const parsed = {
    mode: 'both',
    noRefreshEvals: false,
    skipTests: false,
    withE2e: false,
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--mode') {
      parsed.mode = args[index + 1] ?? parsed.mode;
      index += 1;
    } else if (arg === '--no-refresh-evals') {
      parsed.noRefreshEvals = true;
    } else if (arg === '--skip-tests') {
      parsed.skipTests = true;
    } else if (arg === '--with-e2e') {
      parsed.withE2e = true;
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
  }
  if (!['local', 'deployed', 'both'].includes(parsed.mode)) {
    throw new Error(`Unsupported --mode ${parsed.mode}; expected local, deployed, or both.`);
  }
  return parsed;
}

function printHelp() {
  console.log(`Usage: pnpm fleetgraph:proof -- [options]

Options:
  --mode local|deployed|both   Evidence target, default both.
  --no-refresh-evals           Read existing product-surface eval instead of regenerating it.
  --skip-tests                 Render packet without running focused FleetGraph API tests.
  --with-e2e                   Run the focused Playwright FleetGraph loop spec.
`);
}

function runCommand(name, command, envExtra = {}) {
  const started = Date.now();
  const [bin, ...args] = command;
  const result = spawnSync(bin, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ...envExtra },
  });
  return {
    name,
    command: command.join(' '),
    status: result.status === 0 ? 'pass' : 'fail',
    durationMs: Date.now() - started,
    stdoutTail: tail(result.stdout),
    stderrTail: tail(result.stderr),
  };
}

async function readGoldenCaseIndex() {
  const source = await readFile(path.join(repoRoot, 'api/src/fleetgraph/eval/golden-cases.ts'), 'utf8');
  const entries = new Map();
  const caseBlocks = source.split(/\n  \{\n/).slice(1);
  for (const block of caseBlocks) {
    const id = match(block, /id: '([^']+)'/);
    if (!id) continue;
    entries.set(id, {
      id,
      title: match(block, /title: '([^']+)'/) ?? id,
      mode: match(block, /mode: '([^']+)'/) ?? 'unknown',
      expectedDecision: match(block, /expectedDecision: '([^']+)'/) ?? 'unknown',
      labels: [...block.matchAll(/'((?:mode|branch|action|evidence|permission|difficulty):[^']+)'/g)].map((item) => item[1]),
    });
  }
  return entries;
}

async function readExecutableGoldenCaseIds() {
  const source = await readFile(path.join(repoRoot, 'api/src/fleetgraph/eval/executable-golden-cases.test.ts'), 'utf8');
  return new Set([...source.matchAll(/requireGoldenCase\('([^']+)'\)/g)].map((item) => item[1]));
}

async function readJsonIfExists(filePath) {
  if (!existsSync(filePath)) return null;
  return JSON.parse(await readFile(filePath, 'utf8'));
}

async function environmentChecks({ mode }) {
  const environments = [];
  if (mode === 'local' || mode === 'both') {
    environments.push({
      id: 'local',
      label: 'Local',
      required: mode !== 'deployed',
      status: 'configured',
      note: process.env.DATABASE_URL
        ? 'DATABASE_URL configured for local proof.'
        : 'Using default disposable ship_test_audit database for local FleetGraph proof tests.',
    });
  }
  if (mode === 'deployed' || mode === 'both') {
    const apiUrl = process.env.FLEETGRAPH_PROOF_API_URL;
    const webUrl = process.env.FLEETGRAPH_PROOF_WEB_URL;
    environments.push({
      id: 'deployed',
      label: 'Deployed',
      required: mode !== 'local',
      status: apiUrl && webUrl ? await deployedStatus(apiUrl, webUrl) : 'blocked',
      note: apiUrl && webUrl
        ? `Configured API and web URLs.`
        : 'Set FLEETGRAPH_PROOF_API_URL and FLEETGRAPH_PROOF_WEB_URL to include deployed proof.',
    });
  }
  return environments;
}

async function deployedStatus(apiUrl, webUrl) {
  const checks = await Promise.allSettled([fetchUrl(apiUrl), fetchUrl(webUrl)]);
  return checks.every((check) => check.status === 'fulfilled') ? 'configured' : 'blocked';
}

async function fetchUrl(url) {
  const response = await fetch(url, { method: 'GET' });
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
}

function artifactPlan(runId) {
  return [
    { label: 'Static dashboard', path: 'my-docs/evidence/fleetgraph-proof/latest.html', kind: 'html' },
    { label: 'Proof JSON', path: 'my-docs/evidence/fleetgraph-proof/latest.json', kind: 'json' },
    { label: 'Proof Markdown', path: 'my-docs/evidence/fleetgraph-proof/latest.md', kind: 'markdown' },
    { label: 'Timestamped run', path: `my-docs/evidence/fleetgraph-proof/runs/${runId}/proof.html`, kind: 'html' },
    { label: 'Golden cases', path: 'api/src/fleetgraph/eval/golden-cases.ts', kind: 'source' },
    { label: 'Executable golden-case tests', path: 'api/src/fleetgraph/eval/executable-golden-cases.test.ts', kind: 'test' },
    { label: 'Product-surface eval', path: 'my-docs/evals/fleetgraph-product-surface/latest.html', kind: 'html' },
    { label: 'Focused E2E spec', path: 'e2e/fleetgraph-attention-loop.spec.ts', kind: 'test' },
  ];
}

function gitInfo() {
  return {
    branch: gitValue(['branch', '--show-current']),
    sha: gitValue(['rev-parse', 'HEAD']),
    dirty: gitValue(['status', '--short', '--untracked-files=all']).length > 0,
  };
}

function gitValue(args) {
  try {
    return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}

function timestampForPath(date) {
  return date.toISOString().replace(/[:.]/g, '-');
}

function match(text, pattern) {
  return pattern.exec(text)?.[1] ?? null;
}

function tail(value, max = 1200) {
  const text = String(value ?? '').trim();
  return text.length > max ? text.slice(-max) : text;
}
