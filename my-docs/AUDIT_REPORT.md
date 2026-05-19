# Audit Report

---

## Context

---

## Category 1: Type Safety

**Methodology (**Describe how you measured it (tools, commands, methodology)**)**

- Explicit `any` usage was measured with the TypeScript compiler parser by counting `SyntaxKind.AnyKeyword` AST nodes.[^1]
- Type assertions were measured with the same parser approach by counting `SyntaxKind.AsExpression` AST nodes.[^1]
- Non-null assertions were measured with the same parser approach by counting `SyntaxKind.NonNullExpression` AST nodes.[^1]
- TypeScript suppression directives were counted with a targeted text scan for `@ts-ignore` and `@ts-expect-error` in the same scopes.[^2]
- Strict mode was checked in root and package TypeScript configs.
- Violation-dense files were ranked by combined production counts of `any`, `as`, non-null assertions, and TypeScript suppression directives.

**Baseline**

| Metric | Value |
|--------|-------|
| Total `any` types | 278 total, 94 in production |
| Total type assertions (`as`) | 713 total, 504 in production |
| Total non-null assertions (`!`) | 348 total, 325 in production |
| Total `@ts-ignore` / `@ts-expect-error`       | 1 total, 0 in production |
| Strict mode enabled?                          | Yes |
| Strict mode error count (if disabled)         | N/A |
| Top 5 violation-dense files (production only) | `api/src/routes/weeks.ts` (85), `api/src/routes/projects.ts` (51), `api/src/routes/issues.ts` (49), `web/src/pages/UnifiedDocumentPage.tsx` (37), `api/src/db/seed.ts` (35) |

**Findings** Identify the specific weaknesses or opportunities you found, and Rank the severity or impact of each finding.

1. **High:** API routes are the biggest type-safety risk. The densest files are `weeks.ts`, `projects.ts`, and `issues.ts`, where unsafe casts and non-null assertions touch request data, DB rows, and API responses.
2. **High:** Raw database row mapping is too trusted. PostgreSQL results are cast into app types without much runtime validation, so schema/content drift can become runtime bugs.
3. **Medium:** Editor/document conversions are loosely typed. Yjs, TipTap JSON, and document metadata cross boundaries where the compiler cannot fully verify shape.
4. **Medium:** Non-null assertions are common in production route code, making correctness depend on nearby human reasoning instead of explicit control flow.
5. **Low:** TypeScript suppression comments are not a current production concern; only one appears, and it's in a test.

**Remediation Plan**

Add a lightweight ESLint type-safety guardrail, then clean up the highest-risk files first.

1. Add ESLint with simple root scripts: `"lint": "eslint ."` and `"lint:fix": "eslint . --fix"`.[^6]
2. Configure type-safety rules as warnings at first: no explicit `any`, no non-null assertions, no unsafe assignments/member access/arguments/returns, and no unnecessary type assertions.
3. Keep the existing AST audit counter as the measurable baseline and regression check. ESLint helps developers find issues; the audit script proves the 25% reduction.
4. Start remediation in the densest production route files: `api/src/routes/weeks.ts`, `api/src/routes/projects.ts`, and `api/src/routes/issues.ts`.
5. Replace unsafe route-boundary patterns with real narrowing: Zod-parsed `req.query` / `req.body`, typed `pool.query<T>()` rows, explicit row mapper types, and guarded access to document `properties`.
6. Treat editor/Yjs/TipTap typing as a later pass. API and database boundaries carry more production risk and will remove more meaningful violations faster.

---

## Category 2: Production Frontend Bundle Size

**Methodology (**Describe how you measured it (tools, commands, methodology)**)**

- Total production bundle size was measured after `pnpm build:web` by summing raw JavaScript and CSS files in `web/dist`, excluding source maps. Full `web/dist` static output, including icons/images, was also measured for context.
- Largest chunk was identified by sorting generated `web/dist/assets` JavaScript and CSS files by byte size.
- Number of chunks was measured by counting generated JavaScript and CSS files in `web/dist/assets`, excluding source maps.
- Largest dependencies were measured from Vite/Rollup production build metadata by grouping rendered `node_modules` module lengths by package. The generated report is in `my-docs/audit-evidence/category-2-bundle/bundle-treemap.html`.
- Unused dependencies were checked by comparing `web/package.json` dependencies against static imports in `web/src`, then spot-checking candidates with `rg` and the generated bundle report.

**Baseline**

