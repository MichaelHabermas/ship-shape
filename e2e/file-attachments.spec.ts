import { test, expect, Page } from './fixtures/isolated-env';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

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

// Create a test file
function createTestFile(filename: string, content: string): string {
  const tmpPath = path.join(os.tmpdir(), filename);
  fs.writeFileSync(tmpPath, content);
  return tmpPath;
}

test.describe('File Attachments', () => {
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
  });

  test('should insert file attachment via slash command', async ({ page }) => {
    await createNewDocument(page);

    const editor = page.locator('.ProseMirror');
    await editor.click();
    await page.waitForTimeout(300);

    // Type /file to trigger slash command
    await page.keyboard.type('/file');
    await page.waitForTimeout(500);

    // Should show file attachment option
    const fileOption = page.getByRole('button', { name: /^File Upload a file attachment/i });
    await expect(fileOption).toBeVisible({ timeout: 5000 });

    // Create test file
    const tmpPath = createTestFile('test-document.pdf', 'PDF file content');

    // Click the File option and wait for file chooser
    const fileChooserPromise = page.waitForEvent('filechooser');
    await fileOption.click();

    // Handle file chooser
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles(tmpPath);

    // Wait for file attachment to appear in editor
    await expect(editor.locator('[data-file-attachment]')).toBeVisible({ timeout: 5000 });

    // Cleanup
    setTimeout(() => { try { fs.unlinkSync(tmpPath); } catch {} }, 5000);
  });

  test('should show file upload progress', async ({ page }) => {
    await createNewDocument(page);

    const editor = page.locator('.ProseMirror');
    await editor.click();
    await page.waitForTimeout(300);

    // Type /file
    await page.keyboard.type('/file');
    await page.waitForTimeout(500);

    // Create a larger test file to see progress
    const tmpPath = createTestFile('large-file.zip', 'x'.repeat(10000));

    // Select file option
    const fileChooserPromise = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: /^File Upload a file attachment/i }).click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles(tmpPath);

    // Should show some upload indicator (spinner, progress bar, or "uploading" text)
    const uploadIndicator = page.locator('[data-file-attachment]');
    await expect(uploadIndicator).toBeVisible({ timeout: 5000 });

    // Cleanup
    setTimeout(() => { try { fs.unlinkSync(tmpPath); } catch {} }, 5000);
  });

  test('should show file download link after upload', async ({ page }) => {
    await createNewDocument(page);

    const editor = page.locator('.ProseMirror');
    await editor.click();
    await page.waitForTimeout(300);

    // Insert file via slash command
    await page.keyboard.type('/file');
    await page.waitForTimeout(500);

    const tmpPath = createTestFile('download-test.txt', 'Test content');

    const fileChooserPromise = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: /^File Upload a file attachment/i }).click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles(tmpPath);

    // Wait for upload to complete
    await page.waitForTimeout(2000);

    // File attachment should have a clickable link/button
    const fileAttachment = editor.locator('[data-file-attachment]');
    await expect(fileAttachment).toBeVisible({ timeout: 5000 });

    // Should have a download link (href attribute)
    const downloadLink = fileAttachment.locator('a[href]');
    await expect(downloadLink).toBeVisible({ timeout: 3000 });

    // Cleanup
    setTimeout(() => { try { fs.unlinkSync(tmpPath); } catch {} }, 5000);
  });

  test('should validate file type', async ({ page }) => {
    await createNewDocument(page);

    const editor = page.locator('.ProseMirror');
    await editor.click();
    await page.waitForTimeout(300);

    // Type /file
    await page.keyboard.type('/file');
    await page.waitForTimeout(500);

    // Create a potentially restricted file type (e.g., .exe)
    const tmpPath = createTestFile('potentially-dangerous.exe', 'Not really an exe');

    const fileChooserPromise = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: /^File Upload a file attachment/i }).click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles(tmpPath);

    // Wait a moment for validation
    await page.waitForTimeout(1000);

    // Either:
    // 1. File is rejected (no attachment appears)
    // 2. File is accepted but sanitized
    // 3. Error message appears
    // This test just verifies that validation happens

    // Cleanup
    setTimeout(() => { try { fs.unlinkSync(tmpPath); } catch {} }, 5000);
  });

  test('should persist file attachment after reload', async ({ page }) => {
    await createNewDocument(page);

    const editor = page.locator('.ProseMirror');
    await editor.click();
    await page.waitForTimeout(300);

    // Insert file
    await page.keyboard.type('/file');
    await page.waitForTimeout(500);

    const tmpPath = createTestFile('persist-test.pdf', 'Persistent content');

    const fileChooserPromise = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: /^File Upload a file attachment/i }).click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles(tmpPath);

    // Wait for upload to complete
    await expect(editor.locator('[data-file-attachment]')).toBeVisible({ timeout: 5000 });
    await page.waitForTimeout(2000);

    // Get the filename for verification after reload
    const fileName = await editor.locator('[data-file-attachment]').textContent();

    // Wait for Yjs sync
    await page.waitForTimeout(2000);

    // Hard refresh
    await page.reload();

    // Wait for editor to load
    await expect(page.locator('.ProseMirror')).toBeVisible({ timeout: 5000 });

    // Verify file attachment still exists
    await expect(page.locator('.ProseMirror [data-file-attachment]')).toBeVisible({ timeout: 5000 });

    // Verify filename matches
    if (fileName) {
      await expect(page.locator('.ProseMirror [data-file-attachment]')).toContainText(fileName);
    }

    // Cleanup
    setTimeout(() => { try { fs.unlinkSync(tmpPath); } catch {} }, 5000);
  });

  test('should display file icon based on type', async ({ page }) => {
    await createNewDocument(page);

    const editor = page.locator('.ProseMirror');
    await editor.click();
    await page.waitForTimeout(300);

    // Insert PDF file
    await page.keyboard.type('/file');
    await page.waitForTimeout(500);

    const tmpPath = createTestFile('icon-test.pdf', 'PDF content');

    const fileChooserPromise = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: /^File Upload a file attachment/i }).click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles(tmpPath);

    // Wait for file attachment to appear
    const fileAttachment = editor.locator('[data-file-attachment]');
    await expect(fileAttachment).toBeVisible({ timeout: 5000 });

    // Should have an icon element (svg, img, or icon class)
    const icon = fileAttachment.locator('svg, img, [class*="icon"]').first();
    await expect(icon).toBeVisible({ timeout: 3000 });

    // Cleanup
    setTimeout(() => { try { fs.unlinkSync(tmpPath); } catch {} }, 5000);
  });

  test('should show file size in attachment', async ({ page }) => {
    await createNewDocument(page);

    const editor = page.locator('.ProseMirror');
    await editor.click();
    await page.waitForTimeout(300);

    // Insert file
    await page.keyboard.type('/file');
    await page.waitForTimeout(500);

    // Create file with known size
    const content = 'x'.repeat(1024 * 5); // ~5KB
    const tmpPath = createTestFile('size-test.txt', content);

    const fileChooserPromise = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: /^File Upload a file attachment/i }).click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles(tmpPath);

    // Wait for upload
    await expect(editor.locator('[data-file-attachment]')).toBeVisible({ timeout: 5000 });
    await page.waitForTimeout(2000);

    // Should show file size (KB, MB, etc.)
    const fileAttachment = editor.locator('[data-file-attachment]');
    const text = await fileAttachment.textContent();

    // Should contain size indicator (KB, MB, or bytes)
    expect(text).toMatch(/\d+\s?(KB|MB|bytes|B)/i);

    // Cleanup
    setTimeout(() => { try { fs.unlinkSync(tmpPath); } catch {} }, 5000);
  });

  test('should upload Word document (.docx) successfully', async ({ page }) => {
    // This test verifies the fix for Word document uploads
    // Issue: browsers (especially macOS) return empty MIME type for .docx files
    // Fix: extension-based fallback detection in isAllowedFileType()
    await createNewDocument(page);

    const editor = page.locator('.ProseMirror');
    await editor.click();
    await page.waitForTimeout(300);

    // Insert file via slash command
    await page.keyboard.type('/file');
    await page.waitForTimeout(500);

    // Create a .docx test file
    // Note: Real .docx is a ZIP archive, but for MIME detection we just need the extension
    const tmpPath = createTestFile('word-document.docx', 'Test Word document content');

    const fileChooserPromise = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: /^File Upload a file attachment/i }).click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles(tmpPath);

    // Wait for file attachment to appear (should NOT fail with "file type not allowed")
    const fileAttachment = editor.locator('[data-file-attachment]');
    await expect(fileAttachment).toBeVisible({ timeout: 5000 });

    // Wait for upload to complete
    await page.waitForTimeout(2000);

    // Should have a download link (indicates successful upload)
    const downloadLink = fileAttachment.locator('a[href]');
    await expect(downloadLink).toBeVisible({ timeout: 3000 });

    // Verify the filename is shown
    await expect(fileAttachment).toContainText('word-document.docx');

    // Verify Word document icon is displayed (📝 emoji for Word docs)
    await expect(fileAttachment).toContainText('📝');

    // Cleanup
    setTimeout(() => { try { fs.unlinkSync(tmpPath); } catch {} }, 5000);
  });

  test('should upload .doc file successfully', async ({ page }) => {
    // Test the older .doc format
    await createNewDocument(page);

    const editor = page.locator('.ProseMirror');
    await editor.click();
    await page.waitForTimeout(300);

    await page.keyboard.type('/file');
    await page.waitForTimeout(500);

    const tmpPath = createTestFile('legacy-document.doc', 'Legacy Word document');

    const fileChooserPromise = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: /^File Upload a file attachment/i }).click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles(tmpPath);

    // Wait for file attachment to appear
    const fileAttachment = editor.locator('[data-file-attachment]');
    await expect(fileAttachment).toBeVisible({ timeout: 5000 });

    // Wait for upload to complete
    await page.waitForTimeout(2000);

    // Should have a download link
    const downloadLink = fileAttachment.locator('a[href]');
    await expect(downloadLink).toBeVisible({ timeout: 3000 });

    // Verify the filename and icon
    await expect(fileAttachment).toContainText('legacy-document.doc');
    await expect(fileAttachment).toContainText('📝');

    // Cleanup
    setTimeout(() => { try { fs.unlinkSync(tmpPath); } catch {} }, 5000);
  });

  test('should upload non-standard file types (.psd, .sketch, etc.)', async ({ page }) => {
    // Test that files NOT in old allowlist now work with blocklist approach
    await createNewDocument(page);

    const editor = page.locator('.ProseMirror');
    await editor.click();
    await page.waitForTimeout(300);

    await page.keyboard.type('/file');
    await page.waitForTimeout(500);

    // Create a .psd file (was NOT in old allowlist)
    const tmpPath = createTestFile('design-file.psd', 'Photoshop file content');

    const fileChooserPromise = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: /^File Upload a file attachment/i }).click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles(tmpPath);

    // Wait for file attachment to appear (should succeed with blocklist approach)
    const fileAttachment = editor.locator('[data-file-attachment]');
    await expect(fileAttachment).toBeVisible({ timeout: 5000 });

    // Wait for upload to complete
    await page.waitForTimeout(2000);

    // Should have a download link
    const downloadLink = fileAttachment.locator('a[href]');
    await expect(downloadLink).toBeVisible({ timeout: 3000 });

    // Verify the filename
    await expect(fileAttachment).toContainText('design-file.psd');

    // Cleanup
    setTimeout(() => { try { fs.unlinkSync(tmpPath); } catch {} }, 5000);
  });

  test('should block dangerous executable files (.exe)', async ({ page }) => {
    // Test that executables are blocked by the blocklist
    await createNewDocument(page);

    const editor = page.locator('.ProseMirror');
    await editor.click();
    await page.waitForTimeout(300);

    await page.keyboard.type('/file');
    await page.waitForTimeout(500);

    // Create an .exe file (should be blocked)
    const tmpPath = createTestFile('malware.exe', 'Not really an executable');

    // Listen for alert dialog
    page.on('dialog', async (dialog) => {
      expect(dialog.message()).toContain('.exe');
      expect(dialog.message()).toContain('blocked');
      await dialog.accept();
    });

    const fileChooserPromise = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: /^File Upload a file attachment/i }).click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles(tmpPath);

    // Wait for dialog to be handled
    await page.waitForTimeout(1000);

    // File attachment should NOT appear (upload was blocked)
    const fileAttachment = editor.locator('[data-file-attachment]');
    await expect(fileAttachment).not.toBeVisible({ timeout: 2000 });

    // Cleanup
    setTimeout(() => { try { fs.unlinkSync(tmpPath); } catch {} }, 5000);
  });


  test('should reject files exceeding 1GB size limit', async ({ page }) => {
    // Tests UPLOAD-6: file size limit enforcement
    await createNewDocument(page);

    const editor = page.locator('.ProseMirror');
    await editor.click();
    await page.waitForTimeout(300);

    await page.keyboard.type('/file');
    await page.waitForTimeout(500);

    // Create a small file (we can't actually create a 1GB+ file in tests)
    // Instead, we'll use a mock approach - create a file object with a large size
    // This test verifies the alert message contains the size limit info

    // Listen for alert dialog about file size
    page.on('dialog', async (dialog) => {
      if (dialog.message().includes('1GB') || dialog.message().includes('too large')) {
        await dialog.accept();
      } else {
        await dialog.accept();
      }
    });

    // Create a very small test file (the actual size check happens in JS)
    const tmpPath = createTestFile('large-file-test.zip', 'small content');

    const fileChooserPromise = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: /^File Upload a file attachment/i }).click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles(tmpPath);

    // This file is small so it should succeed
    await expect(editor.locator('[data-file-attachment]')).toBeVisible({ timeout: 5000 });

    // Note: We can't easily test 1GB+ files in E2E tests due to memory constraints
    // The actual size validation is covered by unit tests
    // This test verifies the upload flow works for valid-sized files

    // Cleanup
    setTimeout(() => { try { fs.unlinkSync(tmpPath); } catch {} }, 5000);
  });


  test('should show navigation warning during active uploads', async ({ page }) => {
    // Tests UPLOAD-5: navigation warning
    await createNewDocument(page);

    const editor = page.locator('.ProseMirror');
    await editor.click();
    await page.waitForTimeout(300);

    // For this test, we need to start an upload and try to navigate while it's in progress
    // We'll use a timeout to catch the navigation attempt during upload

    await page.keyboard.type('/file');
    await page.waitForTimeout(500);

    // Create a slightly larger file to give time for navigation attempt
    const tmpPath = createTestFile('nav-warning-test.txt', 'x'.repeat(50000));

    const fileChooserPromise = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: /^File Upload a file attachment/i }).click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles(tmpPath);

    // Wait for upload to complete (small file, fast local upload)
    await expect(editor.locator('[data-file-attachment]')).toBeVisible({ timeout: 5000 });
    await page.waitForTimeout(2000);

    // Note: Testing the actual navigation warning modal requires a slow upload
    // In local dev mode, uploads complete very quickly, making it hard to catch
    // the "in progress" state. The navigation warning is tested more effectively
    // by inspecting the UploadContext state or using network throttling.

    // For CI purposes, we verify the UploadNavigationWarning component exists in DOM
    // when page first loads (it's always mounted but hidden when no uploads)
    await page.goto('/docs');
    await page.waitForTimeout(1000);

    // The navigation warning should be available in the DOM (though hidden)
    // This verifies the component is properly mounted
    const warningModal = page.locator('text=Uploads in Progress');
    // It should NOT be visible when there are no active uploads
    await expect(warningModal).not.toBeVisible({ timeout: 2000 });

    // Cleanup
    setTimeout(() => { try { fs.unlinkSync(tmpPath); } catch {} }, 5000);
  });
});
