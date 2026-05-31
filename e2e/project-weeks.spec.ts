import { test, expect } from './fixtures/isolated-env';
import { loginAsAdminWithUser } from './fixtures/api-auth';
import { readJsonAs } from './fixtures/typed-json';

interface PersonDocument {
  id: string;
  properties?: { user_id?: string };
}

interface ApiDocument {
  id: string;
}

/**
 * E2E tests for Project Weeks tab feature.
 *
 * Tests the complete flow:
 * 1. Create allocation (person assigned to project for a week)
 * 2. Navigate to project's Weeks tab and verify allocation appears
 * 3. Click a cell to open weekly plan document
 * 4. Verify Properties sidebar shows correct context (project and person names)
 * 5. Verify navigation back to project works
 */

// Helper to get person document ID for the current user
async function getPersonIdForUser(
  page: import('@playwright/test').Page,
  apiUrl: string,
  userId: string
): Promise<string> {
  const response = await page.request.get(`${apiUrl}/api/documents?document_type=person`);
  expect(response.ok()).toBe(true);
  const docs = await readJsonAs<PersonDocument[]>(response);
  const person = docs.find(
    (d) => d.properties?.user_id === userId
  );
  expect(person, 'User should have an associated person document').toBeTruthy();
  if (!person) {
    throw new Error('User should have an associated person document');
  }
  return person.id;
}

// Helper to create a project for testing
async function createTestProject(
  page: import('@playwright/test').Page,
  apiUrl: string,
  csrfToken: string,
  title: string
): Promise<string> {
  const response = await page.request.post(`${apiUrl}/api/documents`, {
    headers: { 'x-csrf-token': csrfToken },
    data: {
      title,
      document_type: 'project',
    },
  });
  expect(response.ok()).toBe(true);
  const project = await readJsonAs<ApiDocument>(response);

  const renameResponse = await page.request.patch(`${apiUrl}/api/documents/${project.id}`, {
    headers: { 'x-csrf-token': csrfToken },
    data: { title },
  });
  expect(renameResponse.ok()).toBe(true);

  return project.id;
}

// Helper to create a sprint with allocation
async function createAllocation(
  page: import('@playwright/test').Page,
  apiUrl: string,
  csrfToken: string,
  projectId: string,
  personId: string,
  weekNumber: number
): Promise<string> {
  // Create a sprint document with the person allocated to this project
  const response = await page.request.post(`${apiUrl}/api/documents`, {
    headers: { 'x-csrf-token': csrfToken },
    data: {
      title: `Week ${weekNumber}`,
      document_type: 'sprint',
      properties: {
        sprint_number: weekNumber,
        project_id: projectId,
        assignee_ids: [personId],
        status: 'active',
      },
    },
  });
  expect(response.ok()).toBe(true);
  const sprint = await readJsonAs<ApiDocument>(response);
  return sprint.id;
}

