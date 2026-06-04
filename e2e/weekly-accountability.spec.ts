// E2E: Weekly accountability plans, retros, allocation grid, and content history (API).
import { test, expect } from './fixtures/isolated-env';
import type { Page } from '@playwright/test';
import { loginAsAdminWithUser } from './fixtures/api-auth';
import { readJsonAs } from './fixtures/typed-json';
import type {
  ApiId,
  ContentHistoryResponse,
  PersonDocument,
  ProjectAllocationGridResponse,
  SimpleErrorBody,
  WeeklyPlanDocument,
  WeeklyRetroDocument,
} from './fixtures/e2e-api-types';

// Helper to get person document ID for the current user
async function getPersonIdForUser(
  page: Page,
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
  page: Page,
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
  const project = await readJsonAs<ApiId>(response);

  const renameResponse = await page.request.patch(`${apiUrl}/api/documents/${project.id}`, {
    headers: { 'x-csrf-token': csrfToken },
    data: { title },
  });
  expect(renameResponse.ok()).toBe(true);

  return project.id;
}

test.describe('Weekly Plan API', () => {
  test('POST /weekly-plans creates new weekly plan document', async ({ page, apiServer }) => {
    const { csrfToken, userId } = await loginAsAdminWithUser(page, apiServer.url);
    const personId = await getPersonIdForUser(page, apiServer.url, userId);
    const projectId = await createTestProject(page, apiServer.url, csrfToken, 'Test Project for Weekly Plan');

    // Create weekly plan
    const response = await page.request.post(`${apiServer.url}/api/weekly-plans`, {
      headers: { 'x-csrf-token': csrfToken },
      data: {
        person_id: personId,
        project_id: projectId,
        week_number: 1,
      },
    });

    expect(response.status()).toBe(201);
    const plan = await readJsonAs<WeeklyPlanDocument>(response);

    expect(plan.id).toBeTruthy();
    expect(plan.document_type).toBe('weekly_plan');
    // API returns computed title with person name (e.g., "Week 1 Plan - Dev User")
    expect(plan.title).toMatch(/^Week \d+ Plan/)
    expect(plan.properties.person_id).toBe(personId);
    expect(plan.properties.project_id).toBe(projectId);
    expect(plan.properties.week_number).toBe(1);
    expect(plan.properties.submitted_at).toBeNull();
  });

  test('POST /weekly-plans is idempotent - returns existing document', async ({ page, apiServer }) => {
    const { csrfToken, userId } = await loginAsAdminWithUser(page, apiServer.url);
    const personId = await getPersonIdForUser(page, apiServer.url, userId);
    const projectId = await createTestProject(page, apiServer.url, csrfToken, 'Test Project Idempotent');

    const planData = {
      person_id: personId,
      project_id: projectId,
      week_number: 2,
    };

    // First creation - should return 201
    const response1 = await page.request.post(`${apiServer.url}/api/weekly-plans`, {
      headers: { 'x-csrf-token': csrfToken },
      data: planData,
    });
    expect(response1.status()).toBe(201);
    const plan1 = await readJsonAs<WeeklyPlanDocument>(response1);

    // Second creation with same inputs - should return 200 with same ID
    const response2 = await page.request.post(`${apiServer.url}/api/weekly-plans`, {
      headers: { 'x-csrf-token': csrfToken },
      data: planData,
    });
    expect(response2.status()).toBe(200);
    const plan2 = await readJsonAs<WeeklyPlanDocument>(response2);

    // Same document should be returned
    expect(plan2.id).toBe(plan1.id);
    expect(plan2.properties.week_number).toBe(2);
  });

  test('GET /weekly-plans queries plans by person and project', async ({ page, apiServer }) => {
    const { csrfToken, userId } = await loginAsAdminWithUser(page, apiServer.url);
    const personId = await getPersonIdForUser(page, apiServer.url, userId);
    const projectId = await createTestProject(page, apiServer.url, csrfToken, 'Test Project Query');

    // Create a few plans
    for (const weekNum of [3, 4, 5]) {
      await page.request.post(`${apiServer.url}/api/weekly-plans`, {
        headers: { 'x-csrf-token': csrfToken },
        data: {
          person_id: personId,
          project_id: projectId,
          week_number: weekNum,
        },
      });
    }

    // Query by person_id and project_id
    const response = await page.request.get(
      `${apiServer.url}/api/weekly-plans?person_id=${personId}&project_id=${projectId}`
    );
    expect(response.ok()).toBe(true);
    const plans = await readJsonAs<WeeklyPlanDocument[]>(response);

    expect(plans.length).toBeGreaterThanOrEqual(3);
    for (const plan of plans) {
      expect(plan.document_type).toBe('weekly_plan');
      expect(plan.properties.person_id).toBe(personId);
      expect(plan.properties.project_id).toBe(projectId);
    }
  });

  test('GET /weekly-plans/:id returns specific plan', async ({ page, apiServer }) => {
    const { csrfToken, userId } = await loginAsAdminWithUser(page, apiServer.url);
    const personId = await getPersonIdForUser(page, apiServer.url, userId);
    const projectId = await createTestProject(page, apiServer.url, csrfToken, 'Test Project Get By ID');

    // Create a plan
    const createResponse = await page.request.post(`${apiServer.url}/api/weekly-plans`, {
      headers: { 'x-csrf-token': csrfToken },
      data: {
        person_id: personId,
        project_id: projectId,
        week_number: 6,
      },
    });
    const created = await readJsonAs<WeeklyPlanDocument>(createResponse);

    // Get by ID
    const getResponse = await page.request.get(`${apiServer.url}/api/weekly-plans/${created.id}`);
    expect(getResponse.ok()).toBe(true);
    const plan = await readJsonAs<WeeklyPlanDocument>(getResponse);

    expect(plan.id).toBe(created.id);
    expect(plan.properties.week_number).toBe(6);
  });

  test('POST /weekly-plans returns 404 for non-existent person', async ({ page, apiServer }) => {
    const { csrfToken } = await loginAsAdminWithUser(page, apiServer.url);
    const projectId = await createTestProject(page, apiServer.url, csrfToken, 'Test Project 404 Person');

    const response = await page.request.post(`${apiServer.url}/api/weekly-plans`, {
      headers: { 'x-csrf-token': csrfToken },
      data: {
        person_id: '00000000-0000-0000-0000-000000000000',
        project_id: projectId,
        week_number: 1,
      },
    });

    expect(response.status()).toBe(404);
    const error = await readJsonAs<SimpleErrorBody>(response);
    expect(error.error).toBe('Person not found');
  });

  test('POST /weekly-plans returns 404 for non-existent project', async ({ page, apiServer }) => {
    const { csrfToken, userId } = await loginAsAdminWithUser(page, apiServer.url);
    const personId = await getPersonIdForUser(page, apiServer.url, userId);

    const response = await page.request.post(`${apiServer.url}/api/weekly-plans`, {
      headers: { 'x-csrf-token': csrfToken },
      data: {
        person_id: personId,
        project_id: '00000000-0000-0000-0000-000000000000',
        week_number: 1,
      },
    });

    expect(response.status()).toBe(404);
    const error = await readJsonAs<SimpleErrorBody>(response);
    expect(error.error).toBe('Project not found');
  });
});

