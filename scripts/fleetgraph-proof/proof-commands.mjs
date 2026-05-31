// FleetGraph proof CLI command parsing and subprocess execution helpers.
import { spawnSync } from 'node:child_process';
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
  const defaultUrl = 'postgresql://ship:ship_dev_password@localhost:5432/ship_test_audit';
  if (postgresReady('localhost', '5432')) return defaultUrl;
  if (postgresReady('localhost', '5433')) {
    console.log('FleetGraph proof: local Postgres is listening on 5433; using Docker test database port.');
    return 'postgresql://ship:ship_dev_password@localhost:5433/ship_test_audit';
  }
  return defaultUrl;
}

export function runCommand(name, command, envExtra = {}) {
  const started = Date.now();
  const [bin, ...args] = command;
  console.log(`FleetGraph proof: starting ${name}...`);
  const result = spawnSync(bin, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ...envExtra },
  });
  const durationMs = Date.now() - started;
  const status = result.status === 0 ? 'pass' : 'fail';
  console.log(`FleetGraph proof: ${name} ${status} in ${formatDuration(durationMs)}.`);
  return {
    name,
    command: command.join(' '),
    status,
    durationMs,
    stdoutTail: tail(result.stdout),
    stderrTail: tail(result.stderr),
  };
}

export function tail(value, max = 1200) {
  const text = String(value ?? '').trim();
  return text.length > max ? text.slice(-max) : text;
}

function formatDuration(ms) {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function postgresReady(host, port) {
  const result = spawnSync('pg_isready', ['-h', host, '-p', port], {
    encoding: 'utf8',
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  return result.status === 0;
}
