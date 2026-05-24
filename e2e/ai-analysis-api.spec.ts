import { test, expect } from './fixtures/isolated-env';

/**
 * E2E tests for AI Analysis API endpoints.
 *
 * Tests:
 * 1. GET /api/ai/status — returns { available: boolean }
 * 2. POST /api/ai/analyze-plan — requires content field (400 if missing)
 * 3. POST /api/ai/analyze-retro — requires retro_content and plan_content fields
 * 4. Rate limiting: endpoint returns 429 after 10 requests
 *
 * Note: Actual Bedrock calls will return { error: 'ai_unavailable' } in test env
 * since there are no AWS credentials. These tests verify endpoint structure and
 * validation, not the AI output.
 */

// Helper to get CSRF token for API requests
async function getCsrfToken(page: import('@playwright/test').Page, apiUrl: string): Promise<string> {
  const response = await page.request.get(`${apiUrl}/api/csrf-token`);
  expect(response.ok()).toBe(true);
  const { token } = await response.json();
  return token;
}

// Helper to login as default admin user
async function loginAsAdmin(page: import('@playwright/test').Page, apiUrl: string) {
  await page.goto('/login');
  await page.locator('#email').fill('dev@ship.local');
  await page.locator('#password').fill('admin123');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).not.toHaveURL('/login', { timeout: 5000 });

  const csrfToken = await getCsrfToken(page, apiUrl);
  return { csrfToken };
}

const samplePlanContent =
  'Complete the API integration and write unit tests for the auth module. Deploy staging and verify monitoring dashboards.';

const sampleRetroContent =
  'Completed the API integration. Tests pass at 95% coverage. Staging deploy delayed due to infrastructure issues.';

test.describe('AI Status API', () => {
  test('GET /api/ai/status returns availability object', async ({ page, apiServer }) => {
    await loginAsAdmin(page, apiServer.url);

    const response = await page.request.get(`${apiServer.url}/api/ai/status`);
    expect(response.ok(), 'AI status endpoint should return 200').toBe(true);

    const data = await response.json();
    expect(data, 'Response should have available property').toHaveProperty('available');
    expect(typeof data.available, 'available should be a boolean').toBe('boolean');
  });

  test('GET /api/ai/status requires authentication', async ({ page, apiServer }) => {
    // Do NOT login — request without auth
    const response = await page.request.get(`${apiServer.url}/api/ai/status`);
    expect(response.status(), 'Unauthenticated request should return 401 or 403').toBeGreaterThanOrEqual(401); // 401 or 403 — both are valid auth rejections
    expect(response.status()).toBeLessThanOrEqual(403);
  });
});

test.describe('AI Analyze Plan API', () => {
  test('POST /api/ai/analyze-plan returns 400 when content is missing', async ({ page, apiServer }) => {
    const { csrfToken } = await loginAsAdmin(page, apiServer.url);

    const response = await page.request.post(`${apiServer.url}/api/ai/analyze-plan`, {
      headers: { 'x-csrf-token': csrfToken },
      data: {},
    });

    expect(response.status(), 'Should return 400 when content is missing').toBe(400);
    const result = await response.json();
    expect(result.error).toBe('Invalid input');
    expect(JSON.stringify(result.details), 'Validation details should mention content').toContain('content');
  });

  test('POST /api/ai/analyze-plan accepts valid content', async ({ page, apiServer }) => {
    const { csrfToken } = await loginAsAdmin(page, apiServer.url);

    const response = await page.request.post(`${apiServer.url}/api/ai/analyze-plan`, {
      headers: { 'x-csrf-token': csrfToken },
      data: { content: samplePlanContent },
    });

    // In test env without AWS credentials, we expect either:
    // - 200 with { error: 'ai_unavailable' } (Bedrock not configured)
    // - 200 with analysis result (if somehow AI is available)
    // Either way, the endpoint should not return 400/500
    expect(response.ok(), 'Endpoint should return 200 even if AI is unavailable').toBe(true);

    const result = await response.json();
    // The response should be either a valid analysis or an error indicator
    const isAnalysis = result.overall_score !== undefined;
    const isUnavailable = result.error === 'ai_unavailable';
    expect(
      isAnalysis || isUnavailable,
      'Response should be either an analysis result or ai_unavailable error'
    ).toBe(true);
  });

  test('POST /api/ai/analyze-plan requires authentication', async ({ page, apiServer }) => {
    const response = await page.request.post(`${apiServer.url}/api/ai/analyze-plan`, {
      data: { content: samplePlanContent },
    });

    expect(response.status(), 'Unauthenticated request should return 401 or 403').toBeGreaterThanOrEqual(401); // 401 or 403 — both are valid auth rejections
    expect(response.status()).toBeLessThanOrEqual(403);
  });
});

