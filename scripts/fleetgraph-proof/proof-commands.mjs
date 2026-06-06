// FleetGraph proof CLI command parsing and subprocess execution helpers.
import { execFileSync } from 'node:child_process';
import { runCommandSync } from '../lib/run-command.mjs';
import { repoRoot } from './proof-repo.mjs';

export function parseArgs(args) {
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

export function printHelp() {
  console.log(`Usage: pnpm fleetgraph:proof -- [options]

Options:
  --mode local|deployed|both   Evidence target, default both.
  --no-refresh-evals           Read existing product-surface eval instead of regenerating it.
  --skip-tests                 Render packet without running focused FleetGraph API tests.
  --with-e2e                   Run the focused Playwright FleetGraph loop spec.
`);
}

export function proofTestDatabaseUrl() {
  if (process.env.FLEETGRAPH_PROOF_TEST_DATABASE_URL) return process.env.FLEETGRAPH_PROOF_TEST_DATABASE_URL;
  return execFileSync('bash', ['scripts/resolve-database-url.sh', 'ship_test_audit'], {
    cwd: repoRoot,
    encoding: 'utf8',
  }).trim();
}

export function runCommand(name, command, envExtra = {}) {
  const [bin, ...args] = command;
  console.log(`FleetGraph proof: starting ${name}...`);
  const result = runCommandSync(bin, args, {
    cwd: repoRoot,
    env: { ...process.env, ...envExtra },
  });
  const status = result.ok ? 'pass' : 'fail';
  console.log(`FleetGraph proof: ${name} ${status} in ${formatDuration(result.durationMs)}.`);
  return {
    name,
    command: command.join(' '),
    status,
    durationMs: result.durationMs,
    stdoutTail: tail(result.stdout),
    stderrTail: tail(result.stderr),
  };
}

export function tail(value, max = 1200) {
  const text = String(value ?? '').trim();
  const trimmed = text.length > max ? text.slice(-max) : text;
  return scrubVolatileArtifactPaths(trimmed);
}

function scrubVolatileArtifactPaths(text) {
  return text
    .replaceAll(
      /my-docs\/evals\/fleetgraph-product-surface\/runs\/[^\s"')]+/g,
      'my-docs/evals/fleetgraph-product-surface/latest.*'
    )
    .replaceAll(
      /my-docs\/evidence\/fleetgraph-proof\/runs\/[^\s"')]+/g,
      'my-docs/evidence/fleetgraph-proof/latest.*'
    );
}

function formatDuration(ms) {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

