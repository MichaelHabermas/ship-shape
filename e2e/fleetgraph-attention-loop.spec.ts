// Verifies the FleetGraph issue mutation to event, notification, source, and gated chat loop.
import type { Page } from '@playwright/test';
import { test, expect } from './fixtures/isolated-env';
import { getCsrfToken, loginAsAdmin } from './fixtures/api-auth';

type IssueResponse = {
  id: string;
  title: string;
  state?: string;
};

type NotificationResponse = {
  findingId: string;
  title: string;
  sourcePath: string;
};

type WorkerTickResponse = {
  attentionEventIds: string[];
};

type ChatResponse = {
  answer: {
    humanGate?: Record<string, unknown>;
  };
};

async function runWorkerUntilEventProcessed(input: {
  page: Page;
  apiUrl: string;
  csrfToken: string;
  eventId: string;
  maxTicks?: number;
}): Promise<WorkerTickResponse> {
  let latestBody: WorkerTickResponse = { attentionEventIds: [] };
  for (let attempt = 0; attempt < (input.maxTicks ?? 5); attempt += 1) {
    const workerResponse = await input.page.request.post(`${input.apiUrl}/api/fleetgraph/test/worker-tick`, {
      headers: { 'x-csrf-token': input.csrfToken },
      data: {},
    });
    if (!workerResponse.ok()) {
      throw new Error(`test worker tick failed: ${workerResponse.status()} ${await workerResponse.text()}`);
    }
    latestBody = await workerResponse.json() as WorkerTickResponse;
    if (latestBody.attentionEventIds.includes(input.eventId)) return latestBody;
  }
  return latestBody;
}

async function runWorkerTicks(input: {
  page: Page;
  apiUrl: string;
  csrfToken: string;
  count?: number;
}): Promise<void> {
  for (let attempt = 0; attempt < (input.count ?? 3); attempt += 1) {
    const workerResponse = await input.page.request.post(`${input.apiUrl}/api/fleetgraph/test/worker-tick`, {
      headers: { 'x-csrf-token': input.csrfToken },
      data: {},
    });
    if (!workerResponse.ok()) {
      throw new Error(`test worker tick failed: ${workerResponse.status()} ${await workerResponse.text()}`);
    }
  }
}

async function firstWorkspaceContext(dbPool: import('pg').Pool): Promise<{
  userId: string;
  sprintId: string;
}> {
  const result = await dbPool.query<{
    user_id: string;
    sprint_id: string;
  }>(
    `SELECT u.id AS user_id, s.id AS sprint_id
       FROM users u
       JOIN workspaces w ON w.id = u.last_workspace_id
       JOIN documents s
         ON s.workspace_id = w.id
        AND s.document_type = 'sprint'
        AND s.deleted_at IS NULL
        AND s.archived_at IS NULL
      WHERE u.email = 'dev@ship.local'
      ORDER BY
        CASE
          WHEN s.properties->>'sprint_number' ~ '^\\d+$' THEN (s.properties->>'sprint_number')::int
          ELSE 0
        END DESC
      LIMIT 1`
  );
  const row = result.rows[0];
  if (!row) throw new Error('Missing seeded workspace context for FleetGraph e2e');
  return { userId: row.user_id, sprintId: row.sprint_id };
}

