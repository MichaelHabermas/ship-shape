#!/usr/bin/env node
import AxeBuilder from '@axe-core/playwright';
import { chromium } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = resolve(repoRoot, 'test-results/a11y-closeout');
const axeTags = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

function hasFlag(name) {
  return process.argv.includes(name);
}

function normalizeBaseUrl(url) {
  return url.replace(/\/$/, '');
}

async function readDevBaseUrl() {
  if (process.env.WEB_BASE_URL) {
    return normalizeBaseUrl(process.env.WEB_BASE_URL);
  }

  try {
    const ports = await readFile(resolve(repoRoot, '.ports'), 'utf8');
    const webPort = ports.match(/(?:WEB_PORT|WEB)=(\d+)/)?.[1];
    if (webPort) {
      return `http://localhost:${webPort}`;
    }
  } catch {
    // No local dev port file; fall back to the default Vite port.
  }

  return 'http://localhost:5173';
}

async function login(page, baseUrl) {
  await page.goto(`${baseUrl}/login`, { waitUntil: 'networkidle' });

  const setupButton = page.getByRole('button', { name: /create admin account/i });
  const signInButton = page.getByRole('button', { name: 'Sign in', exact: true });
  await setupButton.or(signInButton).waitFor({ state: 'visible', timeout: 10_000 });

  if (await setupButton.isVisible()) {
    await page.locator('#name').fill(process.env.A11Y_NAME || 'Dev User');
    await page.locator('#email').fill(process.env.A11Y_EMAIL || 'dev@ship.local');
    await page.locator('#password').fill(process.env.A11Y_PASSWORD || 'admin123');
    await page.locator('#confirmPassword').fill(process.env.A11Y_PASSWORD || 'admin123');
    await setupButton.click();
    await page.waitForURL((url) => !url.pathname.startsWith('/setup'), { timeout: 10_000 });
    return;
  }

  await page.locator('#email').fill(process.env.A11Y_EMAIL || 'dev@ship.local');
  await page.locator('#password').fill(process.env.A11Y_PASSWORD || 'admin123');
  await signInButton.click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 10_000 });
}

async function firstDocumentPath(page, baseUrl) {
  await page.goto(`${baseUrl}/docs`, { waitUntil: 'networkidle' });
  const links = page.locator('a[href*="/documents/"]');
  await links.first().waitFor({ state: 'visible', timeout: 10_000 });
  const href = await links.first().getAttribute('href');
  return href ? new URL(href, baseUrl).pathname : null;
}

function summarizeViolation(violation) {
  return {
    id: violation.id,
    impact: violation.impact,
    description: violation.description,
    help: violation.help,
    helpUrl: violation.helpUrl,
    nodes: violation.nodes.map((node) => ({
      target: node.target,
      failureSummary: node.failureSummary,
    })),
  };
}

async function scanPage(page, baseUrl, target) {
  const url = `${baseUrl}${target.path}`;
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.screenshot({ path: resolve(outDir, `${target.name}.png`), fullPage: true });

  const results = await new AxeBuilder({ page }).withTags(axeTags).analyze();
  const criticalOrSerious = results.violations.filter((violation) =>
    violation.impact === 'critical' || violation.impact === 'serious'
  );

  return {
    name: target.name,
    path: target.path,
    url,
    violationCount: results.violations.length,
    criticalOrSeriousCount: criticalOrSerious.length,
    criticalOrSeriousNodeCount: criticalOrSerious.reduce(
      (count, violation) => count + violation.nodes.length,
      0
    ),
    violations: results.violations.map(summarizeViolation),
    screenshot: `test-results/a11y-closeout/${target.name}.png`,
  };
}

function printSummary(summary) {
  for (const page of summary.pages) {
    const nodeText =
      page.criticalOrSeriousNodeCount === 1 ? '1 node' : `${page.criticalOrSeriousNodeCount} nodes`;
    console.log(
      `${page.name}: ${page.violationCount} violations, ${page.criticalOrSeriousCount} critical/serious (${nodeText})`
    );
  }
  console.log(`Wrote ${summary.output}`);
}

async function main() {
  const baseUrl = await readDevBaseUrl();
  await mkdir(outDir, { recursive: true });

  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();

  try {
    await login(page, baseUrl);
    const documentPath = await firstDocumentPath(page, baseUrl);
    const targets = [
      { name: 'docs', path: '/docs' },
      { name: 'projects', path: '/projects' },
      ...(documentPath ? [{ name: 'document', path: documentPath }] : []),
      { name: 'my-week', path: '/my-week' },
    ];

    const pages = [];
    for (const target of targets) {
      pages.push(await scanPage(page, baseUrl, target));
    }

    const summary = {
      generatedAt: new Date().toISOString(),
      baseUrl,
      failOnSerious: hasFlag('--fail-on-serious'),
      output: 'test-results/a11y-closeout/axe-summary.json',
      pages,
    };
    await writeFile(resolve(outDir, 'axe-summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
    printSummary(summary);

    if (summary.failOnSerious && pages.some((result) => result.criticalOrSeriousCount > 0)) {
      process.exitCode = 1;
    }
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
