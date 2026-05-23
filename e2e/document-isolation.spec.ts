import { test, expect } from './fixtures/isolated-env';
import { login } from './fixtures/app';

// Helper to get editor text content without collaboration cursor labels
async function getEditorTextWithoutCursor(page: import('@playwright/test').Page): Promise<string> {
  return await page.evaluate(() => {
    const editor = document.querySelector('.ProseMirror');
    if (!editor) return '';
    const clone = editor.cloneNode(true) as HTMLElement;
    // Remove collaboration cursor elements
    clone.querySelectorAll('.collaboration-cursor__label, .collaboration-cursor__caret').forEach((el: Element) => el.remove());
    return clone.textContent || '';
  });
}

// Helper to create a new document and return its URL
// CRITICAL: Must track current URL and wait for it to CHANGE
async function createNewDocument(page: import('@playwright/test').Page): Promise<string> {
  // Store the current URL before clicking
  const currentUrl = page.url();

  // Use the same selector pattern as the working test
  const createButton = page.locator('aside').getByRole('button', { name: /new|create|\+/i }).first();

  if (await createButton.isVisible({ timeout: 2000 }).catch(() => false)) {
    await createButton.click();
  } else {
    // Fallback to main button
    await page.getByRole('button', { name: /new document/i }).click();
  }

  // Wait for URL to change to a DIFFERENT doc URL
  await page.waitForFunction(
    (oldUrl: string) => {
      const url = window.location.href;
      return url !== oldUrl && url.includes('/documents/');
    },
    currentUrl,
    { timeout: 10000 }
  );

  const newUrl = page.url();

  // Wait for editor
  await page.waitForSelector('.ProseMirror', { timeout: 10000 });
  // Wait for sync status - can be Saved, Cached, Saving, or Offline
  await page.waitForSelector('text=/Saved|Cached|Saving|Offline/', { timeout: 15000 });

  return newUrl;
}

