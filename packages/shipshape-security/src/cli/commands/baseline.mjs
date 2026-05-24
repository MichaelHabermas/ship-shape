import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { repoRoot } from '../../core/paths.mjs';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

function runNodeScript(scriptName) {
  return new Promise((resolvePromise, reject) => {
    const scriptPath = resolve(packageRoot, 'src/core', scriptName);
    const child = spawn(process.execPath, [scriptPath], {
      cwd: repoRoot,
      stdio: 'inherit',
      env: process.env,
    });
    child.on('exit', (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`${scriptName} exited with ${code}`));
    });
  });
}

function runRepoScript(relPath) {
  return new Promise((resolvePromise, reject) => {
    const scriptPath = resolve(repoRoot, relPath);
    const child = spawn(scriptPath, [], {
      cwd: repoRoot,
      stdio: 'inherit',
      env: process.env,
      shell: true,
    });
    child.on('exit', (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`${relPath} exited with ${code}`));
    });
  });
}

export async function runBaselineCommand(subcommand) {
  switch (subcommand) {
    case 'deps':
      await runRepoScript('scripts/security-probe/run-baseline-measurements.sh');
      break;
    case 'deliverable':
      await runNodeScript('build-cat8-deliverable.mjs');
      await runNodeScript('sync-cat8-ledger.mjs');
      break;
    default:
      console.log(`shipshape-security baseline

  deps         pnpm audit before/after baselines
  deliverable  rebuild cat8-audit-deliverable.json + sync submission ledger`);
      process.exit(subcommand ? 1 : 0);
  }
}
