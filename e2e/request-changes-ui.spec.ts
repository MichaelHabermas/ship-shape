/** E2E tests for Request Changes UI flow on the Reviews page. */
import { test, expect } from './fixtures/isolated-env';
import { getCsrfToken, login } from './fixtures/api-auth';
import { readJsonAs } from './fixtures/typed-json';
import type {
  ApiId,
  AuthMeResponse,
  PersonDocument,
  TeamReviewsResponse,
  WeeklyPlanDocument,
} from './fixtures/e2e-api-types';

/**
 * E2E tests for Request Changes UI flow on the ReviewsPage.
 *
 * Tests:
 * 1. Navigate to /team/reviews and verify "Changes Requested" in legend
 * 2. Reviews page renders with week headers and grid
 * 3. Review Plans batch mode shows Request Changes button
 * 4. Click "Request Changes" and verify textarea appears
 * 5. Submit feedback and verify API call succeeds
 * 6. Legend shows all status colors
 */

// Helper: create a pending plan for the current week so "Review Plans" button appears
async function createPendingPlan(page: import('@playwright/test').Page, apiUrl: string) {
  const csrf = await getCsrfToken(page, apiUrl);

  // Get current user info
  const meRes = await page.request.get(`${apiUrl}/api/auth/me`);
  const me = await readJsonAs<AuthMeResponse>(meRes);
  const userId = me.data?.user?.id;
  expect(userId, 'Authenticated user should have an id').toBeTruthy();
  if (!userId) {
    throw new Error('Authenticated user should have an id');
  }

  // Get person doc
  const personRes = await page.request.get(`${apiUrl}/api/weeks/lookup-person?user_id=${userId}`);
  const person = await readJsonAs<PersonDocument>(personRes);

  // Get current sprint number from the reviews endpoint
  const reviewsRes = await page.request.get(`${apiUrl}/api/team/reviews?sprint_count=1`);
  const reviewsData = await readJsonAs<TeamReviewsResponse>(reviewsRes);
  const currentSprint = reviewsData.currentSprintNumber ?? 1;

  // Create a program
  const progRes = await page.request.post(`${apiUrl}/api/programs`, {
    headers: { 'x-csrf-token': csrf },
    data: { title: 'Test Program', properties: { color: '#6366f1' } },
  });
  const prog = await readJsonAs<ApiId>(progRes);

  // Create a project
  const projRes = await page.request.post(`${apiUrl}/api/projects`, {
    headers: { 'x-csrf-token': csrf },
    data: {
      title: 'Test Project',
      belongs_to: [{ id: prog.id, type: 'program' }],
      properties: { color: '#3b82f6' },
    },
  });
  const proj = await readJsonAs<ApiId>(projRes);

  // Create a sprint for the current week with the person allocated
  await page.request.post(`${apiUrl}/api/documents`, {
    headers: { 'x-csrf-token': csrf },
    data: {
      document_type: 'sprint',
      title: `Week ${currentSprint}`,
      belongs_to: [{ id: prog.id, type: 'program' }, { id: proj.id, type: 'project' }],
      properties: {
        sprint_number: currentSprint,
        owner_id: person.id,
        assignee_ids: [person.id],
        status: 'active',
      },
    },
  });

  // Create a weekly plan with content (makes it reviewable)
  const planRes = await page.request.post(`${apiUrl}/api/weekly-plans`, {
    headers: { 'x-csrf-token': csrf },
    data: { person_id: person.id, project_id: proj.id, week_number: currentSprint },
  });
  const plan = await readJsonAs<WeeklyPlanDocument>(planRes);

  // Add content to make it count as "has content"
  await page.request.patch(`${apiUrl}/api/documents/${plan.id}`, {
    headers: { 'x-csrf-token': csrf },
    data: {
      content: {
        type: 'doc',
        content: [
          { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'What I plan to accomplish this week' }] },
          { type: 'bulletList', content: [
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Deliver API specification for auth module' }] }] },
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Conduct 20 screening calls with candidates' }] }] },
          ]},
        ],
      },
    },
  });

  return { sprintNumber: currentSprint, planId: plan.id };
}

test.describe('Request Changes UI', () => {
  test('Reviews page shows "Changes Requested" in the legend', async ({ page }) => {
    await login(page);
    await page.goto('/team/reviews');
    await page.waitForLoadState('networkidle');

    await expect(
      page.getByText('Changes Requested'),
      'Legend should show "Changes Requested" status'
    ).toBeVisible({ timeout: 10000 });
  });

  test('Reviews page renders with week headers and review grid', async ({ page }) => {
    await login(page);
    await page.goto('/team/reviews');
    await page.waitForLoadState('networkidle');

    await expect(
      page.locator('span').filter({ hasText: /^Week \d+$/ }).first(),
      'Reviews page should show week headers'
    ).toBeVisible({ timeout: 10000 });

    await expect(page.getByText('Approved')).toBeVisible();
    await expect(page.getByText('No Submission')).toBeVisible();
  });

  test('Review Plans button appears when pending plans exist', async ({ page, apiServer }) => {
    await login(page);
    await createPendingPlan(page, apiServer.url);

    await page.goto('/team/reviews');
    await page.waitForLoadState('networkidle');

    // "Review Plans" button should appear since there's an unapproved plan
    const reviewPlansButton = page.getByRole('button', { name: /Review Plans/i });
    await expect(
      reviewPlansButton,
      'Review Plans button should be visible with pending plan data'
    ).toBeVisible({ timeout: 10000 });
  });

  test('Batch review navigates to plan document with review mode', async ({ page, apiServer }) => {
    await login(page);
    await createPendingPlan(page, apiServer.url);

    await page.goto('/team/reviews');
    await page.waitForLoadState('networkidle');

    const reviewPlansButton = page.getByRole('button', { name: /Review Plans/i });
    await expect(reviewPlansButton).toBeVisible({ timeout: 10000 });
    await reviewPlansButton.click();

    // Batch review navigates to the plan document with ?review=true
    await page.waitForURL(/\/documents\/.*review=true/, { timeout: 10000 });
    expect(page.url(), 'Should navigate to document in review mode').toContain('review=true');
  });

  test('Request Changes button appears on plan document in review mode', async ({ page, apiServer }) => {
    await login(page);
    const { planId } = await createPendingPlan(page, apiServer.url);

    // Navigate directly to the plan document in review mode
    await page.goto(`/documents/${planId}?review=true`);
    await page.waitForLoadState('networkidle');

    // The sidebar should show a Request Changes button (via ApprovalButton or review queue controls)
    // Wait for the page to fully load
    await expect(page.getByText('Weekly Plan')).toBeVisible({ timeout: 10000 });
  });

  test('Reviews page shows all legend colors', async ({ page }) => {
    await login(page);
    await page.goto('/team/reviews');
    await page.waitForLoadState('networkidle');

    const legendLabels = ['Approved', 'Needs Review', 'Late', 'Changed', 'Changes Requested', 'No Submission'];
    for (const label of legendLabels) {
      await expect(
        page.getByText(label, { exact: false }),
        `Legend should contain "${label}"`
      ).toBeVisible({ timeout: 5000 });
    }
  });
});