test.describe('Weekly Retro API', () => {
  test('POST /weekly-retros creates new weekly retro document', async ({ page, apiServer }) => {
    const { csrfToken, userId } = await loginAsAdminWithUser(page, apiServer.url);
    const personId = await getPersonIdForUser(page, apiServer.url, userId);
    const projectId = await createTestProject(page, apiServer.url, csrfToken, 'Test Project for Weekly Retro');

    // Create weekly retro
    const response = await page.request.post(`${apiServer.url}/api/weekly-retros`, {
      headers: { 'x-csrf-token': csrfToken },
      data: {
        person_id: personId,
        project_id: projectId,
        week_number: 1,
      },
    });

    expect(response.status()).toBe(201);
    const retro = await readJsonAs<WeeklyRetroDocument>(response);

    expect(retro.id).toBeTruthy();
    expect(retro.document_type).toBe('weekly_retro');
    // API returns computed title with person name (e.g., "Week 1 Retro - Dev User")
    expect(retro.title).toMatch(/^Week \d+ Retro/)
    expect(retro.properties.person_id).toBe(personId);
    expect(retro.properties.project_id).toBe(projectId);
    expect(retro.properties.week_number).toBe(1);
    expect(retro.properties.submitted_at).toBeNull();
  });

  test('POST /weekly-retros is idempotent - returns existing document', async ({ page, apiServer }) => {
    const { csrfToken, userId } = await loginAsAdminWithUser(page, apiServer.url);
    const personId = await getPersonIdForUser(page, apiServer.url, userId);
    const projectId = await createTestProject(page, apiServer.url, csrfToken, 'Test Project Retro Idempotent');

    const retroData = {
      person_id: personId,
      project_id: projectId,
      week_number: 2,
    };

    // First creation - should return 201
    const response1 = await page.request.post(`${apiServer.url}/api/weekly-retros`, {
      headers: { 'x-csrf-token': csrfToken },
      data: retroData,
    });
    expect(response1.status()).toBe(201);
    const retro1 = await readJsonAs<WeeklyRetroDocument>(response1);

    // Second creation with same inputs - should return 200 with same ID
    const response2 = await page.request.post(`${apiServer.url}/api/weekly-retros`, {
      headers: { 'x-csrf-token': csrfToken },
      data: retroData,
    });
    expect(response2.status()).toBe(200);
    const retro2 = await readJsonAs<WeeklyRetroDocument>(response2);

    // Same document should be returned
    expect(retro2.id).toBe(retro1.id);
    expect(retro2.properties.week_number).toBe(2);
  });

  test('GET /weekly-retros queries retros by person and project', async ({ page, apiServer }) => {
    const { csrfToken, userId } = await loginAsAdminWithUser(page, apiServer.url);
    const personId = await getPersonIdForUser(page, apiServer.url, userId);
    const projectId = await createTestProject(page, apiServer.url, csrfToken, 'Test Project Retro Query');

    // Create a few retros
    for (const weekNum of [3, 4, 5]) {
      await page.request.post(`${apiServer.url}/api/weekly-retros`, {
        headers: { 'x-csrf-token': csrfToken },
        data: {
          person_id: personId,
          project_id: projectId,
          week_number: weekNum,
        },
      });
    }

    // Query by person_id and project_id
    const response = await page.request.get(
      `${apiServer.url}/api/weekly-retros?person_id=${personId}&project_id=${projectId}`
    );
    expect(response.ok()).toBe(true);
    const retros = await readJsonAs<WeeklyRetroDocument[]>(response);

    expect(retros.length).toBeGreaterThanOrEqual(3);
    for (const retro of retros) {
      expect(retro.document_type).toBe('weekly_retro');
      expect(retro.properties.person_id).toBe(personId);
      expect(retro.properties.project_id).toBe(projectId);
    }
  });

  test('GET /weekly-retros/:id returns specific retro', async ({ page, apiServer }) => {
    const { csrfToken, userId } = await loginAsAdminWithUser(page, apiServer.url);
    const personId = await getPersonIdForUser(page, apiServer.url, userId);
    const projectId = await createTestProject(page, apiServer.url, csrfToken, 'Test Project Retro Get By ID');

    // Create a retro
    const createResponse = await page.request.post(`${apiServer.url}/api/weekly-retros`, {
      headers: { 'x-csrf-token': csrfToken },
      data: {
        person_id: personId,
        project_id: projectId,
        week_number: 6,
      },
    });
    const created = await readJsonAs<WeeklyRetroDocument>(createResponse);

    // Get by ID
    const getResponse = await page.request.get(`${apiServer.url}/api/weekly-retros/${created.id}`);
    expect(getResponse.ok()).toBe(true);
    const retro = await readJsonAs<WeeklyRetroDocument>(getResponse);

    expect(retro.id).toBe(created.id);
    expect(retro.properties.week_number).toBe(6);
  });
});

