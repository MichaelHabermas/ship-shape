/** E2E accountability owner-change inference and action-items API shape. */
import { test, expect } from './fixtures/isolated-env';
import { loginViaApi } from './fixtures/api-auth';
import { readJsonAs } from './fixtures/typed-json';
import type { ActionItemsResponse, ApiId, AuthMeResponse } from './fixtures/e2e-api-types';


/**
 * Critical E2E test for the accountability refactor.
 *
 * This test proves that the inference-based approach works correctly:
 * when the owner of a project/sprint changes, the action item should
 * disappear immediately because items are computed dynamically.
 *
 * The old issue-based system had a bug where action items persisted
 * after owner changes because the issues were already created.
 *
 * These tests use API calls directly to avoid UI flakiness and
 * test the actual inference logic.
 */

test.describe('Accountability Owner Change', () => {
  test('sprint owner change immediately removes action items from inference', async ({ page, apiServer }) => {
    const { csrfToken } = await loginViaApi(page, apiServer.url);

    // Get user ID
    const meResponse = await page.request.get(`${apiServer.url}/api/auth/me`);
    expect(meResponse.ok()).toBe(true);
    const meData = await readJsonAs<AuthMeResponse>(meResponse);
    const userId = meData.data.user.id;

    // Create a program via documents API
    const programResponse = await page.request.post(`${apiServer.url}/api/documents`, {
      headers: { 'x-csrf-token': csrfToken },
      data: {
        title: 'Test Program for Sprint Accountability',
        document_type: 'program',
      },
    });
    expect(programResponse.ok()).toBe(true);
    const program = await readJsonAs<ApiId>(programResponse);
    const programId = program.id;

    // Create a sprint via sprints API (requires sprint_number for accountability to work)
    // Use sprint_number: 1 which has already started (workspace sprint_start_date is 3 months ago)
    const sprintResponse = await page.request.post(`${apiServer.url}/api/weeks`, {
      headers: { 'x-csrf-token': csrfToken },
      data: {
        title: 'Test Sprint',
        program_id: programId,
        sprint_number: 1,
        owner_id: userId, // Set owner at creation time
      },
    });
    expect(sprintResponse.ok()).toBe(true);
    const sprint = await readJsonAs<ApiId>(sprintResponse);
    const sprintId = sprint.id;

    // Step 2: Check action items - should include sprint items for this sprint
    const actionItemsResponse = await page.request.get(`${apiServer.url}/api/accountability/action-items`);
    expect(actionItemsResponse.ok()).toBe(true);
    const actionItems = await readJsonAs<ActionItemsResponse>(actionItemsResponse);

    const sprintItems = actionItems.items.filter(
      (item) => item.accountability_target_id === sprintId
    );

    // Should have at least weekly_plan action item (new sprint without plan)
    expect(sprintItems.length).toBeGreaterThan(0);

    // Step 3: Remove owner from the sprint
    const removeOwnerResponse = await page.request.patch(`${apiServer.url}/api/weeks/${sprintId}`, {
      headers: { 'x-csrf-token': csrfToken },
      data: { owner_id: null },
    });
    expect(removeOwnerResponse.ok()).toBe(true);

    // Step 4: Check action items again - should have NO items for this sprint
    const actionItemsResponse2 = await page.request.get(`${apiServer.url}/api/accountability/action-items`);
    expect(actionItemsResponse2.ok()).toBe(true);
    const actionItems2 = await readJsonAs<ActionItemsResponse>(actionItemsResponse2);

    const sprintItems2 = actionItems2.items.filter(
      (item) => item.accountability_target_id === sprintId
    );

    // Key assertion: After removing owner, no action items should exist for this sprint
    expect(sprintItems2.length).toBe(0);
  });

  test('action items API returns valid response shape', async ({ page, apiServer }) => {
    // Login to get auth cookies
    await page.goto('/login');
    await page.locator('#email').fill('dev@ship.local');
    await page.locator('#password').fill('admin123');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page).not.toHaveURL('/login', { timeout: 5000 });

    const response = await page.request.get(`${apiServer.url}/api/accountability/action-items`);

    expect(response.ok()).toBe(true);
    const data = await readJsonAs<ActionItemsResponse>(response);

    // Verify response shape
    expect(data).toHaveProperty('items');
    expect(Array.isArray(data.items)).toBe(true);

    // If there are items, verify each has required fields
    for (const item of data.items) {
      expect(item).toHaveProperty('accountability_type');
      expect(item).toHaveProperty('accountability_target_id');
      expect(item).toHaveProperty('target_title');
    }
  });
});
