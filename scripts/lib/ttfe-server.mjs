// Shared Ship API (+ optional web) spawn lifecycle for TTFE and integration drills.
import { spawn } from 'node:child_process';
import process from 'node:process';
import { freePort } from './net.mjs';
import { waitForHttp } from './http-wait.mjs';
import { createTailCollector, onceExit } from './process-utils.mjs';

export async function startShipApi(options) {
  const {
    rootDir,
    databaseUrl,
    includeWeb = false,
    apiReadyPath = '/api/v1/openapi.json',
    webReadyPath = '/oauth/device',
    apiReadyTimeoutMs = 30_000,
    webReadyTimeoutMs = 30_000,
    onApiLog,
    onWebLog,
    tailOnWaitFailure = false,
  } = options;

  const apiPort = await freePort();
  let webPort = null;
  let webUrl = null;
  let webProcess = null;
  const apiUrl = `http://127.0.0.1:${apiPort}`;

  if (includeWeb) {
    webPort = await freePort();
    webUrl = `http://127.0.0.1:${webPort}`;
  }

  const apiTail = tailOnWaitFailure ? createTailCollector() : null;
  const apiProcess = spawn('pnpm', ['--filter', '@ship/api', 'exec', 'tsx', 'src/index.ts'], {
    cwd: rootDir,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      DATABASE_URL: databaseUrl,
      PORT: String(apiPort),
      HOST: '127.0.0.1',
      CORS_ORIGIN: webUrl ?? apiUrl,
      FRONTEND_URL: webUrl ?? apiUrl,
      ...(webUrl ? { WEB_URL: webUrl } : {}),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const writeApiLog = onApiLog ?? ((chunk) => process.stderr.write(`[api] ${chunk}`));
  apiProcess.stdout.on('data', (chunk) => {
    if (apiTail) apiTail.push(chunk);
    writeApiLog(chunk);
  });
  apiProcess.stderr.on('data', (chunk) => {
    if (apiTail) apiTail.push(chunk);
    writeApiLog(chunk);
  });

  try {
    await waitForHttp(`${apiUrl}${apiReadyPath}`, {
      timeoutMs: apiReadyTimeoutMs,
      details: apiTail ? () => apiTail.text() : undefined,
    });

    if (includeWeb && webUrl) {
      webProcess = spawn('pnpm', [
        '--filter',
        '@ship/web',
        'exec',
        'vite',
        '--host',
        '127.0.0.1',
        '--port',
        String(webPort),
      ], {
        cwd: rootDir,
        env: {
          ...process.env,
          API_PORT: String(apiPort),
          VITE_PORT: String(webPort),
          VITE_API_URL: '',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      const writeWebLog = onWebLog ?? ((chunk) => process.stderr.write(`[web] ${chunk}`));
      webProcess.stdout.on('data', writeWebLog);
      webProcess.stderr.on('data', writeWebLog);
      await waitForHttp(`${webUrl}${webReadyPath}`, { timeoutMs: webReadyTimeoutMs });
    }

    return {
      apiUrl,
      webUrl,
      apiPort,
      webPort,
      apiProcess,
      webProcess,
      url: apiUrl,
      close: async () => {
        for (const child of [webProcess, apiProcess]) {
          if (!child) continue;
          child.kill('SIGTERM');
          await onceExit(child, 5_000).catch(() => child.kill('SIGKILL'));
        }
      },
    };
  } catch (error) {
    apiProcess.kill('SIGTERM');
    if (webProcess) webProcess.kill('SIGTERM');
    throw error;
  }
}