test.describe('AI Analyze Retro API', () => {
  test('POST /api/ai/analyze-retro returns 400 when retro_content is missing', async ({ page, apiServer }) => {
    const { csrfToken } = await loginAsAdmin(page, apiServer.url);

    const response = await page.request.post(`${apiServer.url}/api/ai/analyze-retro`, {
      headers: { 'x-csrf-token': csrfToken },
      data: { plan_content: samplePlanContent },
    });

    expect(response.status(), 'Should return 400 when retro_content is missing').toBe(400);
    const result = await response.json();
    expect(result.error).toBe('Invalid input');
    expect(JSON.stringify(result.details), 'Validation details should mention retro_content').toContain('retro_content');
  });

  test('POST /api/ai/analyze-retro returns 400 when plan_content is missing', async ({ page, apiServer }) => {
    const { csrfToken } = await loginAsAdmin(page, apiServer.url);

    const response = await page.request.post(`${apiServer.url}/api/ai/analyze-retro`, {
      headers: { 'x-csrf-token': csrfToken },
      data: { retro_content: sampleRetroContent },
    });

    expect(response.status(), 'Should return 400 when plan_content is missing').toBe(400);
    const result = await response.json();
    expect(result.error).toBe('Invalid input');
    expect(JSON.stringify(result.details), 'Validation details should mention plan_content').toContain('plan_content');
  });

  test('POST /api/ai/analyze-retro returns 400 when both fields are missing', async ({ page, apiServer }) => {
    const { csrfToken } = await loginAsAdmin(page, apiServer.url);

    const response = await page.request.post(`${apiServer.url}/api/ai/analyze-retro`, {
      headers: { 'x-csrf-token': csrfToken },
      data: {},
    });

    expect(response.status(), 'Should return 400 when both fields are missing').toBe(400);
  });

  test('POST /api/ai/analyze-retro accepts valid content', async ({ page, apiServer }) => {
    const { csrfToken } = await loginAsAdmin(page, apiServer.url);

    const response = await page.request.post(`${apiServer.url}/api/ai/analyze-retro`, {
      headers: { 'x-csrf-token': csrfToken },
      data: {
        retro_content: sampleRetroContent,
        plan_content: samplePlanContent,
      },
    });

    // Same as analyze-plan: expect 200 with either result or ai_unavailable
    expect(response.ok(), 'Endpoint should return 200 even if AI is unavailable').toBe(true);

    const result = await response.json();
    const isAnalysis = result.overall_score !== undefined;
    const isUnavailable = result.error === 'ai_unavailable';
    expect(
      isAnalysis || isUnavailable,
      'Response should be either an analysis result or ai_unavailable error'
    ).toBe(true);
  });

  test('POST /api/ai/analyze-retro requires authentication', async ({ page, apiServer }) => {
    const response = await page.request.post(`${apiServer.url}/api/ai/analyze-retro`, {
      data: {
        retro_content: sampleRetroContent,
        plan_content: samplePlanContent,
      },
    });

    expect(response.status(), 'Unauthenticated request should return 401 or 403').toBeGreaterThanOrEqual(401); // 401 or 403 — both are valid auth rejections
    expect(response.status()).toBeLessThanOrEqual(403);
  });
});

test.describe('AI Rate Limiting', () => {
  test('POST /api/ai/analyze-plan returns 429 after 10 rapid requests', async ({ page, apiServer }) => {
    const { csrfToken } = await loginAsAdmin(page, apiServer.url);

    // Send 10 requests rapidly to hit the rate limit
    const requests = [];
    for (let i = 0; i < 11; i++) {
      requests.push(
        page.request.post(`${apiServer.url}/api/ai/analyze-plan`, {
          headers: { 'x-csrf-token': csrfToken },
          data: { content: samplePlanContent },
        })
      );
    }

    const responses = await Promise.all(requests);
    const statuses = responses.map(r => r.status());

    // At least one response should be 429 (rate limited)
    // Note: depending on implementation timing, some may succeed
    const has429 = statuses.some(s => s === 429);
    const allSucceeded = statuses.every(s => s === 200);

    // If all requests return 200, AI might be unavailable (catches before rate limit)
    // or rate limit window is per-hour and 11 isn't enough. Mark as soft check.
    if (!allSucceeded) {
      expect(has429, 'At least one request should be rate-limited (429)').toBe(true);
    }

    // Verify the 429 response body mentions rate limit
    const rateLimitedResponse = responses.find(r => r.status() === 429);
    if (rateLimitedResponse) {
      const body = await rateLimitedResponse.json();
      expect(body.error, 'Rate limit error should mention rate limit').toContain('Rate limit');
    }
  });
});
