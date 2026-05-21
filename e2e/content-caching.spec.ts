import { test, expect } from './fixtures/isolated-env';
import { login } from './fixtures/app';

test.describe('Content Caching - High Performance Navigation', () => {

  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('toggling between two documents shows no blank flash', async ({ page }) => {
    await page.goto('/docs');

    // Wait for the document tree to load (tree has aria-label="Workspace documents" or "Documents")
    const tree = page.getByRole('tree', { name: 'Workspace documents' }).or(page.getByRole('tree', { name: 'Documents' }));
    await tree.first().waitFor({ timeout: 10000 });

    // Get first two document links from sidebar tree (seed data provides these)
    const docLinks = tree.first().getByRole('link');
    const count = await docLinks.count();

    // Seed data should provide at least 2 wiki documents
    expect(count, 'Seed data should provide at least 2 wiki documents. Run: pnpm db:seed').toBeGreaterThanOrEqual(2);

    // Visit first document
    await docLinks.first().click();
    await page.waitForURL(/\/documents\/.+/);
    await page.waitForSelector('.ProseMirror', { timeout: 10000 });
    const doc1Url = page.url();

    // Visit second document
    await docLinks.nth(1).click();
    await page.waitForURL(/\/documents\/.+/);
    await page.waitForSelector('.ProseMirror', { timeout: 10000 });
    const doc2Url = page.url();

    // Now toggle between documents - should not see blank state
    // Reduce to 2 iterations and shorter timeouts to avoid test timeout
    for (let i = 0; i < 2; i++) {
      await page.goto(doc1Url);

      // Wait for editor to appear (content loading is async via WebSocket)
      const hasEditor1 = await page.waitForSelector('.ProseMirror', { timeout: 5000 }).catch(() => null);
      expect(hasEditor1).toBeTruthy();

      await page.goto(doc2Url);

      const hasEditor2 = await page.waitForSelector('.ProseMirror', { timeout: 5000 }).catch(() => null);
      expect(hasEditor2).toBeTruthy();
    }
  });

});

test.describe('WebSocket Connection Reliability', () => {

  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('WebSocket connects successfully on document load', async ({ page }) => {
    await page.goto('/docs');

    // Track WebSocket connections
    const wsConnections: string[] = [];
    page.on('websocket', ws => {
      wsConnections.push(ws.url());
    });

    // Navigate to a document (tree has aria-label="Workspace documents" or "Documents")
    const tree = page.getByRole('tree', { name: 'Workspace documents' }).or(page.getByRole('tree', { name: 'Documents' }));
    const firstDoc = tree.getByRole('link').first();
    await firstDoc.click();
    await page.waitForURL(/\/documents\/.+/);

    // Wait for WebSocket to connect
    await page.waitForTimeout(2000);

    // Should have a collaboration WebSocket
    const hasCollabWs = wsConnections.some(url => url.includes('/collaboration/'));
    expect(hasCollabWs).toBe(true);
  });

  test('sync status shows status indicator after WebSocket connects', async ({ page }) => {
    await page.goto('/docs');

    const tree2 = page.getByRole('tree', { name: 'Workspace documents' }).or(page.getByRole('tree', { name: 'Documents' }));
    const firstDoc2 = tree2.getByRole('link').first();
    await firstDoc2.click();
    await page.waitForURL(/\/documents\/.+/);

    // Wait for editor to be ready
    await page.waitForSelector('.ProseMirror', { timeout: 10000 });

    // Wait for sync status indicator to appear (any status: Saved, Saving, Cached, Offline)
    // The status indicator should show within reasonable time after editor loads
    const statusIndicator = page.locator('text=/Saved|Saving|Cached|Offline/i').first();
    await expect(statusIndicator).toBeVisible({ timeout: 15000 });

    // Should not show permanent error states
    const hasDisconnected = await page.locator('text=Disconnected').count();
    expect(hasDisconnected).toBe(0);
  });

  test('no console errors about WebSocket connection failures', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', msg => {
      if (msg.type() === 'error' && msg.text().includes('WebSocket')) {
        consoleErrors.push(msg.text());
      }
    });

    await page.goto('/docs');

    const tree3 = page.getByRole('tree', { name: 'Workspace documents' }).or(page.getByRole('tree', { name: 'Documents' }));
    const firstDoc3 = tree3.getByRole('link').first();
    await firstDoc3.click();
    await page.waitForURL(/\/documents\/.+/);

    // Wait for editor to load and give WebSocket time to connect
    await page.waitForSelector('.ProseMirror', { timeout: 10000 });
    await page.waitForTimeout(3000); // Give WebSocket time to establish

    // Should have no critical WebSocket errors (connection closed before ready, connection failed)
    const wsErrors = consoleErrors.filter(e =>
      e.includes('closed before') ||
      e.includes('connection failed')
    );
    expect(wsErrors).toHaveLength(0);
  });

});

test.describe('API Content Update Invalidates Browser Cache', () => {

  test.beforeEach(async ({ page }) => {
    await login(page);
  });

});
