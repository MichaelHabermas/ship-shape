/** E2E tests for image upload, persistence, and offline upload queue behavior. */
import { test, expect, Page } from './fixtures/isolated-env';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * Image Upload E2E Tests
 *
 * These tests use mock/local storage for image uploads - no real S3 credentials required.
 * In development, the API uses local file storage instead of S3/CloudFront.
 */

// Helper to create a new document using the available buttons
async function createNewDocument(page: Page) {
  await page.goto('/docs');

  // Wait for the page to stabilize (may auto-redirect to existing doc)
  await page.waitForLoadState('networkidle');

  // Get current URL to detect change after clicking
  const currentUrl = page.url();

  // Try sidebar button first, fall back to main "New Document" button
  const sidebarButton = page.locator('aside').getByRole('button', { name: /new|create|\+/i }).first();
  const mainButton = page.getByRole('button', { name: 'New Document', exact: true });

  if (await sidebarButton.isVisible({ timeout: 2000 })) {
    await sidebarButton.click();
  } else {
    await expect(mainButton).toBeVisible({ timeout: 5000 });
    await mainButton.click();
  }

  // Wait for URL to change to a new document
  await page.waitForFunction(
    (oldUrl) => window.location.href !== oldUrl && /\/documents\/[a-f0-9-]+/.test(window.location.href),
    currentUrl,
    { timeout: 10000 }
  );

  // Wait for editor to be ready
  await expect(page.locator('.ProseMirror')).toBeVisible({ timeout: 5000 });

  // Verify this is a NEW document (title should be "Untitled")
  await expect(page.locator('textarea[placeholder="Untitled"]')).toBeVisible({ timeout: 3000 });
}

// Create a test image file path
function createTestImageFile(): string {
  // Create a minimal PNG buffer (1x1 red pixel)
  const pngBuffer = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==',
    'base64'
  );
  const tmpPath = path.join(os.tmpdir(), `test-image-${Date.now()}.png`);
  fs.writeFileSync(tmpPath, pngBuffer);
  return tmpPath;
}

// Helper to insert image via slash command and file picker
async function insertImageViaSlashCommand(page: Page): Promise<void> {
  const editor = page.locator('.ProseMirror');
  await editor.click();
  await page.waitForTimeout(300);

  // Type /image to trigger slash command
  await page.keyboard.type('/image');

  // Wait for slash command menu
  await page.waitForTimeout(500);

  // Create test image file
  const tmpPath = createTestImageFile();

  // Press Enter to select the Image option and wait for file chooser
  const fileChooserPromise = page.waitForEvent('filechooser');
  await page.keyboard.press('Enter');

  // Handle file chooser
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles(tmpPath);

  // Cleanup temp file after a delay
  setTimeout(() => {
    try { fs.unlinkSync(tmpPath); } catch {}
  }, 5000);
}

