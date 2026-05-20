#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const baseUrl = process.env.API_BASE_URL || 'http://localhost:3000';
const email = process.env.BENCHMARK_EMAIL || 'dev@ship.local';
const password = process.env.BENCHMARK_PASSWORD || 'admin123';
const durationMs = Number(process.env.BENCHMARK_DURATION_MS || 15000);
const connections = (process.env.BENCHMARK_CONNECTIONS || '10,25,50')
  .split(',')
  .map((value) => Number(value.trim()))
  .filter((value) => Number.isInteger(value) && value > 0);
const ratePerSecond = Number(process.env.BENCHMARK_RATE_PER_SECOND || 100);
const outputPath = resolve(
  rootDir,
  process.env.BENCHMARK_OUTPUT || `test-results/benchmarks/api-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
);

const endpoints = [
  '/api/documents?type=wiki',
  '/api/issues',
  '/api/dashboard/my-week',
  '/api/projects',
  '/api/bootstrap',
];

function cookieHeaderFrom(headers) {
  const rawCookies = typeof headers.getSetCookie === 'function'
    ? headers.getSetCookie()
    : headers.get('set-cookie')?.split(/,(?=[^ ;]+=)/g) || [];
  return rawCookies.map((cookie) => cookie.split(';')[0]).join('; ');
}

async function jsonRequest(path, options = {}, cookie = '') {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(options.headers || {}),
    },
  });
  return response;
}

async function login() {
  const csrfResponse = await jsonRequest('/api/csrf-token');
  if (!csrfResponse.ok) {
    throw new Error(`CSRF request failed: ${csrfResponse.status}`);
  }

  const csrfCookie = cookieHeaderFrom(csrfResponse.headers);
  const { token } = await csrfResponse.json();
  const loginResponse = await jsonRequest('/api/auth/login', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-csrf-token': token,
    },
    body: JSON.stringify({ email, password }),
  }, csrfCookie);

  if (!loginResponse.ok) {
    throw new Error(`Login failed: ${loginResponse.status} ${await loginResponse.text()}`);
  }

  const loginCookie = cookieHeaderFrom(loginResponse.headers);
  return [csrfCookie, loginCookie].filter(Boolean).join('; ');
}

function percentile(values, p) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[index];
}

async function runEndpoint(endpoint, concurrency, cookie) {
  const latencies = [];
  let requestCount = 0;
  let non2xx = 0;
  let failed = 0;
  let stopped = false;
  const start = performance.now();
  const minDelayMs = ratePerSecond > 0 ? Math.ceil((1000 * concurrency) / ratePerSecond) : 0;

  setTimeout(() => {
    stopped = true;
  }, durationMs);

  async function worker() {
    while (!stopped) {
      const requestStart = performance.now();
      try {
        const response = await jsonRequest(endpoint, {}, cookie);
        const elapsed = performance.now() - requestStart;
        latencies.push(elapsed);
        requestCount++;
        if (response.status < 200 || response.status >= 300) non2xx++;
        await response.arrayBuffer();
      } catch {
        failed++;
      }
      if (minDelayMs > 0) {
        await new Promise((resolveDelay) => setTimeout(resolveDelay, minDelayMs));
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));

  return {
    endpoint,
    concurrency,
    duration_ms: Math.round(performance.now() - start),
    requests: requestCount,
    failures: failed,
    non_2xx: non2xx,
    p50_ms: percentile(latencies, 50),
    p95_ms: percentile(latencies, 95),
    p99_ms: percentile(latencies, 99),
  };
}

const cookie = await login();
const results = [];

for (const endpoint of endpoints) {
  for (const concurrency of connections) {
    results.push(await runEndpoint(endpoint, concurrency, cookie));
  }
}

const report = {
  generated_at: new Date().toISOString(),
  base_url: baseUrl,
  duration_ms: durationMs,
  rate_per_second: ratePerSecond,
  connections,
  endpoints,
  results,
};

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);

const badRows = results.filter((row) => row.failures > 0 || row.non_2xx > 0);
console.log(`API benchmark written to ${outputPath}`);
if (badRows.length > 0) {
  console.error(JSON.stringify(badRows, null, 2));
  process.exit(1);
}
