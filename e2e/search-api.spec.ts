import { test, expect } from './fixtures/isolated-env';
import { loginAndGetSessionCookieHeader } from './fixtures/api-auth';

test.describe('Search API', () => {
  test('requires authentication', async ({ page, apiServer }) => {
    // Try to access search API without being logged in
    const response = await page.request.get(`${apiServer.url}/api/search/mentions?q=test`);
    expect(response.status()).toBe(401);

    const data = await response.json();
    expect(data.error).toBeTruthy();
  });

  test('returns people when searching for person documents', async ({ page, apiServer }) => {
    // Login first
    await loginAndGetSessionCookieHeader(page);

    // Search for people (seed data should have person documents)
    const response = await page.request.get(`${apiServer.url}/api/search/mentions?q=admin`);
    expect(response.ok()).toBeTruthy();

    const data = await response.json();
    expect(data).toHaveProperty('people');
    expect(data).toHaveProperty('documents');
    expect(Array.isArray(data.people)).toBe(true);
    expect(Array.isArray(data.documents)).toBe(true);
  });

  test('returns documents when searching for wiki/issue/project', async ({ page, apiServer }) => {
    // Login first
    await loginAndGetSessionCookieHeader(page);

    // Search with empty query to get all results
    const response = await page.request.get(`${apiServer.url}/api/search/mentions?q=`);
    expect(response.ok()).toBeTruthy();

    const data = await response.json();
    expect(data).toHaveProperty('documents');
    expect(Array.isArray(data.documents)).toBe(true);

    // Each document should have id, title, and document_type
    for (const doc of data.documents) {
      expect(doc).toHaveProperty('id');
      expect(doc).toHaveProperty('title');
      expect(doc).toHaveProperty('document_type');
      // Should only return wiki, issue, project, program types
      expect(['wiki', 'issue', 'project', 'program']).toContain(doc.document_type);
    }
  });

  test('limits results to reasonable count', async ({ page, apiServer }) => {
    // Login first
    await loginAndGetSessionCookieHeader(page);

    // Search with empty query to get all results
    const response = await page.request.get(`${apiServer.url}/api/search/mentions?q=`);
    expect(response.ok()).toBeTruthy();

    const data = await response.json();

    // People should be limited to 5
    expect(data.people.length).toBeLessThanOrEqual(5);

    // Documents should be limited to 10
    expect(data.documents.length).toBeLessThanOrEqual(10);
  });
});
