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

---

## Category 2: Bundle Size

**Methodology (**Describe how you measured it (tools, commands, methodology)**)**

**Baseline**

| Metric                         | Value         |
| ------------------------------ | ------------- |
| Total production bundle size   | KB            |
| Largest chunk                  | (name + size) |
| Number of chunks               |               |
| Top 3 largest dependencies     |               |
| Unused dependencies identified |               |

**Findings** Identify the specific weaknesses or opportunities you found, and Rank the severity or impact of each finding.
1.

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

---

## Category 5: Test Coverage and Quality

**Methodology (**Describe how you measured it (tools, commands, methodology)**)**

**Baseline**

| Metric                            | Value           |
| --------------------------------- | --------------- |
| Total tests                       |                 |
| Pass / Fail / Flaky               | / /             |
| Suite runtime                     | s               |
| Critical flows with zero coverage |                 |
| Code coverage % (if measured)     | web: % / api: % |

**Findings** Identify the specific weaknesses or opportunities you found, and Rank the severity or impact of each finding.
1.

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
