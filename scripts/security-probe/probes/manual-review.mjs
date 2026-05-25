import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { repoRoot } from '../../../packages/shipshape-security/src/core/cli.mjs';
import { fail, finding, pass } from '../../../packages/shipshape-security/src/core/result-model.mjs';
import { runSelectedProbes } from '../../../packages/shipshape-security/src/core/probe-selection.mjs';

export async function manualReviewProbes(context) {
  return runSelectedProbes(context, [
    { id: 'manual-cors-csp', name: 'Assisted CORS/CSP review', run: corsCsp },
    { id: 'manual-secrets', name: 'Assisted secret exposure review', run: secrets },
    { id: 'manual-rate-limits', name: 'Assisted rate limit review', run: rateLimits },
    { id: 'manual-verbose-errors', name: 'Assisted verbose error leakage review', run: verboseErrors },
  ]);
}

async function corsCsp({ clients }) {
  const health = await clients.admin.request('/health', { headers: { origin: 'https://attacker.example' } });
  const csp = health.headers.get('content-security-policy') || '';
  const acao = health.headers.get('access-control-allow-origin') || '';
  const details = { csp, accessControlAllowOrigin: acao || null };
  if (acao === '*' && health.headers.get('access-control-allow-credentials') === 'true') {
    return fail('manual-cors-csp', 'Assisted CORS/CSP review', finding({
      id: 'cat8-manual-cors-wildcard-credentials',
      probeId: 'manual-cors-csp',
      title: 'CORS allows wildcard origin with credentials',
      severity: 'high',
      category: 'configuration',
      expected: 'Credentialed API responses do not use wildcard ACAO.',
      observed: 'Access-Control-Allow-Origin was * with credentials enabled.',
      evidence: { reproduction: ['Run pnpm security:probe -- --probe manual-cors-csp'] },
    }));
  }
  return pass('manual-cors-csp', 'Assisted CORS/CSP review', details);
}

async function secrets() {
  const files = [
    'api/src/config/ssm.ts',
    'api/src/services/secrets-manager.ts',
    'web/src/api/client.ts',
    'web/src/pages/Login.tsx',
  ];
  const hits = [];
  for (const file of files) {
    const path = resolve(repoRoot, file);
    if (!existsSync(path)) continue;
    const text = readFileSync(path, 'utf8');
    if (/VITE_.*(SECRET|TOKEN|PASSWORD|DATABASE_URL)|SESSION_SECRET.*import\.meta\.env/i.test(text)) hits.push(file);
  }
  if (hits.length === 0) return pass('manual-secrets', 'Assisted secret exposure review', { inspected: files, suspiciousClientEnvUsage: hits });
  return fail('manual-secrets', 'Assisted secret exposure review', finding({
    id: 'cat8-manual-client-secret-env-usage',
    probeId: 'manual-secrets',
    title: 'Client-visible environment variable pattern may expose secrets',
    severity: 'high',
    category: 'configuration',
    expected: 'Client bundle code does not reference VITE_* secret, token, password, or database URL values.',
    observed: `Suspicious client env pattern(s) found in ${hits.join(', ')}.`,
    evidence: { reproduction: ['Run pnpm security:probe -- --probe manual-secrets'] },
  }));
}

async function rateLimits({ config }) {
  const app = readFileSync(resolve(repoRoot, 'api/src/app.ts'), 'utf8');
  const collab = readFileSync(resolve(repoRoot, 'api/src/collaboration/index.ts'), 'utf8');
  const details = {
    apiLimiter: /apiLimiter/.test(app),
    loginLimiter: /loginLimiter/.test(app),
    websocketConnectionLimiter: /MAX_CONNECTIONS_PER_IP/.test(collab),
    websocketMessageLimiter: /MAX_MESSAGES_PER_SECOND/.test(collab),
  };
  const staticOk = Object.values(details).every(Boolean);
  if (staticOk) {
    return pass('manual-rate-limits', 'Assisted rate limit review', details);
  }
  return fail('manual-rate-limits', 'Assisted rate limit review', finding({
    id: 'cat8-manual-rate-limit-gap',
    probeId: 'manual-rate-limits',
    title: 'Expected API or WebSocket rate-limit marker was absent',
    severity: 'medium',
    category: 'rate-limit',
    expected: 'API, login, WebSocket connection, and WebSocket message limiters are present.',
    observed: JSON.stringify(details),
    evidence: { reproduction: ['Run pnpm security:probe -- --probe manual-rate-limits'] },
  }));
}

async function verboseErrors({ clients }) {
  const badUuid = await clients.admin.api('/api/files/not-a-uuid/serve');
  const badJson = await clients.admin.request('/api/documents', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-csrf-token': clients.admin.csrfToken || '' },
    body: '{"broken":',
  });
  const text = `${badUuid.text}\n${badJson.text}`;
  if (/stack|node_modules|\/Users\/|syntax error at or near|DATABASE_URL/i.test(text)) {
    return fail('manual-verbose-errors', 'Assisted verbose error leakage review', finding({
      id: 'cat8-manual-verbose-error-leakage',
      probeId: 'manual-verbose-errors',
      title: 'Malformed request leaked verbose internals',
      severity: 'medium',
      category: 'configuration',
      expected: 'Malformed requests do not expose stack traces, SQL, filesystem paths, or secrets.',
      observed: 'Response matched verbose leakage pattern.',
      evidence: { reproduction: ['Run pnpm security:probe -- --probe manual-verbose-errors'] },
    }));
  }
  return pass('manual-verbose-errors', 'Assisted verbose error leakage review');
}