| Metric                         | Value         |
| ------------------------------ | ------------- |
| Total production bundle size   | 2,262.65 KB JS/CSS (3,351.53 KB full `web/dist`) |
| Largest chunk                  | `assets/index-C2vAyoQ1.js` (2,025.10 KB) |
| Number of chunks               | 262 JS/CSS chunks (261 JS, 1 CSS) |
| Top 3 largest dependencies     | `emoji-picker-react` (399.59 KB), `highlight.js` (377.92 KB), `yjs` (264.92 KB) |
| Unused dependencies identified | `@tanstack/query-sync-storage-persister` |

**Findings** Identify the specific weaknesses or opportunities you found, and Rank the severity or impact of each finding.

1. **High:** The main JavaScript chunk dominates the bundle. `assets/index-C2vAyoQ1.js` is 2,025.10 KB, about 89% of the raw JS/CSS bundle, and triggers Vite's >500 KB warning.
2. **High:** Code splitting exists but is not reducing the initial bundle enough. The build emits 262 JS/CSS chunks, but most are tiny while the main app chunk remains very large.
3. **Medium:** `emoji-picker-react` and `highlight.js` are large feature-specific dependencies. They appear expensive relative to how often emoji picking or code highlighting is likely needed on initial load. `yjs` is also large, but it supports core collaboration behavior.
4. **Low:** `@tanstack/query-sync-storage-persister` appears unused by static import and bundle-report checks. `@uswds/uswds` was a false positive because it is used through the icon glob/generation path.

**Remediation Plan**

Reduce the initial JavaScript bundle by making expensive features load only when needed.

1. Gate `ReactQueryDevtools` behind a dev-only dynamic import so it never ships in the production entry bundle.
2. Remove the unused `@tanstack/query-sync-storage-persister` dependency if the static import and bundle checks still confirm it is unused.
3. Lazy-load `emoji-picker-react`; the picker should download only when the emoji popover opens.
4. Convert eager page imports in `web/src/main.tsx` to route-level `React.lazy` imports, especially admin, org chart, reviews, settings, and document-heavy pages.
5. Split the editor path so non-editor pages do not pay for TipTap, Yjs, ProseMirror, lowlight, or collaboration code on initial load.
6. Reduce syntax-highlighting weight by registering only needed languages or loading highlighting after the editor/code block is actually used.
7. Measure success with the same production build and bundle report, targeting at least a 20% reduction in the initial `assets/index-*.js` chunk without removing user-facing functionality.

---

## Category 3: API Response Time

**Methodology (**Describe how you measured it (tools, commands, methodology)**)**

**Baseline**

| Endpoint | P50 | P95 | P99 |
| -------- | --- | --- | --- |
| 1.       | ms  | ms  | ms  |
| 2.       |     |     |     |
| 3.       |     |     |     |
| 4.       |     |     |     |
| 5.       |     |     |     |

**Findings** Identify the specific weaknesses or opportunities you found, and Rank the severity or impact of each finding.

1.

**Remediation Plan**

---

## Category 4: Database Query Efficiency

**Methodology (**Describe how you measured it (tools, commands, methodology)**)**

**Baseline**

| User flow         | Total queries | Slowest query (ms) | N+1 detected? |
| ----------------- | ------------- | ------------------ | ------------- |
| Load main page    |               |                    | Yes / No      |
| View a document   |               |                    |               |
| List issues       |               |                    |               |
| Load sprint board |               |                    |               |
| Search content    |               |                    |               |

**Findings** Identify the specific weaknesses or opportunities you found, and Rank the severity or impact of each finding.

1.

**Remediation Plan**

---

## Category 5: Test Coverage and Quality

**Methodology (**Describe how you measured it (tools, commands, methodology)**)**

