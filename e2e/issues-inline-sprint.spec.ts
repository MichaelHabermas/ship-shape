import { test, expect, type Page } from './fixtures/isolated-env';
import { login } from './fixtures/api-auth';

import type { Pool } from 'pg';

test.describe('Issues inline sprint assignment', () => {
  // Risk mitigated: inline sprint assignment previously sent a single-issue PATCH with `sprint_id`,
  // a field the PATCH schema ignores, silently discarding the user's sprint change.
  // This test proves the UI routes through POST /api/issues/bulk, which is the only server path
  // that accepts and persists `sprint_id` on an issue.
  test('uses bulk update API when changing week inline on planning tab', async ({ page, dbPool }) => {
    const { planningSprintId, targetSprintId, targetSprintName, issueTitle } =
      await seedPlanningInlineAssignment(dbPool);

    await login(page);
    await page.goto(`/documents/${planningSprintId}/plan`);
    await expect(page.locator('th').filter({ hasText: 'Week' })).toBeVisible({ timeout: 15000 });

    const issueRow = page.locator('tbody tr').filter({ hasText: issueTitle }).first();
    await expect(issueRow).toBeVisible({ timeout: 10000 });

    const bulkResponsePromise = page.waitForResponse(
      (response) =>
        response.url().includes('/api/issues/bulk')
        && response.request().method() === 'POST',
      { timeout: 15000 },
    );

    const weekSelector = issueRow.getByRole('button').filter({ hasText: /Week|—/ }).first();
    await expect(async () => {
      await weekSelector.click();
      await page.getByRole('option', { name: targetSprintName }).click();
    }).toPass({ timeout: 15000 });

    const bulkResponse = await bulkResponsePromise;
    expect(bulkResponse.url()).toContain('/api/issues/bulk');
    expect(bulkResponse.ok()).toBeTruthy();

    const bulkBody = await bulkResponse.json() as { updated?: unknown[] };
    expect(bulkBody.updated?.length).toBeGreaterThan(0);

    await expect(page.getByText(/Issue moved to/i)).toBeVisible({ timeout: 5000 });

    // WeekPlanningTab locks the view to the current sprint — moved issues leave this list.
    await expect(issueRow).not.toBeVisible({ timeout: 10000 });

    await page.goto(`/documents/${targetSprintId}/plan`);
    await expect(page.locator('tbody tr').filter({ hasText: issueTitle })).toBeVisible({
      timeout: 10000,
    });
  });
});

async function seedPlanningInlineAssignment(dbPool: Pool): Promise<{
  planningSprintId: string;
  targetSprintId: string;
  targetSprintName: string;
  issueTitle: string;
}> {
  const programResult = await dbPool.query<{ id: string }>(
    `SELECT id FROM documents WHERE document_type = 'program' AND title = 'API Platform' LIMIT 1`,
  );
  const programId = programResult.rows[0]?.id;
  if (!programId) {
    throw new Error('Expected API Platform program in isolated seed');
  }

  const sprintResult = await dbPool.query<{ id: string; title: string }>(
    `SELECT d.id, d.title
     FROM documents d
     JOIN document_associations da ON da.document_id = d.id
       AND da.related_id = $1
       AND da.relationship_type = 'program'
     WHERE d.document_type = 'sprint'
     ORDER BY (d.properties->>'sprint_number')::int ASC
     LIMIT 2`,
    [programId],
  );

  if (sprintResult.rows.length < 2) {
    throw new Error('Expected at least two sprints for API Platform in isolated seed');
  }

  const [sourceSprint, targetSprint] = sprintResult.rows;

  await dbPool.query(
    `UPDATE documents
     SET properties = COALESCE(properties, '{}'::jsonb) || $2::jsonb
     WHERE id = ANY($1::uuid[])`,
    [[sourceSprint.id, targetSprint.id], JSON.stringify({ status: 'planning' })],
  );

  const issueTitle = 'Inline sprint assignment E2E issue';
  const issueResult = await dbPool.query<{ id: string }>(
    `INSERT INTO documents (workspace_id, document_type, title, properties, ticket_number, created_by)
     SELECT d.workspace_id, 'issue', $2, $3, COALESCE(MAX(ticket_number), 0) + 1, d.created_by
     FROM documents d
     WHERE d.id = $1
     GROUP BY d.workspace_id, d.created_by
     RETURNING id`,
    [
      sourceSprint.id,
      issueTitle,
      JSON.stringify({
        state: 'backlog',
        priority: 'medium',
        source: 'internal',
        estimate: 4,
      }),
    ],
  );
  const issueId = issueResult.rows[0]?.id;
  if (!issueId) {
    throw new Error('Failed to seed issue for inline sprint assignment test');
  }

  await dbPool.query(
    `INSERT INTO document_associations (document_id, related_id, relationship_type)
     VALUES ($1, $2, 'program'), ($1, $3, 'sprint')`,
    [issueId, programId, sourceSprint.id],
  );

  return {
    planningSprintId: sourceSprint.id,
    targetSprintId: targetSprint.id,
    targetSprintName: targetSprint.title,
    issueTitle,
  };
}
