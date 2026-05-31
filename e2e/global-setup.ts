/**
 * Playwright Global Setup
 *
 * Runs once before all tests start. Builds both API and Web so each
 * worker can spawn fresh, lightweight server instances quickly.
 *
 * CRITICAL: We build web upfront so workers can use `vite preview`
 * instead of `vite dev`. This prevents the 90GB memory explosion that
 * occurred when 8 workers each ran full Vite dev servers with HMR.
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

// Get project root (this file is at e2e/global-setup.ts, so go up one level)
const PROJECT_ROOT = path.resolve(__dirname, '..');
const BUILD_ID = process.env.E2E_BUILD_ID;
const BUILD_LOCK_DIR = path.join(PROJECT_ROOT, 'test-results', '.e2e-build-lock');
const BUILD_MARKER = BUILD_ID
  ? path.join(PROJECT_ROOT, 'test-results', `.e2e-build-${BUILD_ID}.done`)
  : null;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function acquireBuildLock() {
  fs.mkdirSync(path.dirname(BUILD_LOCK_DIR), { recursive: true });

  while (true) {
    try {
      fs.mkdirSync(BUILD_LOCK_DIR);
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw error;
      }
      await sleep(1000);
    }
  }
}

function releaseBuildLock() {
  fs.rmSync(BUILD_LOCK_DIR, { recursive: true, force: true });
}

export default async function globalSetup() {
  // Memory check at startup
  const totalMemGB = os.totalmem() / (1024 * 1024 * 1024);
  const freeMemGB = os.freemem() / (1024 * 1024 * 1024);
  console.log(`\n[Memory] Total: ${totalMemGB.toFixed(1)}GB, Available: ${freeMemGB.toFixed(1)}GB`);

  if (freeMemGB < 4) {
    console.warn(`⚠️  WARNING: Low memory (${freeMemGB.toFixed(1)}GB free)`);
    console.warn(`   Consider closing other apps or reducing workers.`);
    console.warn(`   Each worker needs ~500MB (Postgres + API + Preview)`);
  }

  await acquireBuildLock();
  try {
    if (BUILD_MARKER && fs.existsSync(BUILD_MARKER)) {
      console.log('\nE2E build already complete for this shard run.');
    } else {
      console.log('\nBuilding API for tests...');
      try {
        execSync('pnpm build:api', {
          cwd: PROJECT_ROOT,
          stdio: 'inherit',
        });
        console.log('✓ API build complete');
      } catch (error) {
        console.error('Failed to build API:', error);
        throw error;
      }

      console.log('\nBuilding Web for tests (enables lightweight preview servers)...');
      try {
        execSync('pnpm build:web', {
          cwd: PROJECT_ROOT,
          stdio: 'inherit',
          env: { ...process.env, VITE_APP_ENV: 'test_e2e' },
        });
        console.log('✓ Web build complete');
      } catch (error) {
        console.error('Failed to build Web:', error);
        throw error;
      }

      if (BUILD_MARKER) {
        fs.writeFileSync(BUILD_MARKER, new Date().toISOString());
      }
    }
  } finally {
    releaseBuildLock();
  }

  console.log('\n✓ Global setup complete. Starting tests...\n');
}
