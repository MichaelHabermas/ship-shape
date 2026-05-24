import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

export function shipshapeSecurityBin() {
  return resolve(packageRoot, 'bin/shipshape-security.mjs');
}

export function securityCiScriptPath() {
  return resolve(packageRoot, 'scripts/run-ci.sh');
}

/**
 * Spawn a child process and invoke onLine for each stdout/stderr line.
 * @returns {Promise<{ exitCode: number }>}
 */
export function streamSpawn(command, args, options, onLine) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let buffer = '';
    const feed = (chunk) => {
      buffer += chunk.toString();
      const parts = buffer.split(/\r?\n/);
      buffer = parts.pop() ?? '';
      for (const line of parts) {
        if (line.length) onLine(line);
      }
    };

    child.stdout.on('data', feed);
    child.stderr.on('data', feed);
    child.on('error', reject);
    child.on('close', (code) => {
      if (buffer.trim()) onLine(buffer);
      resolvePromise({ exitCode: code ?? 1 });
    });
  });
}

export const RUN_MODES = new Set(['run', 'check', 'ci']);

export function jobTitleForMode(mode) {
  if (mode === 'check') return 'Findings check';
  if (mode === 'ci') return 'CI gate';
  return 'Security probe';
}

/**
 * @param {'run'|'check'|'ci'} mode
 * @param {{ cat8Perimeter?: boolean, cwd?: string, env?: NodeJS.ProcessEnv }} options
 * @param {(line: string) => void} onLine
 */
export async function runConsoleJob(mode, options, onLine) {
  const cwd = options.cwd;
  const env = options.env ?? process.env;
  const node = process.execPath;
  const bin = shipshapeSecurityBin();

  if (mode === 'check') {
    onLine('Running security findings check…');
    const { exitCode } = await streamSpawn(node, [bin, 'findings', 'check'], { cwd, env }, onLine);
    return { ok: exitCode === 0, exitCode, title: jobTitleForMode(mode) };
  }

  if (mode === 'ci') {
    onLine('Starting CI gate (run-ci.sh)…');
    const script = securityCiScriptPath();
    const { exitCode } = await streamSpawn('bash', [script], { cwd, env: { ...env, CI: 'true' } }, onLine);
    return { ok: exitCode === 0, exitCode, title: jobTitleForMode(mode) };
  }

  const argv = [bin, 'run', '--record-verifications'];
  if (options.cat8Perimeter) argv.push('--cat8-perimeter');
  onLine(`Starting probe (${argv.slice(1).join(' ')})…`);
  const { exitCode } = await streamSpawn(node, argv, { cwd, env }, onLine);
  if (exitCode === 0) {
    onLine('Probe finished. Refresh the dashboard to load updated evidence.');
  }
  return { ok: exitCode === 0, exitCode, title: jobTitleForMode(mode) };
}