test.describe('Project Allocation Grid API', () => {
  test('GET /project-allocation-grid/:projectId returns grid data structure', async ({
    page,
    apiServer,
  }) => {
    const { csrfToken } = await loginAsAdminWithUser(page, apiServer.url);
    const projectId = await createTestProject(page, apiServer.url, csrfToken, 'Test Project Grid');

    // Get allocation grid
    const response = await page.request.get(
      `${apiServer.url}/api/weekly-plans/project-allocation-grid/${projectId}`
    );

    expect(response.ok(), `Expected 200 OK but got ${response.status()}`).toBe(true);
    const grid = await readJsonAs<ProjectAllocationGridResponse>(response);

    // Verify structure
    expect(grid.projectId).toBe(projectId);
    expect(grid.projectTitle).toBe('Test Project Grid');
    expect(grid.currentSprintNumber).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(grid.weeks)).toBe(true);
    expect(Array.isArray(grid.people)).toBe(true);

    // Weeks have correct structure
    for (const week of grid.weeks) {
      expect(week.number).toBeGreaterThanOrEqual(1);
      expect(week.name).toContain('Week');
      expect(week.startDate).toBeTruthy();
      expect(week.endDate).toBeTruthy();
      expect(typeof week.isCurrent).toBe('boolean');
    }
  });

  test('Allocation grid shows person with assigned issues and plan/retro status', async ({
    page,
    apiServer,
  }) => {
    const { csrfToken, userId } = await loginAsAdminWithUser(page, apiServer.url);
    const personId = await getPersonIdForUser(page, apiServer.url, userId);
    const projectId = await createTestProject(page, apiServer.url, csrfToken, 'Test Project Allocation');

    // Create a program for the sprint
    const programResponse = await page.request.post(`${apiServer.url}/api/documents`, {
      headers: { 'x-csrf-token': csrfToken },
      data: {
        title: 'Test Program for Allocation',
        document_type: 'program',
      },
    });
    const program = await readJsonAs<ApiId>(programResponse);

    // Create a sprint for the current week
    const sprintResponse = await page.request.post(`${apiServer.url}/api/weeks`, {
      headers: { 'x-csrf-token': csrfToken },
      data: {
        title: 'Test Sprint',
        program_id: program.id,
        sprint_number: 1,
        owner_id: userId,
      },
    });
    const sprint = await readJsonAs<ApiId>(sprintResponse);

    // Set sprint properties for project assignment and person allocation
    // The allocation grid API queries properties.project_id and properties.assignee_ids
    await page.request.patch(`${apiServer.url}/api/documents/${sprint.id}`, {
      headers: { 'x-csrf-token': csrfToken },
      data: {
        properties: {
          project_id: projectId,
          assignee_ids: [personId],
          sprint_number: 1,
        },
      },
    });

    // Create an issue assigned to the person (not user), in the sprint
    // Note: assignee_id must be the person document ID, not the user ID
    await page.request.post(`${apiServer.url}/api/issues`, {
      headers: { 'x-csrf-token': csrfToken },
      data: {
        title: 'Test Issue for Allocation',
        assignee_id: personId,
        estimate: 4, // Required when assigning to sprint
        belongs_to: [
          { id: sprint.id, type: 'sprint' },
          { id: program.id, type: 'program' },
        ],
      },
    });

    // Create a weekly plan for the person on this project
    const planResponse = await page.request.post(`${apiServer.url}/api/weekly-plans`, {
      headers: { 'x-csrf-token': csrfToken },
      data: {
        person_id: personId,
        project_id: projectId,
        week_number: 1,
      },
    });
    const plan = await readJsonAs<WeeklyPlanDocument>(planResponse);

    // Get allocation grid
    const gridResponse = await page.request.get(
      `${apiServer.url}/api/weekly-plans/project-allocation-grid/${projectId}`
    );

    expect(gridResponse.ok(), `Expected 200 OK but got ${gridResponse.status()}`).toBe(true);
    const grid = await readJsonAs<ProjectAllocationGridResponse>(gridResponse);

    // Find person in grid
    const personInGrid = grid.people.find((p) => p.id === personId);
    expect(personInGrid, 'Person should appear in allocation grid').toBeTruthy();
    if (!personInGrid) {
      throw new Error('Person should appear in allocation grid');
    }

    // Person should have week 1 data
    const week1Data = personInGrid.weeks[1];
    if (week1Data) {
      expect(week1Data.isAllocated).toBe(true);
      expect(week1Data.planId).toBe(plan.id);
    }
  });

  test('Allocation grid returns 404 for non-existent project', async ({ page, apiServer }) => {
    await loginAsAdminWithUser(page, apiServer.url);

    const response = await page.request.get(
      `${apiServer.url}/api/weekly-plans/project-allocation-grid/00000000-0000-0000-0000-000000000000`
    );

    expect(response.status()).toBe(404);
    const error = await readJsonAs<SimpleErrorBody>(response);
    expect(error.error).toBe('Project not found');
  });
});

