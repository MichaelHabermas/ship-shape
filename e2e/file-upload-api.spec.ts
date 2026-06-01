/** E2E tests for file upload API auth, presigned URLs, and upload confirmation. */
import { test, expect } from './fixtures/isolated-env';
import { getCsrfToken, loginAndGetSessionCookieHeader } from './fixtures/api-auth';
import { readJsonAs } from './fixtures/typed-json';
import type { FileMetadataResponse, FileUploadInitResponse } from './fixtures/e2e-api-types';


/**
 * File Upload API Tests
 *
 * These tests use mock/local storage for file uploads - no real S3 credentials required.
 * In development, the API uses local file storage instead of S3.
 */

test.describe('File Upload API', () => {
  test('requires authentication for upload endpoint', async ({ page, apiServer }) => {
    const API_URL = apiServer.url;
    // Try to access upload API without being logged in
    // Note: Returns 403 (CSRF) or 401 (auth) depending on which check runs first
    const response = await page.request.post(`${API_URL}/api/files/upload`, {
      data: {
        filename: 'test.png',
        mimeType: 'image/png',
        sizeBytes: 1024,
      },
    });
    // Should be rejected (either 401 unauthorized or 403 CSRF invalid)
    expect([401, 403]).toContain(response.status());

    // Response might be JSON error or HTML error page
    const text = await response.text();
    expect(text.length).toBeGreaterThan(0);
  });

  test('returns presigned upload URL when authenticated', async ({ page, apiServer }) => {
    const API_URL = apiServer.url;
    // Login first
    await loginAndGetSessionCookieHeader(page);

    // Get CSRF token
    const csrfToken = await getCsrfToken(page, API_URL);

    // Request presigned URL
    const response = await page.request.post(`${API_URL}/api/files/upload`, {
      headers: {
        'x-csrf-token': csrfToken,
      },
      data: {
        filename: 'test-image.png',
        mimeType: 'image/png',
        sizeBytes: 1024,
      },
    });

    expect(response.ok()).toBeTruthy();

    const data = await readJsonAs<FileUploadInitResponse>(response);
    expect(data).toHaveProperty('fileId');
    expect(data).toHaveProperty('uploadUrl');
    expect(data).toHaveProperty('s3Key');

    // fileId should be a UUID
    expect(data.fileId).toMatch(/^[0-9a-f-]{36}$/);

    // uploadUrl should be set (either local or S3)
    expect(data.uploadUrl).toBeTruthy();
  });

  test('confirms upload and returns CDN URL', async ({ page, apiServer }) => {
    const API_URL = apiServer.url;
    // Login first
    await loginAndGetSessionCookieHeader(page);

    // Get CSRF token
    const csrfToken = await getCsrfToken(page, API_URL);

    const pngBuffer = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==',
      'base64'
    );

    // Step 1: Request presigned URL
    const uploadResponse = await page.request.post(`${API_URL}/api/files/upload`, {
      headers: {
        'x-csrf-token': csrfToken,
      },
      data: {
        filename: 'confirm-test.png',
        mimeType: 'image/png',
        sizeBytes: pngBuffer.byteLength,
      },
    });
    expect(uploadResponse.ok()).toBeTruthy();
    const uploadData = await readJsonAs<FileUploadInitResponse>(uploadResponse);
    const { fileId, uploadUrl } = uploadData;

    // Step 2: Upload file data (to local endpoint in dev)
    const isLocalUpload = uploadUrl.startsWith('/api/files/');
    if (isLocalUpload) {
      const localUploadResponse = await page.request.post(`${API_URL}${uploadUrl}`, {
        headers: {
          'Content-Type': 'image/png',
          'x-csrf-token': csrfToken,
        },
        data: pngBuffer,
      });
      expect(localUploadResponse.ok()).toBeTruthy();
    }

    // Step 3: Get file metadata to verify cdn_url
    const fileResponse = await page.request.get(`${API_URL}/api/files/${fileId}`);
    expect(fileResponse.ok()).toBeTruthy();

    const fileData = await readJsonAs<FileMetadataResponse>(fileResponse);
    expect(fileData).toHaveProperty('cdn_url');
    expect(fileData.cdn_url).toBeTruthy();
    expect(fileData.status).toBe('uploaded');
  });
});