test.describe('Project Weeks Tab', () => {
  test('shows allocated team members in the grid', async ({ page, apiServer }) => {
    const { csrfToken, userId } = await loginAsAdminWithUser(page, apiServer.url);
    const personId = await getPersonIdForUser(page, apiServer.url, userId);

    // Create a test project
    const projectId = await createTestProject(
      page,
      apiServer.url,
      csrfToken,
      'E2E Test Project'
    );

    // Create allocations for weeks unique to this scenario
    await createAllocation(page, apiServer.url, csrfToken, projectId, personId, 20);
    await createAllocation(page, apiServer.url, csrfToken, projectId, personId, 21);

    // Navigate to project's Weeks tab
    await page.goto(`/documents/${projectId}/weeks`);

    // Wait for the grid to load
    await expect(page.locator('text=Team Member')).toBeVisible({ timeout: 10000 });

    // Verify the person appears in the grid (Dev User from seed data)
    await expect(page.locator('text=Dev User')).toBeVisible();

    // Verify we see colored status cells (not dash for unallocated)
    const statusCells = page.locator('button[title*="Weekly Plan"]');
    await expect(statusCells.first()).toBeVisible();
  });

  test('clicking cell opens weekly plan document with context', async ({ page, apiServer }) => {
    const { csrfToken, userId } = await loginAsAdminWithUser(page, apiServer.url);
    const personId = await getPersonIdForUser(page, apiServer.url, userId);

    // Create a test project
    const projectId = await createTestProject(
      page,
      apiServer.url,
      csrfToken,
      'Click Test Project'
    );

    // Create allocation for a week unique to this scenario
    await createAllocation(page, apiServer.url, csrfToken, projectId, personId, 22);

    // Navigate to project's Weeks tab
    await page.goto(`/documents/${projectId}/weeks`);

    // Wait for grid to load
    await expect(page.locator('text=Team Member')).toBeVisible({ timeout: 10000 });

    // Click on the plan status cell (left half of the colored cell)
    const planCell = page.locator('button[title*="Weekly Plan"]').first();
    await expect(planCell).toBeVisible();
    await planCell.click();

    // Wait for navigation to weekly plan document
    await expect(page).toHaveURL(/\/documents\/[a-f0-9-]+$/, { timeout: 10000 });

    // Verify we're on a weekly plan document
    await expect(page.locator('text=Weekly Plan')).toBeVisible();

    // Verify Properties sidebar shows person name (not UUID)
    // The label is just "Person" (without colon), rendered by WeeklyDocumentSidebar
    await expect(page.getByText('Person', { exact: true })).toBeVisible();
    // Use exact match to avoid matching title which includes "- Dev User"
    await expect(page.getByText('Dev User', { exact: true })).toBeVisible();

    // Verify Properties sidebar shows project name as a link
    // Label is "Project" (without colon)
    await expect(page.getByText('Project', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Document properties').getByRole('link', { name: 'Click Test Project' })).toBeVisible();
  });

  test('project link in Properties sidebar navigates back to project', async ({ page, apiServer }) => {
    const { csrfToken, userId } = await loginAsAdminWithUser(page, apiServer.url);
    const personId = await getPersonIdForUser(page, apiServer.url, userId);

    // Create a test project
    const projectId = await createTestProject(
      page,
      apiServer.url,
      csrfToken,
      'Navigation Test Project'
    );

    // Create allocation for a week unique to this scenario
    await createAllocation(page, apiServer.url, csrfToken, projectId, personId, 23);

    // Navigate to project's Weeks tab and click to open weekly plan
    await page.goto(`/documents/${projectId}/weeks`);
    await expect(page.locator('text=Team Member')).toBeVisible({ timeout: 10000 });

    const planCell = page.locator('button[title*="Weekly Plan"]').first();
    await planCell.click();

    // Wait for weekly plan document
    await expect(page.locator('text=Weekly Plan')).toBeVisible({ timeout: 10000 });

    // Click the project link to navigate back
    const projectLink = page.getByLabel('Document properties').getByRole('link', { name: 'Navigation Test Project' });
    await expect(projectLink).toBeVisible();
    await projectLink.click();

    // Verify we're back at the project's Weeks tab
    await expect(page).toHaveURL(new RegExp(`/documents/${projectId}/weeks`), { timeout: 10000 });
    await expect(page.locator('text=Team Member')).toBeVisible();
  });
});

test.describe('Project Allocation Grid API', () => {
  test('GET /project-allocation-grid returns allocated people', async ({ page, apiServer }) => {
    const { csrfToken, userId } = await loginAsAdminWithUser(page, apiServer.url);
    const personId = await getPersonIdForUser(page, apiServer.url, userId);

    // Create project and allocation
    const projectId = await createTestProject(
      page,
      apiServer.url,
      csrfToken,
      'API Test Project'
    );
    await createAllocation(page, apiServer.url, csrfToken, projectId, personId, 15);

    // Query the allocation grid API
    const response = await page.request.get(
      `${apiServer.url}/api/weekly-plans/project-allocation-grid/${projectId}`
    );
    expect(response.ok()).toBe(true);

    const data = await response.json();
    expect(data.projectId).toBe(projectId);
    expect(data.people).toHaveLength(1);
    expect(data.people[0].id).toBe(personId);
    expect(data.people[0].name).toBe('Dev User');
    expect(data.people[0].weeks).toHaveProperty('15');
    expect(data.people[0].weeks[15].isAllocated).toBe(true);
  });

  test('allocation grid shows multiple weeks for same person', async ({ page, apiServer }) => {
    const { csrfToken, userId } = await loginAsAdminWithUser(page, apiServer.url);
    const personId = await getPersonIdForUser(page, apiServer.url, userId);

    // Create project and allocations for multiple weeks
    const projectId = await createTestProject(
      page,
      apiServer.url,
      csrfToken,
      'Multi-Week Test'
    );
    await createAllocation(page, apiServer.url, csrfToken, projectId, personId, 20);
    await createAllocation(page, apiServer.url, csrfToken, projectId, personId, 21);
    await createAllocation(page, apiServer.url, csrfToken, projectId, personId, 22);

    // Query the allocation grid API
    const response = await page.request.get(
      `${apiServer.url}/api/weekly-plans/project-allocation-grid/${projectId}`
    );
    expect(response.ok()).toBe(true);

    const data = await response.json();
    expect(data.people[0].weeks).toHaveProperty('20');
    expect(data.people[0].weeks).toHaveProperty('21');
    expect(data.people[0].weeks).toHaveProperty('22');
    expect(data.people[0].weeks[20].isAllocated).toBe(true);
    expect(data.people[0].weeks[21].isAllocated).toBe(true);
    expect(data.people[0].weeks[22].isAllocated).toBe(true);
  });
});