test.describe('Content Version History API', () => {
  test('GET /weekly-plans/:id/history returns empty array for new document', async ({
    page,
    apiServer,
  }) => {
    const { csrfToken, userId } = await loginAsAdminWithUser(page, apiServer.url);
    const personId = await getPersonIdForUser(page, apiServer.url, userId);
    const projectId = await createTestProject(page, apiServer.url, csrfToken, 'Test Project History Empty');

    // Create weekly plan
    const createResponse = await page.request.post(`${apiServer.url}/api/weekly-plans`, {
      headers: { 'x-csrf-token': csrfToken },
      data: {
        person_id: personId,
        project_id: projectId,
        week_number: 1,
      },
    });
    const plan = await readJsonAs<WeeklyPlanDocument>(createResponse);

    // Get history - should be empty for new document
    const historyResponse = await page.request.get(
      `${apiServer.url}/api/weekly-plans/${plan.id}/history`
    );
    expect(historyResponse.ok()).toBe(true);
    const history = await readJsonAs<ContentHistoryResponse>(historyResponse);

    expect(Array.isArray(history)).toBe(true);
    expect(history.length).toBe(0);
  });

  test('GET /weekly-retros/:id/history returns empty array for new document', async ({
    page,
    apiServer,
  }) => {
    const { csrfToken, userId } = await loginAsAdminWithUser(page, apiServer.url);
    const personId = await getPersonIdForUser(page, apiServer.url, userId);
    const projectId = await createTestProject(page, apiServer.url, csrfToken, 'Test Project Retro History');

    // Create weekly retro
    const createResponse = await page.request.post(`${apiServer.url}/api/weekly-retros`, {
      headers: { 'x-csrf-token': csrfToken },
      data: {
        person_id: personId,
        project_id: projectId,
        week_number: 1,
      },
    });
    const retro = await readJsonAs<WeeklyRetroDocument>(createResponse);

    // Get history - should be empty for new document
    const historyResponse = await page.request.get(
      `${apiServer.url}/api/weekly-retros/${retro.id}/history`
    );
    expect(historyResponse.ok()).toBe(true);
    const history = await readJsonAs<ContentHistoryResponse>(historyResponse);

    expect(Array.isArray(history)).toBe(true);
    expect(history.length).toBe(0);
  });

  test('GET /weekly-plans/:id/history returns 404 for non-existent plan', async ({
    page,
    apiServer,
  }) => {
    await loginAsAdminWithUser(page, apiServer.url);

    const response = await page.request.get(
      `${apiServer.url}/api/weekly-plans/00000000-0000-0000-0000-000000000000/history`
    );

    expect(response.status()).toBe(404);
    const error = await readJsonAs<SimpleErrorBody>(response);
    expect(error.error).toBe('Weekly plan not found');
  });

  test('GET /weekly-retros/:id/history returns 404 for non-existent retro', async ({
    page,
    apiServer,
  }) => {
    await loginAsAdminWithUser(page, apiServer.url);

    const response = await page.request.get(
      `${apiServer.url}/api/weekly-retros/00000000-0000-0000-0000-000000000000/history`
    );

    expect(response.status()).toBe(404);
    const error = await readJsonAs<SimpleErrorBody>(response);
    expect(error.error).toBe('Weekly retro not found');
  });
});

