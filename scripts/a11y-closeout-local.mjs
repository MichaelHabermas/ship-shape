#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';

const repoRoot = resolve(import.meta.dirname, '..');
const portsPath = resolve(repoRoot, '.ports');
const databaseUrl =
  process.env.A11Y_DATABASE_URL ||
  process.env.DATABASE_URL ||
  'postgresql://ship:ship_dev_password@localhost:5433/ship_dev';

const forwardedArgs = process.argv.slice(2);
if (forwardedArgs[0] === '--') {
  forwardedArgs.shift();
}

function run(command, args, options = {}) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, {
      cwd: repoRoot,
      env: {
        ...process.env,
        DATABASE_URL: databaseUrl,
        ...options.env,
      },
      stdio: options.stdio ?? 'inherit',
    });

    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (code === 0) {
        resolveRun();
        return;
      }
      reject(new Error(`${command} ${args.join(' ')} failed with ${signal ?? code}`));
    });
  });
}

function startDevServer() {
  const child = spawn('pnpm', ['dev'], {
    cwd: repoRoot,
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
    },
    detached: true,
    stdio: 'inherit',
  });

  child.on('error', (error) => {
    console.error(error);
  });

  return child;
}

async function stopDevServer(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  try {
    process.kill(-child.pid, 'SIGINT');
  } catch {
    child.kill('SIGINT');
  }

  await new Promise((resolveStop) => {
    const timeout = setTimeout(() => {
      try {
        process.kill(-child.pid, 'SIGTERM');
      } catch {
        child.kill('SIGTERM');
      }
      resolveStop();
    }, 8_000);
    child.once('exit', () => {
      clearTimeout(timeout);
      resolveStop();
    });
  });
}

async function waitForPorts(startedAt) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (existsSync(portsPath)) {
      const statFreshEnough = await readFile(portsPath, 'utf8');
      const startedMatch = statFreshEnough.match(/^STARTED=(.+)$/m);
      const started = startedMatch ? Date.parse(startedMatch[1]) : Date.now();
      if (!Number.isNaN(started) && started >= startedAt - 1_000) {
        return statFreshEnough;
      }
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 500));
  }

  throw new Error('Timed out waiting for dev server .ports file');
}

async function waitForUrl(url) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok || response.status < 500) {
        return;
      }
    } catch {
      // Server is still starting.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 500));
  }

  throw new Error(`Timed out waiting for ${url}`);
}

async function main() {
  console.log('Starting ShipShape local PostgreSQL...');
  await run('docker', ['compose', '-f', 'docker-compose.local.yml', 'up', '-d', 'postgres']);

  console.log('Migrating local accessibility database...');
  await run('pnpm', ['--filter', '@ship/api', 'db:migrate']);

  console.log('Seeding local accessibility database...');
  await run('pnpm', ['--filter', '@ship/api', 'db:seed']);

  await rm(portsPath, { force: true });
  const startedAt = Date.now();
  const devServer = startDevServer();

  try {
    const ports = await waitForPorts(startedAt);
    const webPort = ports.match(/^WEB=(\d+)$/m)?.[1];
    const apiPort = ports.match(/^API=(\d+)$/m)?.[1];
    if (!webPort || !apiPort) {
      throw new Error(`Could not read API/WEB ports from ${portsPath}`);
    }

    await waitForUrl(`http://localhost:${apiPort}/health`);
    await waitForUrl(`http://localhost:${webPort}/login`);

    console.log(`Running Cat 7 axe closeout against http://localhost:${webPort}...`);
    await run('pnpm', ['a11y:closeout', '--', ...forwardedArgs], {
      env: {
        WEB_BASE_URL: `http://localhost:${webPort}`,
      },
    });
  } finally {
    await stopDevServer(devServer);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
