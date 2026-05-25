#!/usr/bin/env node
/**
 * One-off helper: replace inline E2E login helpers with fixtures/api-auth imports.
 * Skips auth.spec.ts (tests login UI) and files already using fixtures/app login.
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const e2eDir = join(process.cwd(), 'e2e');
const skip = new Set(['auth.spec.ts', 'issues.spec.ts', 'docs-mode.spec.ts']);

const loginFn = /\/\/ Helper[^\n]*\n(?:\/\/[^\n]*\n)?async function login\([^)]*\)[^{]*\{[^}]*\{[^}]*\}[^}]*\}/gs;
const loginFnShort = /async function login\(page[^)]*\)[^{]*\{[\s\S]*?await expect\(page\)\.not\.toHaveURL\('\/login'[^}]*\}\n?/g;
const loginAsSuperAdmin = /async function loginAsSuperAdmin\(page[^)]*\)[^{]*\{[\s\S]*?not\.toHaveURL\('\/login'[^}]*\}\n?/g;
const getCsrfLocal = /async function getCsrfToken\(page[^)]*\)[^{]*\{[\s\S]*?return csrf\.token\n\}\n?/g;
const loginAsAdminBlock = /async function loginAsAdmin\(page[^)]*\)[^{]*\{[\s\S]*?return \{ csrfToken \};\n\}\n?/g;
const getCsrfTokenApi = /async function getCsrfToken\(page[^)]*apiUrl[^)]*\)[^{]*\{[\s\S]*?return token;\n\}\n?/g;

for (const file of readdirSync(e2eDir).filter((f) => f.endsWith('.spec.ts'))) {
  if (skip.has(file)) continue;
  const path = join(e2eDir, file);
  let text = readFileSync(path, 'utf8');
  if (!text.includes('async function login') && !text.includes('async function loginAsSuperAdmin') && !text.includes('async function getCsrfToken')) {
    continue;
  }
  if (text.includes("from './fixtures/api-auth'")) continue;

  text = text.replace(loginAsAdminBlock, '');
  text = text.replace(getCsrfTokenApi, '');
  text = text.replace(loginAsSuperAdmin, '');
  text = text.replace(getCsrfLocal, '');
  text = text.replace(loginFnShort, '');
  text = text.replace(loginFn, '');

  const imports = new Set();
  if (/\bloginAsSuperAdmin\(/.test(text)) imports.add('loginAsSuperAdmin');
  if (/\bloginAsAdmin\(/.test(text) || /\bloginViaApi\(/.test(text)) imports.add('loginAsAdmin');
  if (/\bgetCsrfToken\(/.test(text)) imports.add('getCsrfToken');
  if (/\blogin\(/.test(text) && !text.includes('loginAs')) imports.add('login');
  if (/\blogin\(page,\s*['"]/.test(text)) imports.add('login');

  if (imports.size === 0) continue;

  const importLine = `import { ${[...imports].join(', ')} } from './fixtures/api-auth';\n`;
  const firstImport = text.match(/^import .+$/m);
  if (firstImport) {
    const idx = text.indexOf(firstImport[0]) + firstImport[0].length;
    text = `${text.slice(0, idx)}\n${importLine}${text.slice(idx)}`;
  } else {
    text = importLine + text;
  }

  writeFileSync(path, text);
  console.log('updated', file);
}