- Test inventory was measured by scanning `api/src`, `web/src`, `shared/src`, and `e2e` for `*.test.ts(x)` and `*.spec.ts(x)` files, then counting declared `test(...)` / `it(...)` cases.[^3]
- Web unit tests were run with `pnpm --filter @ship/web exec vitest run`.
- API unit tests were run with `pnpm --filter @ship/api exec vitest run` against a throwaway database (`ship_test_audit`) to avoid truncating local application data. The throwaway DB was created, migrated (`pnpm --filter @ship/api db:migrate`), and seeded, then dropped after the run.[^4]
- E2E test count was measured with `npx playwright test --list` from the `e2e/` directory, which enumerates every test the runner would execute.[^5]
- Flaky test detection: both API and web suites were run 3× each; any test that changed pass/fail status across runs was flagged as flaky.
- API code coverage was measured by temporarily installing `@vitest/coverage-v8@4.0.17` (matching the project's `vitest@4.0.17`) and running `pnpm --filter @ship/api exec vitest run --coverage` against the throwaway DB. The dependency was removed after measurement.
- Web coverage was checked in `web/vitest.config.ts`; no coverage provider is configured.

**Baseline**

| Metric                            | Value           |
| --------------------------------- | --------------- |
| Total tests                       | 1,471 executable tests across 99 files (451 API in 28 files, 151 web in 16 files, 869 E2E in 71 files) |
| Pass / Fail / Flaky               | API unit: 451 / 0 / 0; Web unit: 138 / 13 / 0; E2E: not executed (inventory only) |
| Suite runtime                     | API unit: 10.76s; Web unit: 1.05s |
| Critical flows with zero coverage | None obvious by file inventory for document CRUD, auth, collaboration, issues, weeks, search, accessibility, or security |
| Code coverage % (if measured)     | API: 40.34% statements, 33.44% branches, 40.9% functions, 40.52% lines; Web: not configured |

**Findings** Identify the specific weaknesses or opportunities you found, and Rank the severity or impact of each finding.

1. **High:** Web unit tests are failing: 13 of 151 failed, in `document-tabs.test.ts` (9), `DetailsExtension.test.ts` (3), and `useSessionTimeout.test.ts` (1). These are assertion mismatches against changed implementation (e.g., tab configs, TipTap extension content schema), not environmental failures.
2. **High:** API code coverage is 40% across the board. Route files for `programs.ts` (5%), `dashboard.ts` (2%), `weekly-plans.ts` (5%), and `comments.ts` (9%) have near-zero coverage despite being production endpoints.
3. **Medium:** Web has no coverage measurement configured. `web/vitest.config.ts` has no `coverage` block; adding `@vitest/coverage-v8` with a `provider: 'v8'` config would enable it.
4. **Medium:** API test safety requires a throwaway database. `api/src/test/setup.ts` runs `TRUNCATE ... CASCADE` on `documents`, `users`, `workspaces`, `audit_logs`, and other tables. Running `pnpm test` from root will destroy local development data unless `DATABASE_URL` points to a disposable database.
5. **Low:** No flaky tests detected across 3 repeated runs of both API and web suites.

**Remediation Plan**

---

## Category 6: Runtime Error and Edge Case Handling

**Methodology (**Describe how you measured it (tools, commands, methodology)**)**

**Baseline**

| Metric                                | Value                 |
| ------------------------------------- | --------------------- |
| Console errors during normal usage    |                       |
| Unhandled promise rejections (server) |                       |
| Network disconnect recovery           | Pass / Partial / Fail |
| Missing error boundaries              |                       |
| Silent failures identified            |                       |

**Findings** Identify the specific weaknesses or opportunities you found, and Rank the severity or impact of each finding.

1.

**Remediation Plan**

---

## Category 7: Accessibility Compliance

**Methodology (**Describe how you measured it (tools, commands, methodology)**)**

**Baseline**

| Metric                                    | Value                   |
| ----------------------------------------- | ----------------------- |
| Lighthouse accessibility score (per page) |                         |
| Total Critical/Serious violations         |                         |
| Keyboard navigation completeness          | Full / Partial / Broken |
| Color contrast failures                   |                         |
| Missing ARIA labels or roles              |                         |

**Findings** Identify the specific weaknesses or opportunities you found, and Rank the severity or impact of each finding.

1.

**Remediation Plan**

---

## Appendix

[^1]: Category 1 counts used the script below with `kindToCount` set to `ts.SyntaxKind.AnyKeyword` for `any`, `ts.SyntaxKind.AsExpression` for `as` assertions, and `ts.SyntaxKind.NonNullExpression` for non-null assertions.

```bash
node <<'NODE'
const ts = require('typescript');
const fs = require('fs');
const path = require('path');

const kindToCount = ts.SyntaxKind.AnyKeyword;

function collectFiles({ roots, excludeTests }) {
  const excludedDirs = new Set(['dist', 'node_modules', 'coverage', 'test-results', 'playwright-report']);
  if (excludeTests) excludedDirs.add('__tests__');
  const files = [];

  function isTestFile(filePath) {
    return /(^|\/)(test|tests|__tests__)(\/|$)/.test(filePath)
      || /\.(test|spec)\.tsx?$/.test(filePath);
  }

  function walk(dir) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const filePath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!excludedDirs.has(entry.name)) walk(filePath);
      } else if (/\.(ts|tsx)$/.test(entry.name) && (!excludeTests || !isTestFile(filePath))) {
        files.push(filePath);
      }
    }
  }

  roots.forEach(walk);
  return files;
}

function countKind(files, roots) {
  const rows = [];
  const byRoot = {};
  let total = 0;

  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    const sourceFile = ts.createSourceFile(
      file,
      text,
      ts.ScriptTarget.Latest,
      true,
      file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
    );
    let count = 0;
    function visit(node) {
      if (node.kind === kindToCount) count += 1;
      ts.forEachChild(node, visit);
    }
    visit(sourceFile);
    if (count > 0) {
      rows.push([file, count]);
      total += count;
      const root = roots.find((candidate) => file.startsWith(candidate + '/')) || 'other';
      byRoot[root] = (byRoot[root] || 0) + count;
    }
  }

  rows.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return { total, byRoot, filesWithMatches: rows.length, scannedFiles: files.length, top20: rows.slice(0, 20) };
}

const auditRoots = ['web/src', 'api/src', 'shared/src', 'e2e'];
const prodRoots = ['web/src', 'api/src', 'shared/src'];

console.log(JSON.stringify({
  auditScope: countKind(collectFiles({ roots: auditRoots, excludeTests: false }), auditRoots),
  productionOnly: countKind(collectFiles({ roots: prodRoots, excludeTests: true }), prodRoots),
}, null, 2));
NODE
```

[^2]: Category 1 suppression count used `@ts-ignore\b|@ts-expect-error\b` over the same full and production-only file scopes.

[^3]: Category 5 static inventory used `rg -c '\b(test|it)\s*\(' --glob '*.test.ts' --glob '*.test.tsx' --glob '*.spec.ts' {api/src,web/src,shared/src,e2e}` to count declared test cases. Note: this grep counts syntactic matches including helpers and comments; the authoritative count comes from the test runners themselves.

[^4]: Category 5 throwaway database procedure for safely running API tests:

```bash
# Create throwaway DB (PostgreSQL must be running, credentials from docker-compose.yml)
PSQL="/opt/homebrew/Cellar/libpq/18.3/bin/psql"
PGURI="postgresql://ship:ship_dev_password@localhost:5432"
$PSQL "$PGURI/postgres" -c "CREATE DATABASE ship_test_audit;"

# Migrate and seed
DATABASE_URL="$PGURI/ship_test_audit" pnpm --filter @ship/api db:migrate
DATABASE_URL="$PGURI/ship_test_audit" pnpm --filter @ship/api db:seed

# Run tests (optionally with --coverage after installing @vitest/coverage-v8@4.0.17)
DATABASE_URL="$PGURI/ship_test_audit" pnpm --filter @ship/api exec vitest run
DATABASE_URL="$PGURI/ship_test_audit" pnpm --filter @ship/api exec vitest run --coverage

# Cleanup
$PSQL "$PGURI/postgres" -c "DROP DATABASE IF EXISTS ship_test_audit;"
```

[^5]: Category 5 E2E test count used Playwright's built-in listing from the `e2e/` directory:

```bash
cd e2e && npx playwright test --list 2>&1 | tail -1
# Output: "Listing 869 tests in 71 files"
```

This is authoritative over the grep-based count (883) because Playwright resolves `test.describe`, `test.skip`, parameterized tests, and other runtime constructs that grep cannot distinguish from non-test usage of `test(` / `it(`.

[^6]: Category 1 ESLint type-safety rules:

```bash
'@typescript-eslint/no-explicit-any': 'warn',
'@typescript-eslint/no-non-null-assertion': 'warn',
'@typescript-eslint/consistent-type-assertions': ['warn', {
  assertionStyle: 'as',
  objectLiteralTypeAssertions: 'never',
}],
'@typescript-eslint/no-unsafe-assignment': 'warn',
'@typescript-eslint/no-unsafe-member-access': 'warn',
'@typescript-eslint/no-unsafe-argument': 'warn',
'@typescript-eslint/no-unsafe-return': 'warn',
'@typescript-eslint/no-unnecessary-type-assertion': 'warn',
'@typescript-eslint/strict-boolean-expressions': 'off',
```
