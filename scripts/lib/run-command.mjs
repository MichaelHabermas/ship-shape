// Unified subprocess runner for scripts (spawn, timeout, tail capture, optional throw).
import { spawn, spawnSync } from 'node:child_process';
import process from 'node:process';
import { createTailCollector } from './process-utils.mjs';

export async function runCommand(command, args, options = {}) {
  const startedAt = Date.now();
  const cwd = options.cwd ?? process.cwd();
  const env = options.env ?? process.env;
  const timeoutMs = options.timeoutMs ?? 120_000;
  const throwOnFail = options.throwOnFail !== false;
  const tailChars = options.tailChars ?? null;
  const logCommand = options.logCommand === true;
  const forwardOutput = options.forwardOutput === true;
  const commandLabel = [command, ...args].join(' ');

  if (logCommand) {
    console.log(`$ ${commandLabel}`);
  }

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      shell: false,
      stdio: options.stdio ?? ['ignore', 'pipe', 'pipe'],
    });

    const stdoutCollector = tailChars === null ? null : createTailCollector(tailChars);
    const stderrCollector = tailChars === null ? null : createTailCollector(tailChars);
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let forceKillTimer = null;

    const timeoutTimer = timeoutMs > 0
      ? setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
        forceKillTimer = setTimeout(() => child.kill('SIGKILL'), 5_000);
        forceKillTimer.unref?.();
      }, timeoutMs)
      : null;
    timeoutTimer?.unref?.();

    function append(stream, collector, chunk) {
      const text = chunk.toString();
      if (collector) collector.push(chunk);
      if (stream === 'stdout') stdout += text;
      else stderr += text;
      if (forwardOutput) {
        if (stream === 'stdout') process.stdout.write(chunk);
        else process.stderr.write(chunk);
      }
    }

    child.stdout?.on('data', (chunk) => append('stdout', stdoutCollector, chunk));
    child.stderr?.on('data', (chunk) => append('stderr', stderrCollector, chunk));

    child.on('error', (error) => {
      if (timeoutTimer) clearTimeout(timeoutTimer);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      const result = buildResult({
        command,
        args,
        commandLabel,
        startedAt,
        code: timedOut ? 124 : null,
        signal: null,
        stdout: stdoutCollector?.text() ?? stdout,
        stderr: stderrCollector?.text() ?? stderr,
        timedOut,
        timeoutMs,
        error: timedOut ? `Process timed out after ${timeoutMs}ms` : error.message,
      });
      if (throwOnFail) reject(new Error(formatFailure(result)));
      else resolve(result);
    });

    child.on('close', (code, signal) => {
      if (timeoutTimer) clearTimeout(timeoutTimer);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      const exitCode = timedOut ? 124 : code;
      const result = buildResult({
        command,
        args,
        commandLabel,
        startedAt,
        code: exitCode,
        signal,
        stdout: stdoutCollector?.text() ?? stdout,
        stderr: stderrCollector?.text() ?? stderr,
        timedOut,
        timeoutMs,
        error: timedOut ? `Process timed out after ${timeoutMs}ms` : null,
      });
      if (throwOnFail && exitCode !== 0) {
        reject(new Error(formatFailure(result)));
        return;
      }
      resolve(result);
    });
  });
}

export function runCommandSync(command, args, options = {}) {
  const startedAt = Date.now();
  const cwd = options.cwd ?? process.cwd();
  const env = options.env ?? process.env;
  const result = spawnSync(command, args, {
    cwd,
    env,
    encoding: 'utf8',
    stdio: options.stdio ?? ['ignore', 'pipe', 'pipe'],
  });
  const durationMs = Date.now() - startedAt;
  const code = result.status;
  return {
    ok: code === 0,
    code,
    signal: result.signal,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    durationMs,
    command,
    args,
    commandLabel: [command, ...args].join(' '),
    timedOut: false,
    timeoutMs: null,
    error: code === 0 ? null : `exit ${code}`,
  };
}

function buildResult({
  command,
  args,
  commandLabel,
  startedAt,
  code,
  signal,
  stdout,
  stderr,
  timedOut,
  timeoutMs,
  error,
}) {
  return {
    ok: code === 0,
    code,
    signal,
    stdout,
    stderr,
    durationMs: Date.now() - startedAt,
    command,
    args,
    commandLabel,
    timedOut,
    timeoutMs,
    error,
    exit_code: code,
    duration_ms: Date.now() - startedAt,
    stdout_tail: stdout,
    stderr_tail: stderr,
  };
}

function formatFailure(result) {
  return `${result.commandLabel} failed with exit ${result.code}\n${result.stderr || result.stdout}`;
}
