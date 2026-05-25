import { test, expect } from './fixtures/isolated-env';
import { loginViaApi, loginMemberViaApi } from './fixtures/api-auth';


/**
 * E2E tests for Request Changes API endpoints.
 *
 * Tests:
 * 1. POST /api/weeks/:id/request-plan-changes — sets plan_approval.state to 'changes_requested'
 * 2. POST /api/weeks/:id/request-retro-changes — sets review_approval.state to 'changes_requested'
 * 3. Validation: feedback required (400 if missing), max 2000 chars (400 if exceeded)
 * 4. Authorization: only program accountable or admin can request changes
 */

// Helper to get a sprint ID from the active weeks
async function getSprintId(page: import('@playwright/test').Page, apiUrl: string): Promise<string> {
  const response = await page.request.get(`${apiUrl}/api/weeks`);
  expect(response.ok(), 'GET /api/weeks should succeed').toBe(true);
  const data = await response.json();
  expect(data.weeks.length, 'Need at least one sprint for request-changes tests').toBeGreaterThan(0);
  return data.weeks[0].id;
}

test.describe('Request Plan Changes API', () => {
  test('POST /api/weeks/:id/request-plan-changes succeeds with valid feedback', async ({ page, apiServer }) => {
    const { csrfToken } = await loginViaApi(page, apiServer.url);
    const sprintId = await getSprintId(page, apiServer.url);

    const response = await page.request.post(
      `${apiServer.url}/api/weeks/${sprintId}/request-plan-changes`,
      {
        headers: { 'x-csrf-token': csrfToken },
        data: { feedback: 'Please add more specific success criteria for the sprint goals.' },
      }
    );

    expect(response.ok(), 'Request plan changes should succeed for admin').toBe(true);

    const result = await response.json();
    expect(result.success, 'Response should indicate success').toBe(true);
    expect(result.approval.state, 'Plan approval state should be changes_requested').toBe('changes_requested');
    expect(result.approval.feedback, 'Feedback should be stored').toBe(
      'Please add more specific success criteria for the sprint goals.'
    );
  });

  test('POST /api/weeks/:id/request-plan-changes returns 400 when feedback is missing', async ({ page, apiServer }) => {
    const { csrfToken } = await loginViaApi(page, apiServer.url);
    const sprintId = await getSprintId(page, apiServer.url);

    // No feedback provided
    const response = await page.request.post(
      `${apiServer.url}/api/weeks/${sprintId}/request-plan-changes`,
      {
        headers: { 'x-csrf-token': csrfToken },
        data: {},
      }
    );

    expect(response.status(), 'Should return 400 when feedback is missing').toBe(400);
    const result = await response.json();
    expect(result.error, 'Error message should mention feedback').toContain('Feedback');
  });

  test('POST /api/weeks/:id/request-plan-changes returns 400 when feedback is empty string', async ({ page, apiServer }) => {
    const { csrfToken } = await loginViaApi(page, apiServer.url);
    const sprintId = await getSprintId(page, apiServer.url);

    const response = await page.request.post(
      `${apiServer.url}/api/weeks/${sprintId}/request-plan-changes`,
      {
        headers: { 'x-csrf-token': csrfToken },
        data: { feedback: '' },
      }
    );

    expect(response.status(), 'Should return 400 when feedback is empty').toBe(400);
  });

  test('POST /api/weeks/:id/request-plan-changes returns 400 when feedback exceeds 2000 chars', async ({ page, apiServer }) => {
    const { csrfToken } = await loginViaApi(page, apiServer.url);
    const sprintId = await getSprintId(page, apiServer.url);

    const longFeedback = 'x'.repeat(2001);
    const response = await page.request.post(
      `${apiServer.url}/api/weeks/${sprintId}/request-plan-changes`,
      {
        headers: { 'x-csrf-token': csrfToken },
        data: { feedback: longFeedback },
      }
    );

    expect(response.status(), 'Should return 400 when feedback exceeds 2000 chars').toBe(400);
    const result = await response.json();
    expect(result.error, 'Error should mention character limit').toContain('2000');
  });

  test('POST /api/weeks/:id/request-plan-changes returns 404 for non-existent sprint', async ({ page, apiServer }) => {
    const { csrfToken } = await loginViaApi(page, apiServer.url);

    const fakeId = '00000000-0000-0000-0000-000000000000';
    const response = await page.request.post(
      `${apiServer.url}/api/weeks/${fakeId}/request-plan-changes`,
      {
        headers: { 'x-csrf-token': csrfToken },
        data: { feedback: 'This sprint does not exist' },
      }
    );

    expect(response.status(), 'Should return 404 for non-existent sprint').toBe(404);
  });

  test('POST /api/weeks/:id/request-plan-changes updates sprint properties correctly', async ({ page, apiServer }) => {
    const { csrfToken } = await loginViaApi(page, apiServer.url);
    const sprintId = await getSprintId(page, apiServer.url);

    // Request changes
    const changeResponse = await page.request.post(
      `${apiServer.url}/api/weeks/${sprintId}/request-plan-changes`,
      {
        headers: { 'x-csrf-token': csrfToken },
        data: { feedback: 'Need more detail on deliverables' },
      }
    );
    expect(changeResponse.ok()).toBe(true);

    // Verify the sprint now has changes_requested state by fetching it
    const sprintResponse = await page.request.get(`${apiServer.url}/api/weeks/${sprintId}`);
    expect(sprintResponse.ok()).toBe(true);
    const sprint = await sprintResponse.json();
    expect(sprint.plan_approval, 'Sprint should have plan_approval after changes requested').toBeTruthy();
    expect(sprint.plan_approval.state, 'Plan approval state should be changes_requested').toBe('changes_requested');
    expect(sprint.plan_approval.feedback, 'Feedback should be persisted').toBe('Need more detail on deliverables');
  });
});

