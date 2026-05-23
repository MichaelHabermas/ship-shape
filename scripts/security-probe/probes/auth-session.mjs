import { ProbeHttpClient } from '../lib/http-client.mjs';
import { fail, finding, pass } from '../lib/result-model.mjs';
import { runSelectedProbes } from '../lib/probe-selection.mjs';

export async function authSessionProbes(context) {
  return runSelectedProbes(context, [
    { id: 'auth-session-unauthenticated-api', name: 'Unauthenticated protected API access rejected', run: unauthenticatedApi },
    { id: 'auth-session-invalid-bearer', name: 'Invalid bearer token rejected', run: invalidBearer },
    { id: 'auth-session-cookie-flags', name: 'Session cookie has hardened local flags', run: sessionCookieFlags },
    { id: 'auth-session-cookie-shape-expiry', name: 'Session cookie has strong shape and browser expiry', run: sessionCookieShapeExpiry },
    { id: 'auth-session-csrf-mutating-request', name: 'CSRF blocks mutating cookie request without token', run: csrfMutatingRequest },
    { id: 'auth-session-api-token-super-admin-boundary', name: 'API tokens cannot access super-admin routes', run: apiTokenSuperAdminBoundary, requiresWrite: true },
  ]);
}

async function unauthenticatedApi({ config }) {
  const client = new ProbeHttpClient(config.apiUrl);
  const checks = await Promise.all(['/api/documents', '/api/bootstrap', '/api/dashboard/my-week'].map((path) => client.request(path)));
  const bad = checks.filter((result) => result.status !== 401);
  if (bad.length === 0) return pass('auth-session-unauthenticated-api', 'Unauthenticated protected API access rejected');
  return fail('auth-session-unauthenticated-api', 'Unauthenticated protected API access rejected', finding({
    id: 'cat8-auth-unauthenticated-api',
    probeId: 'auth-session-unauthenticated-api',
    title: 'Protected API route allowed unauthenticated access',
    severity: 'high',
    category: 'auth-session',
    expected: 'Protected API routes return 401 without a session or bearer token.',
    observed: `${bad.length} protected route(s) did not return 401.`,
    evidence: { reproduction: ['Run pnpm security:probe -- --probe auth-session-unauthenticated-api'] },
    fixCandidate: 'Ensure protected routes mount authMiddleware before handlers.',
  }));
}

async function invalidBearer({ config }) {
  const client = new ProbeHttpClient(config.apiUrl);
  const result = await client.request('/api/documents', { headers: { authorization: 'Bearer ship_invalid' } });
  if (result.status === 401) return pass('auth-session-invalid-bearer', 'Invalid bearer token rejected');
  return fail('auth-session-invalid-bearer', 'Invalid bearer token rejected', finding({
    id: 'cat8-auth-invalid-bearer',
    probeId: 'auth-session-invalid-bearer',
    title: 'Invalid API token was not rejected',
    severity: 'high',
    category: 'auth-session',
    affected: { endpoint: '/api/documents' },
    expected: 'Invalid bearer tokens return 401.',
    observed: `Received HTTP ${result.status}.`,
    evidence: { reproduction: ['Run pnpm security:probe -- --probe auth-session-invalid-bearer'] },
  }));
}

async function sessionCookieFlags({ clients }) {
  const login = clients.admin.lastLogin;
  const cookie = login?.setCookie?.find((value) => value.startsWith('session_id='));
  const hasHttpOnly = /;\s*HttpOnly/i.test(cookie || '');
  const hasSameSite = /;\s*SameSite=/i.test(cookie || '');
  if (cookie && hasHttpOnly && hasSameSite) return pass('auth-session-cookie-flags', 'Session cookie has hardened local flags', { setCookie: '[redacted]' });
  return fail('auth-session-cookie-flags', 'Session cookie has hardened local flags', finding({
    id: 'cat8-auth-session-cookie-flags',
    probeId: 'auth-session-cookie-flags',
    title: 'Session cookie missing expected security flags',
    severity: 'medium',
    category: 'auth-session',
    expected: 'session_id cookie includes HttpOnly and SameSite.',
    observed: cookie ? 'Cookie exists but expected flags are missing.' : 'No session_id cookie was set.',
    evidence: { reproduction: ['Run pnpm security:probe -- --probe auth-session-cookie-flags'] },
  }));
}

