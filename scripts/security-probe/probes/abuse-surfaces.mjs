import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fail, finding, pass, skip } from '../../../packages/shipshape-security/src/core/result-model.mjs';
import { runSelectedProbes } from '../../../packages/shipshape-security/src/core/probe-selection.mjs';
import { fingerprintForFinding } from '../../../packages/shipshape-security/src/core/finding-registry.mjs';
import { ProbeHttpClient } from '../../../packages/shipshape-security/src/core/http-client.mjs';
import { repoRoot } from '../../../packages/shipshape-security/src/core/cli.mjs';

export async function abuseSurfaceProbes(context) {
  return runSelectedProbes(context, [
    { id: 'abuse-login-rate-limit', name: 'Login endpoint rate limits burst attempts', run: loginRateLimit },
    { id: 'abuse-public-feedback-rate-limit', name: 'Public feedback endpoint resists burst submissions', run: publicFeedbackRateLimit },
  ]);
}

async function loginRateLimit({ config }) {
  const appSource = readFileSync(resolve(repoRoot, 'api/src/app.ts'), 'utf8');
  const hasLoginLimiter = /loginLimiter/.test(appSource) && /skipSuccessfulRequests:\s*true/.test(appSource);
  if (!hasLoginLimiter) {
    return fail('abuse-login-rate-limit', 'Login endpoint rate limits burst attempts', finding({
      id: 'probe-login-rate-limit-absent',
      probeId: 'abuse-login-rate-limit',
      title: 'Login rate limiter not configured in app.ts',
      severity: 'medium',
      category: 'rate-limit',
      fingerprint: fingerprintForFinding('abuse-login-rate-limit', 'probe-login-rate-limit-absent'),
      expected: 'loginLimiter with skipSuccessfulRequests exists in api/src/app.ts.',
      observed: 'loginLimiter marker missing.',
      evidence: { reproduction: ['pnpm security:probe -- --probe abuse-login-rate-limit'] },
    }));
  }
  const isolated = config.probe === 'abuse-login-rate-limit' || config.probe === 'abuse';
  if (!isolated) {
    return pass('abuse-login-rate-limit', 'Login endpoint rate limits burst attempts', {
      mode: 'static-only',
      note: 'Live login burst skipped in full runs to avoid locking out seeded admin login.',
    });
  }
  const burst = 6;
  const client = new ProbeHttpClient(config.apiUrl);
  let saw429 = false;
  let lastStatus = 0;
  for (let index = 0; index < burst; index++) {
    await client.csrf();
    const result = await client.request('/api/auth/login', {
      method: 'POST',
      headers: client.csrfToken ? { 'x-csrf-token': client.csrfToken } : {},
      body: { email: 'probe-rate-limit@ship.local', password: 'wrong-password' },
    });
    lastStatus = result.status;
    if (result.status === 429) {
      saw429 = true;
      break;
    }
  }
  if (saw429) return pass('abuse-login-rate-limit', 'Login endpoint rate limits burst attempts', { burst, lastStatus, mode: 'live' });
  return fail('abuse-login-rate-limit', 'Login endpoint rate limits burst attempts', finding({
    id: 'probe-login-rate-limit-absent',
    probeId: 'abuse-login-rate-limit',
    title: 'Login endpoint did not return 429 during burst',
    severity: 'medium',
    category: 'rate-limit',
    fingerprint: fingerprintForFinding('abuse-login-rate-limit', 'probe-login-rate-limit-absent'),
    expected: `After ${burst} failed login attempts, API returns 429.`,
    observed: `Last status HTTP ${lastStatus}, no 429 observed.`,
    evidence: { reproduction: ['pnpm security:probe -- --probe abuse-login-rate-limit'] },
  }));
}

async function publicFeedbackRateLimit({ config, clients }) {
  const { pickProgram } = await import('../../../packages/shipshape-security/src/core/fixtures.mjs');
  const program = await pickProgram(clients.admin);
  await clients.admin.api(`/api/documents/${program.id}`, {
    method: 'PATCH',
    body: { properties: { public_feedback_enabled: true } },
  });
  const burst = Math.max(config.maxBurst || 20, 15);
  let saw429 = false;
  let lastStatus = 0;
  for (let index = 0; index < burst; index++) {
    const result = await fetch(`${config.apiUrl}/api/feedback`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        program_id: program.id,
        title: `probe burst ${index}`,
      }),
    });
    lastStatus = result.status;
    if (result.status === 429) {
      saw429 = true;
      break;
    }
  }
  if (saw429) return pass('abuse-public-feedback-rate-limit', 'Public feedback endpoint resists burst submissions', { burst, lastStatus });
  return fail('abuse-public-feedback-rate-limit', 'Public feedback endpoint resists burst submissions', finding({
    id: 'probe-public-feedback-rate-limit',
    probeId: 'abuse-public-feedback-rate-limit',
    title: 'Public feedback endpoint lacks burst rate limiting',
    severity: 'medium',
    ledgerId: 'SS-FIND-012',
    category: 'rate-limit',
    fingerprint: fingerprintForFinding('abuse-public-feedback-rate-limit', 'probe-public-feedback-rate-limit'),
    expected: `After ${burst} submissions, public feedback returns 429.`,
    observed: `Last status HTTP ${lastStatus}, no 429 observed.`,
    evidence: { reproduction: ['pnpm security:probe -- --probe abuse-public-feedback-rate-limit'] },
  }));
}
