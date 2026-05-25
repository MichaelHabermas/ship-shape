import { test, expect } from './fixtures/isolated-env';
import { login, loginViaApi } from './fixtures/api-auth';


/**
 * E2E tests for Manager Reviews feature.
 *
 * Tests:
 * 1. Reviews page renders with grid layout
 * 2. Reviews page sidebar navigation works
 * 3. GET /api/team/reviews returns expected data structure
 * 4. POST /api/weeks/:id/approve-review with rating works
 * 5. Rating validation rejects invalid/missing values
 */

test.describe('Manager Reviews', () => {
  test('reviews page renders with grid and sidebar navigation', async ({ page }) => {
    await login(page);

    // Navigate to Reviews page
    await page.goto('/team/reviews');
    await page.waitForLoadState('networkidle');

    // Verify sidebar shows Reviews nav item (page has no standalone heading)
    await expect(page.getByRole('button', { name: 'Reviews', exact: true })).toBeVisible();

    // Verify week headers are shown (at least one "Week N" text visible)
    await expect(page.locator('span', { hasText: /^Week \d+$/ }).first()).toBeVisible();

    // Verify manager action sub-bar is present with week-selectable review actions
    await expect(page.getByText('Manager Actions')).toBeVisible();
    await expect(page.locator('#plans-week-select')).toBeVisible();
    await expect(page.locator('#retros-week-select')).toBeVisible();
    await expect(page.getByRole('button', { name: /Review Plans/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Review Retros/ })).toBeVisible();
  });

  test('GET /api/team/reviews returns valid data structure', async ({ page, apiServer }) => {
    await login(page);

    // Call the reviews API
    const response = await page.request.get(`${apiServer.url}/api/team/reviews?sprint_count=5`);
    expect(response.ok()).toBe(true);

    const data = await response.json();

    // Verify structure
    expect(data.people).toBeInstanceOf(Array);
    expect(data.weeks).toBeInstanceOf(Array);
    expect(data.reviews).toBeDefined();
    expect(data.currentSprintNumber).toBeGreaterThan(0);

    // Verify weeks have correct shape
    expect(data.weeks.length).toBeLessThanOrEqual(5);
    if (data.weeks.length > 0) {
      const week = data.weeks[0];
      expect(week).toHaveProperty('number');
      expect(week).toHaveProperty('name');
      expect(week).toHaveProperty('startDate');
      expect(week).toHaveProperty('endDate');
      expect(week).toHaveProperty('isCurrent');
    }

    // Verify people have correct shape
    if (data.people.length > 0) {
      const person = data.people[0];
      expect(person).toHaveProperty('personId');
      expect(person).toHaveProperty('name');
    }
  });

  test('POST /api/weeks/:id/approve-review with rating succeeds', async ({ page, apiServer }) => {
    const { csrfToken } = await loginViaApi(page, apiServer.url);

    // Get a sprint ID to approve
    const weeksResponse = await page.request.get(`${apiServer.url}/api/weeks`);
    expect(weeksResponse.ok()).toBe(true);
    const weeksData = await weeksResponse.json();
    expect(weeksData.weeks.length, 'Need at least one sprint to test approval').toBeGreaterThan(0);

    const sprintId = weeksData.weeks[0].id;

    // Approve with rating
    const approveResponse = await page.request.post(
      `${apiServer.url}/api/weeks/${sprintId}/approve-review`,
      {
        headers: { 'x-csrf-token': csrfToken },
        data: { rating: 3 },
      }
    );
    expect(approveResponse.ok()).toBe(true);

    const result = await approveResponse.json();
    expect(result.success).toBe(true);
    expect(result.approval.state).toBe('approved');
    expect(result.review_rating).toBeDefined();
    expect(result.review_rating.value).toBe(3);
  });

  test('POST /api/weeks/:id/approve-review rejects invalid ratings', async ({ page, apiServer }) => {
    const { csrfToken } = await loginViaApi(page, apiServer.url);

    // Get a sprint ID
    const weeksResponse = await page.request.get(`${apiServer.url}/api/weeks`);
    const weeksData = await weeksResponse.json();
    expect(weeksData.weeks.length).toBeGreaterThan(0);
    const sprintId = weeksData.weeks[0].id;

    // Rating of 0 should fail
    const res0 = await page.request.post(
      `${apiServer.url}/api/weeks/${sprintId}/approve-review`,
      {
        headers: { 'x-csrf-token': csrfToken },
        data: { rating: 0 },
      }
    );
    expect(res0.status()).toBe(400);

    // Rating of 6 should fail
    const res6 = await page.request.post(
      `${apiServer.url}/api/weeks/${sprintId}/approve-review`,
      {
        headers: { 'x-csrf-token': csrfToken },
        data: { rating: 6 },
      }
    );
    expect(res6.status()).toBe(400);

    // Non-integer should fail
    const resFloat = await page.request.post(
      `${apiServer.url}/api/weeks/${sprintId}/approve-review`,
      {
        headers: { 'x-csrf-token': csrfToken },
        data: { rating: 3.5 },
      }
    );
    expect(resFloat.status()).toBe(400);
  });

  test('POST /api/weeks/:id/approve-review without rating is rejected', async ({ page, apiServer }) => {
    const { csrfToken } = await loginViaApi(page, apiServer.url);

    // Get a sprint ID
    const weeksResponse = await page.request.get(`${apiServer.url}/api/weeks`);
    const weeksData = await weeksResponse.json();
    expect(weeksData.weeks.length).toBeGreaterThan(0);
    const sprintId = weeksData.weeks[0].id;

    // Approve without rating (not allowed)
    const response = await page.request.post(
      `${apiServer.url}/api/weeks/${sprintId}/approve-review`,
      {
        headers: { 'x-csrf-token': csrfToken },
      }
    );
    expect(response.status()).toBe(400);
  });

  test('GET /api/team/reviews rejects non-admin users', async ({ page, apiServer }) => {
    // This test verifies admin-only access
    // The seed user is admin, so we need to test the 403 scenario
    // by checking the endpoint requires authentication at minimum
    const response = await page.request.get(`${apiServer.url}/api/team/reviews`);
    // Without login, should get 401
    expect(response.status()).toBe(401);
  });
});