async function sessionCookieShapeExpiry({ clients }) {
  const login = clients.admin.lastLogin;
  const cookie = login?.setCookie?.find((value) => value.startsWith('session_id='));
  const value = cookie?.match(/^session_id=([^;]+)/)?.[1] || '';
  const hasStrongShape = /^[a-f0-9]{64}$/i.test(value);
  const hasExpiry = /;\s*(Max-Age|Expires)=/i.test(cookie || '');
  if (hasStrongShape && hasExpiry) return pass('auth-session-cookie-shape-expiry', 'Session cookie has strong shape and browser expiry', { sessionIdLength: value.length, hasExpiry: true });
  return fail('auth-session-cookie-shape-expiry', 'Session cookie has strong shape and browser expiry', finding({
    id: 'cat8-auth-session-cookie-shape-expiry',
    probeId: 'auth-session-cookie-shape-expiry',
    title: 'Session cookie missing strong local shape or browser expiry',
    severity: 'medium',
    category: 'auth-session',
    expected: 'session_id is a 64-character random hex token and Set-Cookie includes Max-Age or Expires.',
    observed: `length=${value.length}, hasExpiry=${hasExpiry}`,
    evidence: { reproduction: ['Run pnpm security:probe -- --probe auth-session-cookie-shape-expiry'] },
  }));
}

async function csrfMutatingRequest({ config, clients }) {
  const client = new ProbeHttpClient(config.apiUrl);
  client.cookies = new Map(clients.admin.cookies);
  const result = await client.request('/api/documents', {
    method: 'POST',
    body: { title: 'csrf probe', document_type: 'wiki' },
  });
  if (result.status === 403) return pass('auth-session-csrf-mutating-request', 'CSRF blocks mutating cookie request without token');
  return fail('auth-session-csrf-mutating-request', 'CSRF blocks mutating cookie request without token', finding({
    id: 'cat8-auth-csrf-missing',
    probeId: 'auth-session-csrf-mutating-request',
    title: 'Mutating session-cookie request did not require CSRF token',
    severity: 'high',
    category: 'csrf',
    affected: { endpoint: '/api/documents' },
    expected: 'POST with cookie auth and no X-CSRF-Token returns 403.',
    observed: `Received HTTP ${result.status}.`,
    evidence: { reproduction: ['Run pnpm security:probe -- --probe auth-session-csrf-mutating-request'] },
  }));
}

async function apiTokenSuperAdminBoundary({ clients, config }) {
  const create = await clients.admin.api('/api/api-tokens', {
    method: 'POST',
    body: { name: `cat8-${config.runId}-${Date.now()}`, expires_in_days: 1 },
  });
  const token = create.json?.data?.token;
  if (!token) {
    return fail('auth-session-api-token-super-admin-boundary', 'API tokens cannot access super-admin routes', finding({
      id: 'cat8-auth-token-create-failed',
      probeId: 'auth-session-api-token-super-admin-boundary',
      title: 'Probe could not create API token for privilege-boundary check',
      severity: 'low',
      category: 'auth-session',
      expected: 'Probe can create a short-lived API token.',
      observed: `Token creation returned HTTP ${create.status}.`,
      evidence: { reproduction: ['Run pnpm security:probe -- --probe auth-session-api-token-super-admin-boundary'] },
    }));
  }
  const result = await clients.admin.request('/api/admin/credentials/status', {
    headers: { authorization: `Bearer ${token}` },
  });
  if (result.status === 403) return pass('auth-session-api-token-super-admin-boundary', 'API tokens cannot access super-admin routes');
  return fail('auth-session-api-token-super-admin-boundary', 'API tokens cannot access super-admin routes', finding({
    id: 'cat8-auth-api-token-super-admin',
    probeId: 'auth-session-api-token-super-admin-boundary',
    title: 'API token could access a super-admin route',
    severity: 'high',
    category: 'authorization',
    affected: { endpoint: '/api/admin/credentials/status' },
    expected: 'Bearer API tokens are denied from super-admin-only routes.',
    observed: `Super-admin route returned HTTP ${result.status} for a bearer token.`,
    evidence: { reproduction: ['Log in as seeded admin.', 'Create an API token.', 'GET /api/admin/credentials/status with Authorization: Bearer <token>.'] },
    fixCandidate: 'Reject req.isApiToken inside superAdminMiddleware unless scoped token support exists.',
  }));
}
