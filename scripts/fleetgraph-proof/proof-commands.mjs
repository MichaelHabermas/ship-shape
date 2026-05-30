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
  return 'postgresql://ship:ship_dev_password@localhost:5432/ship_test_audit';
}

export function runCommand(name, command, envExtra = {}) {
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

export function tail(value, max = 1200) {
  const text = String(value ?? '').trim();
  return text.length > max ? text.slice(-max) : text;
}
