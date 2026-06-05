// PlugForge browser acceptance proves the SDK demo completes PKCE and lists authenticated documents.
import fs from 'node:fs/promises';
import path from 'node:path';
import type { Pool } from 'pg';
import { test, expect, type Page } from './fixtures/isolated-env';
import { loginAsAdmin } from './fixtures/api-auth';
import { readJsonAs } from './fixtures/typed-json';

type CreatedOAuthApp = {
  id: string;
  client_id: string;
  redirect_uris: string[];
  requested_scopes: string[];
};

type ApiResponse<T> = {
  success: boolean;
  data?: T;
};

type UserWorkspaceRow = {
  id: string;
  last_workspace_id: string;
};

const evidencePath = path.resolve(
  process.cwd(),
  'my-docs/evidence/plugforge-integrations/browser.json'
);
const runId = process.env.PLUGFORGE_INTEGRATION_RUN_ID ?? `browser-${Date.now()}`;
const demoScopes = ['documents:read', 'documents:write', 'issues:read', 'sprints:read'];

test('Browser SDK demo completes Authorization Code + PKCE and lists authenticated documents', async ({
  page,
  apiServer,
  webServer,
  dbPool,
}) => {
  const { csrfToken } = await loginAsAdmin(page, apiServer.url);
  const user = await findAdminUser(dbPool);
  const documentTitle = `PlugForge Browser SDK ${Date.now()}`;
  await seedDocument(dbPool, {
    title: documentTitle,
    workspaceId: user.last_workspace_id,
    userId: user.id,
  });
  const oauthApp = await createOAuthApp(page, {
    apiUrl: apiServer.url,
    csrfToken,
    redirectUri: `${webServer.url}/sdk-demo`,
  });

  await page.goto('/sdk-demo');
  await page.locator('#sdk-client-id').fill(oauthApp.client_id);
  await page.getByRole('button', { name: 'Connect' }).click();

  await expect(page).toHaveURL(/\/oauth\/consent\?request_id=/);
  await expect(page.getByRole('heading', { name: 'Authorize app access' })).toBeVisible();
  for (const scope of demoScopes) {
    await expect(page.getByText(scope, { exact: true })).toBeVisible();
  }
  await page.getByRole('button', { name: 'Authorize' }).click();

  await expect(page).toHaveURL(/\/sdk-demo/);
  await expect(page.getByText(documentTitle)).toBeVisible({ timeout: 15000 });
  await expect(page.getByText('Loaded.', { exact: true })).toBeVisible();
  await writeBrowserEvidence({
    status: 'passed',
    client_id: oauthApp.client_id,
    document_title: documentTitle,
    redirect_uri: `${webServer.url}/sdk-demo`,
    scopes: demoScopes,
  });
});

async function findAdminUser(dbPool: Pool): Promise<UserWorkspaceRow> {
  const result = await dbPool.query<UserWorkspaceRow>(
    `SELECT id, last_workspace_id
       FROM users
      WHERE email = 'dev@ship.local'
      LIMIT 1`
  );
  const row = result.rows[0];
  if (!row) throw new Error('Expected E2E admin user');
  return row;
}

async function seedDocument(
  dbPool: Pool,
  input: { title: string; workspaceId: string; userId: string }
): Promise<void> {
  await dbPool.query(
    `INSERT INTO documents (
       workspace_id,
       document_type,
       title,
       properties,
       created_by,
       visibility
     )
     VALUES ($1, 'wiki', $2, $3, $4, 'workspace')`,
    [input.workspaceId, input.title, {}, input.userId]
  );
}

async function createOAuthApp(
  page: Page,
  input: { apiUrl: string; csrfToken: string; redirectUri: string }
): Promise<CreatedOAuthApp> {
  const response = await page.request.post(`${input.apiUrl}/api/platform/apps`, {
    headers: { 'x-csrf-token': input.csrfToken },
    data: {
      name: `PlugForge Browser SDK ${Date.now()}`,
      redirect_uris: [input.redirectUri],
      requested_scopes: demoScopes,
    },
  });
  expect(response.ok()).toBeTruthy();
  const body = await readJsonAs<ApiResponse<CreatedOAuthApp>>(response);
  if (!body.success || !body.data) throw new Error('OAuth app creation failed');
  expect(body.data.client_id).toMatch(/^ship_app_/);
  expect(body.data.redirect_uris).toEqual([input.redirectUri]);
  expect(body.data.requested_scopes).toEqual(demoScopes);
  return body.data;
}

async function writeBrowserEvidence(payload: {
  status: 'passed';
  client_id: string;
  document_title: string;
  redirect_uri: string;
  scopes: string[];
}): Promise<void> {
  await fs.mkdir(path.dirname(evidencePath), { recursive: true });
  await fs.writeFile(evidencePath, `${JSON.stringify({
    flow: 'browser',
    proof_class: 'contract',
    run_id: runId,
    generated_at: new Date().toISOString(),
    ...payload,
  }, null, 2)}\n`);
}
