/** E2E visual verification for plan/retro review request-changes and approve flows. */
import { test, expect } from './fixtures/isolated-env';
import { getCsrfToken, login } from './fixtures/api-auth';
import { readJsonAs } from './fixtures/typed-json';
import type {
  ApiId,
  AuthMeResponse,
  PersonDocument,
  TeamReviewsResponse,
  WeekSprintResponse,
  WeeklyPlanDocument,
  WeeklyRetroDocument,
} from './fixtures/e2e-api-types';

type ReviewArtifacts = {
  sprintId: string;
  planId: string;
  retroId: string;
};

async function createReviewArtifacts(
  page: import('@playwright/test').Page,
  apiUrl: string
): Promise<ReviewArtifacts> {
  const csrf = await getCsrfToken(page, apiUrl);

  const meRes = await page.request.get(`${apiUrl}/api/auth/me`);
  expect(meRes.ok()).toBe(true);
  const me = await readJsonAs<AuthMeResponse>(meRes);
  const userId = me.data?.user?.id;
  expect(userId, 'Authenticated user should have an id').toBeTruthy();
  if (!userId) {
    throw new Error('Authenticated user should have an id');
  }

  const personRes = await page.request.get(`${apiUrl}/api/weeks/lookup-person?user_id=${userId}`);
  expect(personRes.ok()).toBe(true);
  const person = await readJsonAs<PersonDocument>(personRes);
  const personId = person.id;

  const reviewsRes = await page.request.get(`${apiUrl}/api/team/reviews?sprint_count=1`);
  expect(reviewsRes.ok()).toBe(true);
  const reviewsData = await readJsonAs<TeamReviewsResponse>(reviewsRes);
  const currentWeekNumber = reviewsData.currentSprintNumber ?? 1;

  const programRes = await page.request.post(`${apiUrl}/api/programs`, {
    headers: { 'x-csrf-token': csrf },
    data: {
      title: 'Visual Review Program',
      properties: { color: '#0ea5e9' },
    },
  });
  expect(programRes.ok()).toBe(true);
  const program = await readJsonAs<ApiId>(programRes);

  const projectRes = await page.request.post(`${apiUrl}/api/projects`, {
    headers: { 'x-csrf-token': csrf },
    data: {
      title: 'Visual Review Project',
      belongs_to: [{ id: program.id, type: 'program' }],
      properties: { color: '#22c55e' },
    },
  });
  expect(projectRes.ok()).toBe(true);
  const project = await readJsonAs<ApiId>(projectRes);

  const sprintRes = await page.request.post(`${apiUrl}/api/documents`, {
    headers: { 'x-csrf-token': csrf },
    data: {
      document_type: 'sprint',
      title: `Week ${currentWeekNumber}`,
      belongs_to: [{ id: program.id, type: 'program' }, { id: project.id, type: 'project' }],
      properties: {
        sprint_number: currentWeekNumber,
        owner_id: personId,
        assignee_ids: [personId],
        status: 'active',
      },
    },
  });
  expect(sprintRes.ok()).toBe(true);
  const sprint = await readJsonAs<ApiId>(sprintRes);
  const sprintId = sprint.id;

  const planRes = await page.request.post(`${apiUrl}/api/weekly-plans`, {
    headers: { 'x-csrf-token': csrf },
    data: { person_id: personId, project_id: project.id, week_number: currentWeekNumber },
  });
  expect(planRes.ok()).toBe(true);
  const plan = await readJsonAs<WeeklyPlanDocument>(planRes);

  const retroRes = await page.request.post(`${apiUrl}/api/weekly-retros`, {
    headers: { 'x-csrf-token': csrf },
    data: { person_id: personId, project_id: project.id, week_number: currentWeekNumber },
  });
  expect(retroRes.ok()).toBe(true);
  const retro = await readJsonAs<WeeklyRetroDocument>(retroRes);

  const planContent = {
    type: 'doc',
    content: [
      {
        type: 'heading',
        attrs: { level: 1 },
        content: [{ type: 'text', text: 'Visual verification weekly plan' }],
      },
      {
        type: 'bulletList',
        content: [
          {
            type: 'listItem',
            content: [
              { type: 'paragraph', content: [{ type: 'text', text: 'Prepare API instrumentation rollout' }] },
            ],
          },
          {
            type: 'listItem',
            content: [
              { type: 'paragraph', content: [{ type: 'text', text: 'Deliver onboarding support for new teammate' }] },
            ],
          },
        ],
      },
    ],
  };
  const retroContent = {
    type: 'doc',
    content: [
      {
        type: 'heading',
        attrs: { level: 1 },
        content: [{ type: 'text', text: 'Visual verification retrospective' }],
      },
      {
        type: 'paragraph',
        content: [{ type: 'text', text: 'Completed setup tasks and validated sprint handoff quality.' }],
      },
    ],
  };

  const patchPlanRes = await page.request.patch(`${apiUrl}/api/documents/${plan.id}`, {
    headers: { 'x-csrf-token': csrf },
    data: { content: planContent },
  });
  expect(patchPlanRes.ok()).toBe(true);

  const patchRetroRes = await page.request.patch(`${apiUrl}/api/documents/${retro.id}`, {
    headers: { 'x-csrf-token': csrf },
    data: { content: retroContent },
  });
  expect(patchRetroRes.ok()).toBe(true);

  return { sprintId, planId: plan.id, retroId: retro.id };
}

