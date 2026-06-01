/**
 * Shared E2E authentication helpers for UI and API request flows.
 */
import { expect, type Page } from '@playwright/test';

import { readJsonAs } from './typed-json';
import type { AuthMeResponse } from './e2e-api-types';

export const E2E_LOGIN_EMAIL = 'dev@ship.local';
export const E2E_LOGIN_PASSWORD = 'admin123';
export const E2E_MEMBER_EMAIL = 'bob.martinez@ship.local';

/** UI login via /login form. */
export async function login(
  page: Page,
  email: string = E2E_LOGIN_EMAIL,
  password: string = E2E_LOGIN_PASSWORD
): Promise<void> {
  await page.context().clearCookies();
  await page.goto('/login');
  await page.locator('#email').waitFor({ state: 'visible', timeout: 15000 });
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(password);
  const loginResponsePromise = page.waitForResponse(
    (response) => response.url().includes('/api/auth/login'),
    { timeout: 15000 }
  ).catch(() => null);

  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  const loginResponse = await loginResponsePromise;
  const navigated = await page.waitForURL(
    (url) => url.pathname !== '/login',
    { timeout: 15000 }
  ).then(() => true).catch(() => false);

  if (!navigated) {
    const loginStatus = loginResponse ? String(loginResponse.status()) : 'no /api/auth/login response';
    const loginBody = loginResponse ? await loginResponse.text().catch(() => '<unreadable response>') : '';
    const alertText = await page.locator('[role="alert"]').allTextContents().catch(() => []);
    throw new Error(
      [
        `Login did not leave /login for ${email}.`,
        `URL: ${page.url()}`,
        `Login response: ${loginStatus}`,
        `Login body: ${loginBody.slice(0, 500)}`,
        `Alerts: ${alertText.join(' | ') || '<none>'}`,
      ].join('\n')
    );
  }
}

export async function loginAsSuperAdmin(page: Page): Promise<void> {
  await login(page, E2E_LOGIN_EMAIL, E2E_LOGIN_PASSWORD);
}

export async function loginAsMember(page: Page): Promise<void> {
  await login(page, E2E_MEMBER_EMAIL, E2E_LOGIN_PASSWORD);
}

export async function getCsrfToken(page: Page, apiUrl?: string): Promise<string> {
  const base = apiUrl ?? '';
  const response = await page.request.get(`${base}/api/csrf-token`);
  expect(response.ok()).toBeTruthy();
  const { token } = await readJsonAs<{ token: string }>(response);
  return token;
}

/** UI login then CSRF token for API requests against apiServer.url. */
export async function loginViaApi(
  page: Page,
  apiUrl: string
): Promise<{ csrfToken: string }> {
  await login(page, E2E_LOGIN_EMAIL, E2E_LOGIN_PASSWORD);
  const csrfToken = await getCsrfToken(page, apiUrl);
  return { csrfToken };
}

/** Admin UI login only. */
export async function loginAsAdmin(page: Page): Promise<void>;
/** Admin login + CSRF for API specs (alias of `loginViaApi`). */
export async function loginAsAdmin(page: Page, apiUrl: string): Promise<{ csrfToken: string }>;
export async function loginAsAdmin(
  page: Page,
  apiUrl?: string
): Promise<void | { csrfToken: string }> {
  await login(page, E2E_LOGIN_EMAIL, E2E_LOGIN_PASSWORD);
  if (apiUrl !== undefined) {
    return { csrfToken: await getCsrfToken(page, apiUrl) };
  }
}

/** Admin login + CSRF + user id for API specs that need `/api/auth/me`. */
export async function loginAsAdminWithUser(
  page: Page,
  apiUrl: string
): Promise<{ csrfToken: string; userId: string }> {
  const auth = await loginAsAdmin(page, apiUrl);
  if (!auth) {
    throw new Error('loginAsAdminWithUser: expected csrf token when apiUrl is set');
  }
  const meResponse = await page.request.get(`${apiUrl}/api/auth/me`);
  expect(meResponse.ok()).toBeTruthy();
  const meData = await readJsonAs<AuthMeResponse>(meResponse);
  return { csrfToken: auth.csrfToken, userId: meData.data.user.id };
}

/** UI login then `Cookie` header string for API specs that pass cookies manually. */
export async function loginAndGetSessionCookieHeader(page: Page): Promise<string> {
  await login(page);
  const cookies = await page.context().cookies();
  return cookies.map((c) => `${c.name}=${c.value}`).join('; ');
}

/** Member login + CSRF for API specs. */
export async function loginMemberViaApi(
  page: Page,
  apiUrl: string
): Promise<{ csrfToken: string }> {
  await login(page, E2E_MEMBER_EMAIL, E2E_LOGIN_PASSWORD);
  const csrfToken = await getCsrfToken(page, apiUrl);
  return { csrfToken };
}