test.describe('Weekly Plan/Retro Document Navigation', () => {
  test('Weekly plan document can be fetched and navigated to', async ({ page, apiServer }) => {
    const { csrfToken, userId } = await loginAsAdminWithUser(page, apiServer.url);
    const personId = await getPersonIdForUser(page, apiServer.url, userId);
    const projectId = await createTestProject(page, apiServer.url, csrfToken, 'Test Project Navigation');

    // Create weekly plan
    const createResponse = await page.request.post(`${apiServer.url}/api/weekly-plans`, {
      headers: { 'x-csrf-token': csrfToken },
      data: {
        person_id: personId,
        project_id: projectId,
        week_number: 1,
      },
    });
    const plan = await readJsonAs<WeeklyPlanDocument>(createResponse);

    // Navigate to the document
    await page.goto(`/documents/${plan.id}`);

    // Verify we're on the document page (not redirected to login)
    await expect(page).not.toHaveURL('/login', { timeout: 5000 });

    // The URL should contain the document ID
    expect(page.url()).toContain(`/documents/${plan.id}`);
  });

  test('Weekly retro document can be fetched and navigated to', async ({ page, apiServer }) => {
    const { csrfToken, userId } = await loginAsAdminWithUser(page, apiServer.url);
    const personId = await getPersonIdForUser(page, apiServer.url, userId);
    const projectId = await createTestProject(page, apiServer.url, csrfToken, 'Test Project Retro Nav');

    // Create weekly retro
    const createResponse = await page.request.post(`${apiServer.url}/api/weekly-retros`, {
      headers: { 'x-csrf-token': csrfToken },
      data: {
        person_id: personId,
        project_id: projectId,
        week_number: 1,
      },
    });
    const retro = await readJsonAs<WeeklyRetroDocument>(createResponse);

    // Navigate to the document
    await page.goto(`/documents/${retro.id}`);

    // Verify we're on the document page (not redirected to login)
    await expect(page).not.toHaveURL('/login', { timeout: 5000 });

    // The URL should contain the document ID
    expect(page.url()).toContain(`/documents/${retro.id}`);
  });
});
