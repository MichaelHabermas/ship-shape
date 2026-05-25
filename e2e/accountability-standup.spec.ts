import { test, expect } from './fixtures/isolated-env';
import { loginAsAdminWithUser } from './fixtures/api-auth';


/**
 * E2E test for standup accountability flow.
 *
 * Standups are different from other accountability types:
 * - They're based on ASSIGNED issues, not ownership
 * - They only appear on business days (Mon-Fri)
 * - They show issue count in the message
 *
 * These tests use API calls directly to avoid UI flakiness and
 * test the actual inference logic.
 *
 * Note: The isBusinessDay check happens server-side, so we check the
 * actual day rather than trying to mock dates (browser date mocking
 * doesn't affect the API server).
 */

function isBusinessDay(): boolean {
  const day = new Date().getUTCDay();
  return day >= 1 && day <= 5; // Mon=1 through Fri=5
}

test.describe('Standup Accountability Flow', () => {
  test('standup action items respect business day rules', async ({ page, apiServer }) => {
    const { csrfToken, userId } = await loginAsAdminWithUser(page, apiServer.url);

    // Create a program
    const programResponse = await page.request.post(`${apiServer.url}/api/documents`, {
      headers: { 'x-csrf-token': csrfToken },
      data: {
        title: 'Test Program for Standup',
        document_type: 'program',
      },
    });
    expect(programResponse.ok()).toBe(true);
    const program = await programResponse.json();
    const programId = program.id;

    // Get current sprint number from server
    const gridResponse = await page.request.get(`${apiServer.url}/api/team/grid`);
    expect(gridResponse.ok()).toBe(true);
    const gridData = await gridResponse.json();
    const currentSprintNumber = gridData.currentSprintNumber;

    // Create a sprint that's current
    const sprintResponse = await page.request.post(`${apiServer.url}/api/weeks`, {
      headers: { 'x-csrf-token': csrfToken },
      data: {
        title: 'Current Sprint for Standup',
        program_id: programId,
        sprint_number: currentSprintNumber,
        owner_id: userId,
      },
    });
    expect(sprintResponse.ok()).toBe(true);
    const sprint = await sprintResponse.json();
    const sprintId = sprint.id;

    // Create an issue assigned to current user in this sprint
    const issueResponse = await page.request.post(`${apiServer.url}/api/issues`, {
      headers: { 'x-csrf-token': csrfToken },
      data: {
        title: 'Test Issue Assigned to User',
        assignee_id: userId,
        belongs_to: [{ id: sprintId, type: 'sprint' }],
      },
    });
    expect(issueResponse.ok()).toBe(true);

    // Check action items
    const actionItemsResponse = await page.request.get(`${apiServer.url}/api/accountability/action-items`);
    expect(actionItemsResponse.ok()).toBe(true);
    const actionItems = await actionItemsResponse.json();

    const standupItems = actionItems.items.filter(
      (item: { accountability_target_id: string; accountability_type: string }) =>
        item.accountability_target_id === sprintId && item.accountability_type === 'standup'
    );

    if (isBusinessDay()) {
      // On business days, should have a standup action item
      expect(standupItems.length).toBe(1);
      expect(standupItems[0].title).toContain('1 issue');
    } else {
      // On weekends, standups are not required
      expect(standupItems.length).toBe(0);
    }
  });

  test('creating standup removes action item on business days', async ({ page, apiServer }) => {
    // This test only validates the remove-on-create behavior on business days.
    // On weekends there's no standup item to remove, so we verify that directly.

    const { csrfToken, userId } = await loginAsAdminWithUser(page, apiServer.url);

    // Create a program
    const programResponse = await page.request.post(`${apiServer.url}/api/documents`, {
      headers: { 'x-csrf-token': csrfToken },
      data: {
        title: 'Test Program for Standup Creation',
        document_type: 'program',
      },
    });
    expect(programResponse.ok()).toBe(true);
    const program = await programResponse.json();
    const programId = program.id;

    // Get current sprint number from server
    const gridResponse = await page.request.get(`${apiServer.url}/api/team/grid`);
    expect(gridResponse.ok()).toBe(true);
    const gridData = await gridResponse.json();
    const currentSprintNumber = gridData.currentSprintNumber;

    // Create current sprint
    const sprintResponse = await page.request.post(`${apiServer.url}/api/weeks`, {
      headers: { 'x-csrf-token': csrfToken },
      data: {
        title: 'Current Sprint for Standup Creation',
        program_id: programId,
        sprint_number: currentSprintNumber,
        owner_id: userId,
      },
    });
    expect(sprintResponse.ok()).toBe(true);
    const sprint = await sprintResponse.json();
    const sprintId = sprint.id;

    // Create an issue assigned to current user in this sprint
    await page.request.post(`${apiServer.url}/api/issues`, {
      headers: { 'x-csrf-token': csrfToken },
      data: {
        title: 'Test Issue for Standup',
        assignee_id: userId,
        belongs_to: [{ id: sprintId, type: 'sprint' }],
      },
    });

    // Step 1: Check initial standup items
    const actionItemsResponse1 = await page.request.get(`${apiServer.url}/api/accountability/action-items`);
    expect(actionItemsResponse1.ok()).toBe(true);
    const actionItems1 = await actionItemsResponse1.json();

    const standupItems1 = actionItems1.items.filter(
      (item: { accountability_target_id: string; accountability_type: string }) =>
        item.accountability_target_id === sprintId && item.accountability_type === 'standup'
    );

    if (!isBusinessDay()) {
      // On weekends, no standup items exist — nothing to remove
      expect(standupItems1.length).toBe(0);
      return; // Test passes — correct weekend behavior
    }

    // On business days, verify item exists then remove it
    expect(standupItems1.length).toBe(1);

    // Step 2: Create a standup for this sprint
    const standupResponse = await page.request.post(`${apiServer.url}/api/weeks/${sprintId}/standups`, {
      headers: { 'x-csrf-token': csrfToken },
      data: {
        title: 'Daily Standup',
        content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'My standup update' }] }] },
      },
    });
    expect(standupResponse.ok()).toBe(true);

    // Step 3: Verify standup item is now GONE
    const actionItemsResponse2 = await page.request.get(`${apiServer.url}/api/accountability/action-items`);
    expect(actionItemsResponse2.ok()).toBe(true);
    const actionItems2 = await actionItemsResponse2.json();

    const standupItems2 = actionItems2.items.filter(
      (item: { accountability_target_id: string; accountability_type: string }) =>
        item.accountability_target_id === sprintId && item.accountability_type === 'standup'
    );

    // After creating standup, no standup action item should exist
    expect(standupItems2.length).toBe(0);
  });

  test('user without assigned issues does not see standup action item', async ({ page, apiServer }) => {
    const { csrfToken, userId } = await loginAsAdminWithUser(page, apiServer.url);

    // Create a program
    const programResponse = await page.request.post(`${apiServer.url}/api/documents`, {
      headers: { 'x-csrf-token': csrfToken },
      data: {
        title: 'Test Program for Empty Sprint',
        document_type: 'program',
      },
    });
    expect(programResponse.ok()).toBe(true);
    const program = await programResponse.json();
    const programId = program.id;

    // Get current sprint number from server
    const gridResponse = await page.request.get(`${apiServer.url}/api/team/grid`);
    expect(gridResponse.ok()).toBe(true);
    const gridData = await gridResponse.json();
    const currentSprintNumber = gridData.currentSprintNumber;

    // Create current sprint with user as owner
    const sprintResponse = await page.request.post(`${apiServer.url}/api/weeks`, {
      headers: { 'x-csrf-token': csrfToken },
      data: {
        title: 'Empty Sprint No Assigned Issues',
        program_id: programId,
        sprint_number: currentSprintNumber,
        owner_id: userId,
      },
    });
    expect(sprintResponse.ok()).toBe(true);
    const sprint = await sprintResponse.json();
    const sprintId = sprint.id;

    // DON'T create any issues assigned to this user

    // Check action items - should NOT have standup item (no assigned issues)
    const actionItemsResponse = await page.request.get(`${apiServer.url}/api/accountability/action-items`);
    expect(actionItemsResponse.ok()).toBe(true);
    const actionItems = await actionItemsResponse.json();

    const standupItems = actionItems.items.filter(
      (item: { accountability_target_id: string; accountability_type: string }) =>
        item.accountability_target_id === sprintId && item.accountability_type === 'standup'
    );

    // No assigned issues = no standup action item (regardless of day)
    expect(standupItems.length).toBe(0);
  });
});
