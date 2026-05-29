// Verifies FleetGraph chat's basic user-visible conversation loop through the browser.
import { test, expect } from './fixtures/isolated-env';
import { loginAsAdmin } from './fixtures/api-auth';

function docContent(lines: string[]) {
  return {
    type: 'doc',
    content: lines.map((text) => ({
      type: 'paragraph',
      content: [{ type: 'text', text }],
    })),
  };
}

async function sendChat(page: import('@playwright/test').Page, message: string) {
  const input = page.locator('#context-chat-draft');
  await expect(input).toBeVisible({ timeout: 10000 });
  await input.fill(message);
  await page.getByRole('button', { name: 'Send message' }).click();
}

function waitForChatRequest(page: import('@playwright/test').Page) {
  return page.waitForRequest((request) =>
    request.method() === 'POST' && request.url().includes('/api/fleetgraph/chat')
  );
}

test.describe('FleetGraph chat smoke', () => {
  test('greets, summarizes, and simplifies from the current issue', async ({ page, apiServer }) => {
    const { csrfToken } = await loginAsAdmin(page, apiServer.url);
    const createResponse = await page.request.post(`${apiServer.url}/api/documents`, {
      headers: { 'x-csrf-token': csrfToken },
      data: {
        title: `Legacy reporting debt ${Date.now()}`,
        document_type: 'issue',
        properties: { state: 'in_progress', priority: 'urgent' },
        content: docContent([
          'Demo export is blocked by legacy reporting cleanup debt.',
          'The current blocker is missing sample integration approval.',
        ]),
      },
    });
    expect(createResponse.ok()).toBe(true);
    const issue = (await createResponse.json()) as { id: string };

    await page.goto(`/issues/${issue.id}`);
    await expect(page.locator('.ProseMirror')).toBeVisible({ timeout: 15000 });

    await page.getByRole('button', { name: 'Open chat' }).click();
    const [greetingRequest] = await Promise.all([
      waitForChatRequest(page),
      sendChat(page, 'hi'),
    ]);
    expect(greetingRequest.postDataJSON()).not.toHaveProperty('history');

    const assistantMessages = page.getByTestId('chat-assistant-message');
    await expect(assistantMessages).toHaveCount(1, { timeout: 15000 });
    const greeting = (await assistantMessages.nth(0).innerText()).replace(/\s+/g, ' ').trim();
    expect(greeting.split(/\s+/).length).toBeLessThanOrEqual(12);
    expect(greeting).not.toMatch(/cleanup debt|Demo export|sample integration approval/i);

    const [summaryRequest] = await Promise.all([
      waitForChatRequest(page),
      sendChat(page, 'summarize this'),
    ]);
    const summaryRequestBody = summaryRequest.postDataJSON() as { history?: Array<{ role: string; content: string }> };
    expect(summaryRequestBody.history).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: 'user', content: 'hi' }),
      expect.objectContaining({ role: 'assistant' }),
    ]));
    await expect(assistantMessages).toHaveCount(2, { timeout: 15000 });
    const summary = (await assistantMessages.nth(1).innerText()).replace(/\s+/g, ' ').trim();
    expect(summary).toMatch(/Demo export/i);
    expect(summary).toMatch(/cleanup debt/i);

    const [simplerRequest] = await Promise.all([
      waitForChatRequest(page),
      sendChat(page, 'make it simpler'),
    ]);
    const simplerRequestBody = simplerRequest.postDataJSON() as { history?: Array<{ role: string; content: string }> };
    expect(simplerRequestBody.history).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: 'user', content: 'summarize this' }),
      expect.objectContaining({ role: 'assistant', content: expect.stringMatching(/Demo export/i) }),
    ]));
    await expect(assistantMessages).toHaveCount(3, { timeout: 15000 });
    const simpler = (await assistantMessages.nth(2).innerText()).replace(/\s+/g, ' ').trim();
    expect(simpler.length).toBeLessThan(summary.length);
    expect(simpler).not.toBe(summary);
  });
});