test.describe('Manager Reviews Visual Verification', () => {
  test('plan review supports request changes and approve-with-note flows', async ({ page, apiServer }, testInfo) => {
    await login(page);
    const { sprintId, planId } = await createReviewArtifacts(page, apiServer.url);

    await page.goto(`/documents/${planId}?review=true&sprintId=${sprintId}`);
    await page.waitForLoadState('networkidle');

    await expect(page.getByText('Plan Approval')).toBeVisible({ timeout: 10000 });
    const submitReviewButton = page.getByRole('button', { name: 'Submit Review' });
    await expect(submitReviewButton).toBeVisible();

    await submitReviewButton.click();
    const requestDialog = page.getByRole('dialog');
    await expect(requestDialog).toBeVisible();
    await requestDialog.getByLabel('Request Changes').check();
    await requestDialog.getByPlaceholder('Explain what needs to be revised...').fill(
      'Please add measurable outcomes for each planned deliverable.'
    );
    const requestChangesSubmit = requestDialog.getByRole('button', { name: 'Request Changes' });
    await expect(requestChangesSubmit).toHaveCSS('background-color', 'rgb(234, 88, 12)');

    await page.screenshot({
      path: testInfo.outputPath('plan-review-request-changes-form.png'),
      fullPage: true,
    });

    await requestDialog.getByRole('button', { name: 'Request Changes' }).click();
    await expect(requestDialog).not.toBeVisible();
    await expect(
      page.locator('span').filter({ hasText: /^Changes requested$/ }).first()
    ).toBeVisible();
    await expect(page.getByText('Please add measurable outcomes for each planned deliverable.')).toBeVisible();

    await submitReviewButton.click();
    const approveDialog = page.getByRole('dialog');
    await expect(approveDialog).toBeVisible();
    await approveDialog.getByPlaceholder('Add context for this decision...').fill(
      'He onboarded last week and received equipment late; this pace is expected.'
    );
    await approveDialog.getByRole('button', { name: 'Approve Plan' }).click();
    await expect(approveDialog).not.toBeVisible();

    await expect(page.getByText('Approved')).toBeVisible();
    await expect(
      page.getByText('He onboarded last week and received equipment late; this pace is expected.').first()
    ).toBeVisible();

    await page.screenshot({
      path: testInfo.outputPath('plan-review-approved-with-note.png'),
      fullPage: true,
    });
  });

  test('retro review requires a rating before approve and persists note', async ({ page, apiServer }, testInfo) => {
    await login(page);
    const { sprintId, retroId } = await createReviewArtifacts(page, apiServer.url);

    await page.goto(`/documents/${retroId}?review=true&sprintId=${sprintId}`);
    await page.waitForLoadState('networkidle');

    await expect(page.getByText('Performance Rating')).toBeVisible({ timeout: 10000 });
    const submitReviewButton = page.getByRole('button', { name: 'Submit Review' });
    await expect(submitReviewButton).toBeVisible();
    await submitReviewButton.click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    const rateButton = dialog.getByRole('button', { name: /Rate & Approve|Update Approval|Re-approve & Rate/ });
    await expect(rateButton).toBeDisabled();

    await dialog.getByPlaceholder('Add context for this decision...').fill(
      'Strong retrospective quality for a first full week after onboarding.'
    );
    await dialog.locator('button[title=\"Fully Successful\"]').click();
    await expect(rateButton).toBeEnabled();

    await page.screenshot({
      path: testInfo.outputPath('retro-review-before-approve.png'),
      fullPage: true,
    });

    await rateButton.click();
    await expect(dialog).not.toBeVisible();
    await expect(page.getByText('Approval Note', { exact: true }).first()).toBeVisible();
    await expect(
      page.getByText('Strong retrospective quality for a first full week after onboarding.').first()
    ).toBeVisible();

    const sprintResponse = await page.request.get(`${apiServer.url}/api/weeks/${sprintId}`);
    expect(sprintResponse.ok()).toBe(true);
    const sprintData = await readJsonAs<WeekSprintResponse>(sprintResponse);
    expect(sprintData.review_approval?.state).toBe('approved');
    expect(sprintData.review_approval?.comment).toBe(
      'Strong retrospective quality for a first full week after onboarding.'
    );
    expect(sprintData.review_rating?.value).toBe(3);

    await page.screenshot({
      path: testInfo.outputPath('retro-review-approved-with-rating.png'),
      fullPage: true,
    });
  });
});