test.describe('Request Retro Changes API', () => {
  test('POST /api/weeks/:id/request-retro-changes succeeds with valid feedback', async ({ page, apiServer }) => {
    const { csrfToken } = await loginViaApi(page, apiServer.url);
    const sprintId = await getSprintId(page, apiServer.url);

    const response = await page.request.post(
      `${apiServer.url}/api/weeks/${sprintId}/request-retro-changes`,
      {
        headers: { 'x-csrf-token': csrfToken },
        data: { feedback: 'Retro lacks evidence for completed items. Please add specific outcomes.' },
      }
    );

    expect(response.ok(), 'Request retro changes should succeed for admin').toBe(true);

    const result = await response.json();
    expect(result.success, 'Response should indicate success').toBe(true);
    expect(result.approval.state, 'Review approval state should be changes_requested').toBe('changes_requested');
    expect(result.approval.feedback, 'Feedback should be stored').toBe(
      'Retro lacks evidence for completed items. Please add specific outcomes.'
    );
  });

  test('POST /api/weeks/:id/request-retro-changes returns 400 when feedback is missing', async ({ page, apiServer }) => {
    const { csrfToken } = await loginViaApi(page, apiServer.url);
    const sprintId = await getSprintId(page, apiServer.url);

    const response = await page.request.post(
      `${apiServer.url}/api/weeks/${sprintId}/request-retro-changes`,
      {
        headers: { 'x-csrf-token': csrfToken },
        data: {},
      }
    );

    expect(response.status(), 'Should return 400 when feedback is missing').toBe(400);
  });

  test('POST /api/weeks/:id/request-retro-changes returns 400 when feedback exceeds 2000 chars', async ({ page, apiServer }) => {
    const { csrfToken } = await loginViaApi(page, apiServer.url);
    const sprintId = await getSprintId(page, apiServer.url);

    const longFeedback = 'y'.repeat(2001);
    const response = await page.request.post(
      `${apiServer.url}/api/weeks/${sprintId}/request-retro-changes`,
      {
        headers: { 'x-csrf-token': csrfToken },
        data: { feedback: longFeedback },
      }
    );

    expect(response.status(), 'Should return 400 when feedback exceeds 2000 chars').toBe(400);
  });

  test('POST /api/weeks/:id/request-retro-changes updates sprint properties correctly', async ({ page, apiServer }) => {
    const { csrfToken } = await loginViaApi(page, apiServer.url);
    const sprintId = await getSprintId(page, apiServer.url);

    // Request retro changes
    const changeResponse = await page.request.post(
      `${apiServer.url}/api/weeks/${sprintId}/request-retro-changes`,
      {
        headers: { 'x-csrf-token': csrfToken },
        data: { feedback: 'Missing outcomes for 3 planned items' },
      }
    );
    expect(changeResponse.ok()).toBe(true);

    // Verify the sprint now has changes_requested state on review_approval
    const sprintResponse = await page.request.get(`${apiServer.url}/api/weeks/${sprintId}`);
    expect(sprintResponse.ok()).toBe(true);
    const sprint = await sprintResponse.json();
    expect(sprint.review_approval, 'Sprint should have review_approval after changes requested').toBeTruthy();
    expect(sprint.review_approval.state, 'Review approval state should be changes_requested').toBe('changes_requested');
    expect(sprint.review_approval.feedback, 'Feedback should be persisted').toBe('Missing outcomes for 3 planned items');
  });
});

test.describe('Request Changes Authorization', () => {
  test('non-admin, non-accountable user gets 403 on request-plan-changes', async ({ page, apiServer }) => {
    // First, login as admin to get a sprint ID
    await loginViaApi(page, apiServer.url);
    const sprintId = await getSprintId(page, apiServer.url);

    // Clear cookies and login as non-admin member
    await page.context().clearCookies();
    const { csrfToken } = await loginMemberViaApi(page, apiServer.url);

    const response = await page.request.post(
      `${apiServer.url}/api/weeks/${sprintId}/request-plan-changes`,
      {
        headers: { 'x-csrf-token': csrfToken },
        data: { feedback: 'I should not be able to do this' },
      }
    );

    expect(response.status(), 'Non-admin user should get 403').toBe(403);
  });

  test('non-admin, non-accountable user gets 403 on request-retro-changes', async ({ page, apiServer }) => {
    // First, login as admin to get a sprint ID
    await loginViaApi(page, apiServer.url);
    const sprintId = await getSprintId(page, apiServer.url);

    // Clear cookies and login as non-admin member
    await page.context().clearCookies();
    const { csrfToken } = await loginMemberViaApi(page, apiServer.url);

    const response = await page.request.post(
      `${apiServer.url}/api/weeks/${sprintId}/request-retro-changes`,
      {
        headers: { 'x-csrf-token': csrfToken },
        data: { feedback: 'I should not be able to do this either' },
      }
    );

    expect(response.status(), 'Non-admin user should get 403').toBe(403);
  });

  test('unauthenticated request returns 401', async ({ page, apiServer }) => {
    // Get a sprint ID while logged in
    await loginViaApi(page, apiServer.url);
    const sprintId = await getSprintId(page, apiServer.url);

    // Clear cookies to simulate unauthenticated request
    await page.context().clearCookies();

    const response = await page.request.post(
      `${apiServer.url}/api/weeks/${sprintId}/request-plan-changes`,
      {
        data: { feedback: 'Unauthenticated attempt' },
      }
    );

    expect(response.status(), 'Unauthenticated request should return 401 or 403').toBeGreaterThanOrEqual(401); // 401 or 403 — both are valid auth rejections
    expect(response.status()).toBeLessThanOrEqual(403);
  });
});