test.describe('FleetGraph attention loop', () => {
  test('issue mutation becomes a notification, source, and gated chat answer', async ({ page, apiServer, dbPool }) => {
    let { csrfToken } = await loginAsAdmin(page, apiServer.url);
    const { userId, sprintId } = await firstWorkspaceContext(dbPool);
    const issueTitle = `E2E blocked source proof ${Date.now()}`;

    const createdIssueResponse = await page.request.post(`${apiServer.url}/api/issues`, {
      headers: { 'x-csrf-token': csrfToken },
      data: {
        title: issueTitle,
        state: 'todo',
        priority: 'medium',
        assignee_id: userId,
        belongs_to: [{ id: sprintId, type: 'sprint' }],
        source: 'internal',
      },
    });
    expect(createdIssueResponse.ok(), 'issue creation should succeed').toBe(true);
    const createdIssue = await createdIssueResponse.json() as IssueResponse;

    const iterationResponse = await page.request.post(`${apiServer.url}/api/issues/${createdIssue.id}/iterations`, {
      headers: { 'x-csrf-token': csrfToken },
      data: {
        status: 'in_progress',
        what_attempted: 'E2E proof worker attempted to clear the dependency.',
        blockers_encountered: 'Blocked on dependency owner confirming the release window.',
      },
    });
    expect(iterationResponse.ok(), 'iteration creation should succeed').toBe(true);

    const blockedResponse = await page.request.patch(`${apiServer.url}/api/issues/${createdIssue.id}`, {
      headers: { 'x-csrf-token': csrfToken },
      data: { state: 'blocked' },
    });
    expect(blockedResponse.ok(), 'issue update should succeed').toBe(true);

    const pendingEvent = await dbPool.query<{ id: string; created_at: Date }>(
      `SELECT id, created_at
         FROM fleetgraph_attention_events
        WHERE source_issue_id = $1
          AND status = 'pending'
        ORDER BY created_at DESC
        LIMIT 1`,
      [createdIssue.id]
    );
    expect(pendingEvent.rows.length, 'issue mutation should enqueue a pending attention event').toBeGreaterThan(0);

    const workerBody = await runWorkerUntilEventProcessed({
      page,
      apiUrl: apiServer.url,
      csrfToken,
      eventId: pendingEvent.rows[0].id,
    });
    expect(workerBody.attentionEventIds).toContain(pendingEvent.rows[0].id);

    const completedEvent = await dbPool.query<{ status: string; processed_at: Date; created_at: Date }>(
      `SELECT processed_at, created_at
         FROM fleetgraph_attention_events
        WHERE id = $1
          AND status = 'completed'
        ORDER BY processed_at DESC
        LIMIT 1`,
      [pendingEvent.rows[0].id]
    );
    expect(completedEvent.rows.length, 'the mutation-created attention event should complete').toBeGreaterThan(0);
    const latencyMs = completedEvent.rows[0].processed_at.getTime() - completedEvent.rows[0].created_at.getTime();
    expect(latencyMs).toBeLessThan(30_000);

    const notificationsResponse = await page.request.get(`${apiServer.url}/api/fleetgraph/notifications?limit=25`);
    expect(notificationsResponse.ok()).toBe(true);
    const notificationsBody = await notificationsResponse.json() as { notifications: NotificationResponse[] };
    const notification = notificationsBody.notifications.find((item) => item.title.includes(issueTitle));
    expect(notification, 'notification API should include the blocked issue').toBeTruthy();
    expect(notification?.sourcePath).toBe(`/documents/${createdIssue.id}`);

    await page.goto(`/documents/${createdIssue.id}`);
    await page.getByRole('button', { name: 'Open notifications' }).click();

    await expect(page.getByText('Blocked 1')).toBeVisible();
    const row = page.locator('article', { hasText: issueTitle });
    await expect(row).toBeVisible();
    await expect(row.getByRole('button', { name: /Open source/i })).toHaveCount(0);
    const titleButton = row.getByRole('button', { name: new RegExp(`Blocked ${issueTitle}`) });
    const unreadDot = row.getByTitle('Unread');
    const titleBox = await titleButton.boundingBox();
    const dotBox = await unreadDot.boundingBox();
    expect(titleBox && dotBox && titleBox.x + titleBox.width <= dotBox.x).toBe(true);

    await titleButton.click();
    await expect(row.getByText('Issue state is blocked.')).toBeVisible();
    await expect(row.getByRole('button', { name: 'Open source' })).toBeVisible();
    await expect(row.getByRole('button', { name: 'Discuss' })).toBeVisible();
    await expect(row.getByTitle('Unread')).toHaveCount(0);

    await row.getByRole('button', { name: 'Open source' }).click();
    await expect(page).toHaveURL(new RegExp(`/documents/${createdIssue.id}`));
    await expect(page.getByPlaceholder('Untitled')).toHaveValue(issueTitle);

    await expect(row).toBeVisible();
    await row.getByRole('button', { name: 'Discuss' }).click();
    const chat = page.getByRole('region', { name: 'Context chat' });
    await expect(chat).toBeVisible();
    await expect(chat.getByText(issueTitle).first()).toBeVisible();
    await expect(chat.getByText(/Human approval is required|Approval required/i)).toBeVisible();

    const chatResponsePromise = page.waitForResponse((response) =>
      response.url().includes('/api/fleetgraph/chat') && response.request().method() === 'POST'
    );
    await page.getByRole('textbox', { name: 'Message' }).fill('What should I do?');
    await page.getByRole('button', { name: 'Send message' }).click();
    const chatResponse = await chatResponsePromise;
    expect(chatResponse.ok()).toBe(true);
    const chatBody = await chatResponse.json() as ChatResponse;
    expect(chatBody.answer.humanGate?.required).toBe(true);
    await expect(chat.getByText(/Approval required|Human approval/i).first()).toBeVisible();
    await expect(chat.getByText(/next|ask|owner|unblock/i).first()).toBeVisible();

    const issueAfterChat = await page.request.get(`${apiServer.url}/api/issues/${createdIssue.id}`);
    expect(issueAfterChat.ok()).toBe(true);
    const issueBody = await issueAfterChat.json() as IssueResponse;
    expect(issueBody.state).toBe('blocked');

    csrfToken = await getCsrfToken(page, apiServer.url);
    const doneResponse = await page.request.patch(`${apiServer.url}/api/issues/${createdIssue.id}`, {
      headers: { 'x-csrf-token': csrfToken },
      data: { state: 'done' },
    });
    expect(doneResponse.ok(), 'issue resolution should succeed').toBe(true);
    await runWorkerTicks({
      page,
      apiUrl: apiServer.url,
      csrfToken,
    });
    const resolvedNotificationsResponse = await page.request.get(`${apiServer.url}/api/fleetgraph/notifications?limit=25`);
    const resolvedNotifications = await resolvedNotificationsResponse.json() as { notifications: NotificationResponse[] };
    expect(resolvedNotifications.notifications.some((item) => item.title.includes(issueTitle))).toBe(false);
  });
});