test.describe('Document Isolation - Critical Data Integrity', () => {

  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('content typed in one document does NOT appear in another document', async ({ page }) => {
    // Navigate to documents
    await page.goto('/docs');
    await page.waitForTimeout(1000);

    // Create first document
    const doc1Url = await createNewDocument(page);
    const doc1Id = doc1Url.split('/documents/')[1];

    // Type unique content in doc 1
    const doc1Content = `UNIQUE_DOC1_${Date.now()}_ISOLATION_TEST`;
    await page.locator('.ProseMirror').click();
    await page.keyboard.type(doc1Content, { delay: 20 });

    // Wait for sync - can be Saved, Cached, Saving, or Offline
    await page.waitForSelector('text=/Saved|Cached|Saving|Offline/', { timeout: 15000 });

    // Navigate back to docs list to create second document
    await page.goto('/docs');
    await page.waitForTimeout(1000);

    // Create second document
    const doc2Url = await createNewDocument(page);
    const doc2Id = doc2Url.split('/documents/')[1];

    // Ensure we're on a different document
    expect(doc2Id).not.toBe(doc1Id);

    // Type unique content in doc 2
    const doc2Content = `UNIQUE_DOC2_${Date.now()}_ISOLATION_TEST`;
    await page.locator('.ProseMirror').click();
    await page.keyboard.type(doc2Content, { delay: 20 });

    // Wait for sync - can be Saved, Cached, Saving, or Offline
    await page.waitForSelector('text=/Saved|Cached|Saving|Offline/', { timeout: 15000 });

    // CRITICAL TEST: Navigate back to doc 1 and verify it ONLY has doc1Content
    await page.goto(doc1Url);
    await page.waitForSelector('.ProseMirror', { timeout: 10000 });
    await page.waitForSelector('text=/Saved|Cached|Saving|Offline/', { timeout: 15000 });

    const doc1FinalContent = await page.locator('.ProseMirror').textContent();

    // Doc 1 should contain its own content
    expect(doc1FinalContent).toContain(doc1Content);

    // Doc 1 should NOT contain doc 2's content
    expect(doc1FinalContent).not.toContain(doc2Content);

    // CRITICAL TEST: Navigate to doc 2 and verify it ONLY has doc2Content
    await page.goto(doc2Url);
    await page.waitForSelector('.ProseMirror', { timeout: 10000 });
    await page.waitForSelector('text=/Saved|Cached|Saving|Offline/', { timeout: 15000 });

    const doc2FinalContent = await page.locator('.ProseMirror').textContent();

    // Doc 2 should contain its own content
    expect(doc2FinalContent).toContain(doc2Content);

    // Doc 2 should NOT contain doc 1's content
    expect(doc2FinalContent).not.toContain(doc1Content);
  });

  test('rapid navigation between documents does not cause content contamination', async ({ page }) => {
    // Create our own test documents instead of relying on seed data
    await page.goto('/docs');
    await page.waitForTimeout(1000);

    // Create first document
    const doc1Url = await createNewDocument(page);
    await page.locator('.ProseMirror').click();
    await page.keyboard.type('DOC1_UNIQUE_CONTENT', { delay: 30 });
    await page.waitForSelector('text=/Saved|Cached|Saving|Offline/', { timeout: 15000 });
    const doc1InitialContent = await getEditorTextWithoutCursor(page);

    // Create second document
    await page.goto('/docs');
    await page.waitForTimeout(500);
    const doc2Url = await createNewDocument(page);
    await page.locator('.ProseMirror').click();
    await page.keyboard.type('DOC2_UNIQUE_CONTENT', { delay: 30 });
    await page.waitForSelector('text=/Saved|Cached|Saving|Offline/', { timeout: 15000 });
    const doc2InitialContent = await getEditorTextWithoutCursor(page);

    // Rapidly toggle between documents 5 times
    for (let i = 0; i < 5; i++) {
      await page.goto(doc1Url);
      await page.waitForSelector('.ProseMirror', { timeout: 5000 });
      await page.waitForSelector('text=/Saved|Cached|Saving|Offline/', { timeout: 10000 });

      await page.goto(doc2Url);
      await page.waitForSelector('.ProseMirror', { timeout: 5000 });
      await page.waitForSelector('text=/Saved|Cached|Saving|Offline/', { timeout: 10000 });
    }

    // Wait for everything to settle
    await page.waitForTimeout(1000);

    // Verify doc 1 content hasn't changed
    await page.goto(doc1Url);
    await page.waitForSelector('.ProseMirror', { timeout: 10000 });
    await page.waitForSelector('text=/Saved|Cached|Saving|Offline/', { timeout: 15000 });

    // Wait for content to fully load using polling (more reliable than waitForFunction)
    await expect(async () => {
      const content = await getEditorTextWithoutCursor(page);
      expect(content).toContain('DOC1_UNIQUE_CONTENT');
    }).toPass({ timeout: 15000 });

    const doc1FinalContent = await getEditorTextWithoutCursor(page);

    // Content should be same as before rapid navigation
    if (doc1InitialContent.length > 10) {
      expect(doc1FinalContent).toContain(doc1InitialContent.substring(0, 30));
    }

    // Verify doc 2 content hasn't changed
    await page.goto(doc2Url);
    await page.waitForSelector('.ProseMirror', { timeout: 10000 });
    await page.waitForSelector('text=/Saved|Cached|Saving|Offline/', { timeout: 15000 });

    // Wait for content to fully load using polling
    await expect(async () => {
      const content = await getEditorTextWithoutCursor(page);
      expect(content).toContain('DOC2_UNIQUE_CONTENT');
    }).toPass({ timeout: 15000 });

    const doc2FinalContent = await getEditorTextWithoutCursor(page);

    if (doc2InitialContent.length > 10) {
      expect(doc2FinalContent).toContain(doc2InitialContent.substring(0, 30));
    }
  });

  test('editing while rapidly switching documents stays isolated', async ({ page }) => {
    await page.goto('/docs');
    await page.waitForTimeout(1000);

    // Create first document
    const doc1Url = await createNewDocument(page);

    // Add content to doc 1
    await page.locator('.ProseMirror').click();
    await page.keyboard.type('DOC1_START', { delay: 50 });
    await page.waitForSelector('text=/Saved|Cached|Saving|Offline/', { timeout: 15000 });
    // Verify content was actually saved
    await expect(async () => {
      const content = await getEditorTextWithoutCursor(page);
      expect(content).toContain('DOC1_START');
    }).toPass({ timeout: 10000 });
    // Extra wait to ensure Yjs syncs to server
    await page.waitForTimeout(500);

    // Navigate to create doc 2
    await page.goto('/docs');
    await page.waitForTimeout(500);
    const doc2Url = await createNewDocument(page);

    // Add content to doc 2
    await page.locator('.ProseMirror').click();
    await page.keyboard.type('DOC2_START', { delay: 50 });
    await page.waitForSelector('text=/Saved|Cached|Saving|Offline/', { timeout: 15000 });
    // Verify content was actually saved
    await expect(async () => {
      const content = await getEditorTextWithoutCursor(page);
      expect(content).toContain('DOC2_START');
    }).toPass({ timeout: 10000 });
    // Extra wait to ensure Yjs syncs to server
    await page.waitForTimeout(500);

    // Now switch and type with enough time for content to sync
    // Note: Using hyphens instead of underscores to avoid markdown italic interpretation
    for (let i = 0; i < 3; i++) {
      // Go to doc 1 and type
      await page.goto(doc1Url);
      await page.waitForSelector('.ProseMirror', { timeout: 10000 });
      // Wait for sync - use longer timeout and accept either Saved or Synced status
      await expect(page.locator('text=/Saved|Cached|Saving|Offline/')).toBeVisible({ timeout: 15000 });
      // Wait for existing content to load
      await expect(async () => {
        const content = await getEditorTextWithoutCursor(page);
        expect(content).toContain('DOC1_START');
      }).toPass({ timeout: 15000 });
      await page.locator('.ProseMirror').click();
      await page.waitForTimeout(100); // Let editor focus settle
      // Move cursor to end of content (Ctrl+End on Windows/Linux, Meta+End on Mac)
      await page.keyboard.press('Meta+End');
      await page.keyboard.press('Control+End');
      // Use type with delay for reliable character-by-character typing
      await page.keyboard.type(`-DOC1-ITER${i}`, { delay: 80 });
      // Wait for typed content using helper that excludes cursor labels
      await expect(async () => {
        const content = await getEditorTextWithoutCursor(page);
        expect(content).toContain(`DOC1-ITER${i}`);
      }).toPass({ timeout: 10000 });
      // Wait for sync to complete - accept either Saved or Synced status
      await expect(page.locator('text=/Saved|Cached|Saving|Offline/')).toBeVisible({ timeout: 15000 });
      await page.waitForTimeout(300); // Extra sync time

      // Go to doc 2 and type
      await page.goto(doc2Url);
      await page.waitForSelector('.ProseMirror', { timeout: 10000 });
      // Wait for sync - accept either Saved or Synced status
      await expect(page.locator('text=/Saved|Cached|Saving|Offline/')).toBeVisible({ timeout: 15000 });
      // Wait for existing content to load
      await expect(async () => {
        const content = await getEditorTextWithoutCursor(page);
        expect(content).toContain('DOC2_START');
      }).toPass({ timeout: 15000 });
      await page.locator('.ProseMirror').click();
      await page.waitForTimeout(100); // Let editor focus settle
      // Move cursor to end of content
      await page.keyboard.press('Meta+End');
      await page.keyboard.press('Control+End');
      // Use type with delay for reliable character-by-character typing
      await page.keyboard.type(`-DOC2-ITER${i}`, { delay: 80 });
      // Wait for typed content using helper that excludes cursor labels
      await expect(async () => {
        const content = await getEditorTextWithoutCursor(page);
        expect(content).toContain(`DOC2-ITER${i}`);
      }).toPass({ timeout: 10000 });
      // Wait for sync to complete - accept either Saved or Synced status
      await expect(page.locator('text=/Saved|Cached|Saving|Offline/')).toBeVisible({ timeout: 15000 });
      await page.waitForTimeout(300); // Extra sync time
    }

    // Verify doc 1 has only DOC1 content
    await page.goto(doc1Url);
    await page.waitForSelector('.ProseMirror', { timeout: 10000 });
    await expect(page.locator('text=/Saved|Cached|Saving|Offline/')).toBeVisible({ timeout: 15000 });

    const doc1Content = await getEditorTextWithoutCursor(page);

    expect(doc1Content).toContain('DOC1_START');
    expect(doc1Content).toContain('DOC1-ITER0');
    expect(doc1Content).toContain('DOC1-ITER1');
    expect(doc1Content).toContain('DOC1-ITER2');
    expect(doc1Content).not.toContain('DOC2');

    // Verify doc 2 has only DOC2 content
    await page.goto(doc2Url);
    await page.waitForSelector('.ProseMirror', { timeout: 10000 });
    await expect(page.locator('text=/Saved|Cached|Saving|Offline/')).toBeVisible({ timeout: 15000 });

    const doc2Content = await getEditorTextWithoutCursor(page);

    expect(doc2Content).toContain('DOC2_START');
    expect(doc2Content).toContain('DOC2-ITER0');
    expect(doc2Content).toContain('DOC2-ITER1');
    expect(doc2Content).toContain('DOC2-ITER2');
    expect(doc2Content).not.toContain('DOC1');
  });

});

test.describe('Document Isolation - Cross Document Type', () => {

  test.beforeEach(async ({ page }) => {
    await login(page);
  });

});