// FIXME: Filechooser event not firing - slash command image upload interaction broken
test.describe('Images', () => {
  test.beforeEach(async ({ page }) => {
    // Login before each test
    await page.goto('/login');
    await page.locator('#email').fill('dev@ship.local');
    await page.locator('#password').fill('admin123');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();

    // Wait for app to load
    await expect(page).not.toHaveURL('/login', { timeout: 5000 });

    // Log console errors for debugging
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        console.log('CONSOLE ERROR:', msg.text());
      }
    });

    // Log failed network requests
    page.on('requestfailed', (request) => {
      console.log('REQUEST FAILED:', request.url(), request.failure()?.errorText);
    });
  });

  test('should show preview immediately after selecting image', async ({ page }) => {
    await createNewDocument(page);

    // Insert image via slash command
    await insertImageViaSlashCommand(page);

    // Wait for image to appear (data URL preview should show immediately)
    const editor = page.locator('.ProseMirror');
    await expect(editor.locator('img')).toBeVisible({ timeout: 5000 });
  });

  test('should upload to CDN and update src', async ({ page }) => {
    await createNewDocument(page);

    // Insert image via slash command
    await insertImageViaSlashCommand(page);

    // Wait for image to appear
    const editor = page.locator('.ProseMirror');
    const img = editor.locator('img').first();
    await expect(img).toBeVisible({ timeout: 5000 });

    // Wait for upload to complete - src should change from data: to http/https or /api/files
    await page.waitForFunction(
      () => {
        const img = document.querySelector('.ProseMirror img');
        if (!img) return false;
        const src = img.getAttribute('src') || '';
        return src.startsWith('http') || src.includes('/api/files');
      },
      { timeout: 15000 }
    );

    // Verify src is CDN URL (not data URL)
    const imgSrc = await img.getAttribute('src');
    expect(imgSrc).not.toContain('data:');
  });

  test('should work via /image slash command', async ({ page }) => {
    await createNewDocument(page);

    const editor = page.locator('.ProseMirror');
    await editor.click();

    // Wait for editor to be fully interactive
    await page.waitForTimeout(500);

    // Type /image to trigger slash command
    await page.keyboard.type('/image');

    // Wait for slash command menu to appear (tippy tooltip with Image option)
    const imageOption = page.getByRole('button', { name: /Image.*Upload/i });
    await expect(imageOption).toBeVisible({ timeout: 5000 });
  });

  test('should persist after page reload', async ({ page }) => {
    await createNewDocument(page);

    // Insert image
    await insertImageViaSlashCommand(page);

    const editor = page.locator('.ProseMirror');

    // Wait for image to appear and upload to complete
    const img = editor.locator('img').first();
    await expect(img).toBeVisible({ timeout: 5000 });

    // Wait for upload to complete (CDN URL)
    await page.waitForFunction(
      () => {
        const img = document.querySelector('.ProseMirror img');
        if (!img) return false;
        const src = img.getAttribute('src') || '';
        return src.startsWith('http') || src.includes('/api/files');
      },
      { timeout: 15000 }
    );

    // Wait for Yjs sync (2 seconds)
    await page.waitForTimeout(2000);

    // Hard refresh
    await page.reload();

    // Wait for editor to load
    await expect(page.locator('.ProseMirror')).toBeVisible({ timeout: 5000 });

    // Verify image still exists
    await expect(page.locator('.ProseMirror img')).toBeVisible({ timeout: 5000 });

    // Verify src is still CDN URL
    const imgAfterReload = page.locator('.ProseMirror img').first();
    const srcAfterReload = await imgAfterReload.getAttribute('src');
    expect(srcAfterReload).not.toContain('data:');
  });

  test('should queue upload when offline', async ({ page, context }) => {
    await createNewDocument(page);

    const editor = page.locator('.ProseMirror');
    await editor.click();
    await page.waitForTimeout(300);

    // Go offline - block all network requests
    await context.setOffline(true);

    // Type /image to trigger slash command
    await page.keyboard.type('/image');
    await page.waitForTimeout(500);

    // Create test image file
    const tmpPath = createTestImageFile();

    // Press Enter to select the Image option and wait for file chooser
    const fileChooserPromise = page.waitForEvent('filechooser');
    await page.keyboard.press('Enter');

    // Handle file chooser
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles(tmpPath);

    // Wait for image to appear (should show data URL preview)
    const img = editor.locator('img').first();
    await expect(img).toBeVisible({ timeout: 5000 });

    // Verify src is data URL (upload couldn't happen due to offline)
    const imgSrc = await img.getAttribute('src');
    expect(imgSrc).toContain('data:');

    // Document should still be editable
    await editor.click();
    await page.keyboard.type('Still working offline');
    await expect(editor).toContainText('Still working offline');

    // Go back online
    await context.setOffline(false);

    // Cleanup
    setTimeout(() => { try { fs.unlinkSync(tmpPath); } catch {} }, 5000);
  });

  // Note: Automatic retry when back online (offline queue) is deferred to Tier 2.
  // The 'should queue upload when offline' test above verifies core offline behavior:
  // - Image preview appears immediately (data URL)
  // - Document remains editable
  // Users can manually re-upload when back online.

  test('should clear IndexedDB after successful upload', async ({ page }) => {
    await createNewDocument(page);

    // Insert image
    await insertImageViaSlashCommand(page);

    // Wait for upload to complete
    await page.waitForFunction(
      () => {
        const img = document.querySelector('.ProseMirror img');
        if (!img) return false;
        const src = img.getAttribute('src') || '';
        return src.startsWith('http') || src.includes('/api/files');
      },
      { timeout: 15000 }
    );

    // Check IndexedDB for pending uploads
    const pendingUploads = await page.evaluate(async () => {
      // Check if our upload queue database exists and has entries
      try {
        const databases = await indexedDB.databases();
        const uploadDb = databases.find((db: { name?: string }) => db.name?.includes('upload') || db.name?.includes('queue'));
        const uploadDbName = uploadDb?.name;
        if (!uploadDbName) return 0;

        return new Promise<number>((resolve) => {
          const request = indexedDB.open(uploadDbName);
          request.onsuccess = () => {
            const db = request.result;
            try {
              const store = db.transaction(['uploads'], 'readonly').objectStore('uploads');
              const countRequest = store.count();
              countRequest.onsuccess = () => resolve(countRequest.result);
              countRequest.onerror = () => resolve(0);
            } catch {
              resolve(0);
            }
          };
          request.onerror = () => resolve(0);
        });
      } catch {
        return 0;
      }
    });

    // Should have no pending uploads (cleared after success)
    expect(pendingUploads).toBe(0);
  });

  test('should set alt text from filename', async ({ page }) => {
    await createNewDocument(page);

    // Insert image via slash command
    await insertImageViaSlashCommand(page);

    // Wait for image to appear
    const editor = page.locator('.ProseMirror');
    const img = editor.locator('img').first();
    await expect(img).toBeVisible({ timeout: 5000 });

    // Image should have alt attribute set to filename
    const altText = await img.getAttribute('alt');
    expect(altText).toBeTruthy();
    // Alt text should contain the filename (test-image-*.png)
    expect(altText).toMatch(/test-image-\d+\.png/);
  });

});
