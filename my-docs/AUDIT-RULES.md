# Audit Rules

How to complete **Phase 1: The Audit** for ShipShape.

**Spec:** [SOURCE-OF-TRUTH/GFA-Week-4-ShipShape.txt](./SOURCE-OF-TRUTH/GFA-Week-4-ShipShape.txt)  
**Your report:** [AUDIT_REPORT.md](./AUDIT_REPORT.md)  
**Repo:** https://github.com/US-Department-of-the-Treasury/ship (fork: `ship-shape/`)

---

## The audit

The audit is a **written diagnostic**. You measure the health of the codebase in **seven categories**, record **baseline numbers**, name **what is wrong**, and **rank how bad it is**.

You are proving you understand the system **before** you change it.

> **You do not fix anything during the audit.**  
> Diagnosis comes before treatment.

**Due:** Tuesday 11:59 PM (36-hour checkpoint). Kickoff also lists Wednesday 12:00 PM CT — confirm with your cohort.

**Gate:** Your audit report must include baseline measurements for **all 7 categories**. Incomplete audits are an **automatic fail**, regardless of how strong your later work is. Graders are assessing whether you can **diagnose** a system, not only fix one.

**Submit in the report:** methodology, tools used, and raw data (per GFA submission requirements).

---

## Before you audit

1. Complete the **Codebase Orientation Checklist** in the GFA appendix ([same content in your notes](./Codebase-Orientation-Checklist.md)). Do this **before** you measure anything.
2. Get the app running. Read existing code more than you write it.
3. Save orientation notes — they feed the **Context** section of your report.

---

## What every category must include

For **each** of the seven categories, your report must have:

1. **How you measured it** — tools, commands, methodology  
2. **Concrete baseline numbers** — use the tables in this document  
3. **Specific weaknesses or opportunities** — files, endpoints, flows  
4. **Ranked severity or impact** — ordered findings with rationale  

---

## Report structure

Use [AUDIT_REPORT.md](./AUDIT_REPORT.md). Suggested outline:

1. **Context** — what the system is and how it is built (from orientation)  
2. **Category 1–7** — each with methodology, baseline table, ranked findings  
3. **Appendix** — commands, tool versions, raw output (logs, benchmarks, screenshots paths)

Keep evidence so someone else can reproduce your measurements (commit SHA, seed counts, concurrency levels, etc.).

---

## Category 1: Type Safety

**Measure:** How strongly TypeScript is used — `any`, `as`, `!`, `@ts-ignore` / `@ts-expect-error`, untyped parameters, implicit `any` from missing return types.

Count source files only: web/src, api/src, shared/src, and relevant test files; exclude dist, node_modules, coverage, test-results, and generated reports.

**How:**

- Grep or static analysis for violations across the codebase  
- Check `tsconfig.json` strict settings; if strict is off, run `tsc --strict --noEmit` and count errors  
- Break down by package: `web/`, `api/`, `shared/`  
- Identify the **5 most violation-dense files** and explain why they matter  

| Metric | Your baseline |
|--------|---------------|
| Total `any` types | |
| Total type assertions (`as`) | |
| Total non-null assertions (`!`) | |
| Total `@ts-ignore` / `@ts-expect-error` | |
| Strict mode enabled? | Yes / No |
| Strict mode error count (if disabled) | |
| Top 5 violation-dense files | List with counts |

---

## Category 2: Bundle Size

**Measure:** Production **frontend** bundle size — large deps, missing code splitting, unused imports.

Build from repo root using the existing workspace script so `shared` builds first.
Report raw `web/dist` JS/CSS asset size; separately note gzip/brotli only if measured consistently.
Exclude source maps from total unless source maps are shipped.

**How:**

- Build production frontend; record total output size  
- Bundle visualizer (rollup-plugin-visualizer, vite-bundle-analyzer, source-map-explorer)  
- Largest chunks and largest dependencies  
- Cross-reference `package.json` dependencies vs actual imports  
- Note code splitting and lazy-loading opportunities  

| Metric | Your baseline |
|--------|---------------|
| Total production bundle size | ___ KB |
| Largest chunk | ___ (name + size) |
| Number of chunks | |
| Top 3 largest dependencies | List with sizes |
| Unused dependencies identified | List |

---

## Category 3: API Response Time

**Measure:** Backend response time under **realistic** load — not an empty database.

`pnpm db:seed` may not satisfy the required 500+ docs / 100+ issues / 20+ users / 10+ sprints; the rules imply it might.
Auth is missing. Most meaningful API endpoints require a logged-in session cookie.
Dynamic ports are missing. `pnpm dev` chooses available API/Web ports.

**How:**

- Seed the database: **500+ documents, 100+ issues, 20+ users, 10+ sprints** (`pnpm db:seed` or your own script)  
- Pick the **5 most important endpoints** by tracing frontend network requests during common flows  
- Benchmark with autocannon, k6, hey, or similar — record **P50, P95, P99**  
- Test at **10, 25, and 50** simultaneous connections  
- Name the slowest endpoints and why you think they are slow  

| Endpoint | P50 | P95 | P99 |
|----------|-----|-----|-----|
| 1. | ___ms | ___ms | ___ms |
| 2. | | | |
| 3. | | | |
| 4. | | | |
| 5. | | | |

---

## Category 4: Database Query Efficiency

**Measure:** How efficiently the app hits PostgreSQL — especially the unified `documents` model (N+1, indexes, full scans, over-fetching).

For local native Postgres, document the exact database name from `api/.env.local` and the query logging method used.
Treat “sprint board” as the week/sprint flow in this fork: UI week terminology, DB `document_type = 'sprint'`.
If full Postgres logging is unavailable, use API-side query instrumentation and state that limitation.

**How:**

- Enable PostgreSQL query logging (`log_statement = 'all'` or via Docker env)  
- Run these **five flows:** load main page, view a document, list issues, load sprint board, search content  
- Count total queries per flow  
- `EXPLAIN ANALYZE` on the slowest queries  
- Check indexes against `WHERE` clauses; flag N+1 (one query per row in a list)  

| User flow | Total queries | Slowest query (ms) | N+1 detected? |
|-----------|---------------|--------------------|---------------|
| Load main page | | | Yes / No |
| View a document | | | |
| List issues | | | |
| Load sprint board | | | |
| Search content | | | |

---

## Category 5: Test Coverage and Quality

**Measure:** What the test suite covers, what it misses, and whether tests are reliable. Ship has **73+ Playwright E2E tests**.

`pnpm test` measures API Vitest only; record it separately from E2E.
For E2E, use the repo’s prescribed E2E runner workflow, not direct `pnpm test:e2e`.
Record the actual discovered test count from the current fork; do not rely on “73+”.
Do not modify repo config just to add coverage during Phase 1; if coverage tooling is absent, report “not configured” and explain.

**How:**

- Run `pnpm test` — pass/fail counts and runtime  
- Read test files; catalog covered vs uncovered user flows  
- Run the suite **3 times**; note flaky tests  
- Map critical flows (document CRUD, real-time sync, auth, sprint management) to coverage  
- If coverage tooling is not set up, configure it and report line/branch % per package  

| Metric | Your baseline |
|--------|---------------|
| Total tests | |
| Pass / Fail / Flaky | ___ / ___ / ___ |
| Suite runtime | ___s |
| Critical flows with zero coverage | List |
| Code coverage % (if measured) | web: ___% / api: ___% |

---

## Category 6: Runtime Error and Edge Case Handling

**Measure:** What happens when things go wrong — error boundaries, unhandled rejections, network failure during collaboration, bad input, missing error UI.

For collaboration recovery, document browser/session setup: two windows or contexts, logged in, same document URL.
Record the Web/API ports used and where browser console/server logs were captured.

**How:**

- Count console errors and warnings during normal use (DevTools)  
- Disconnect while editing a document collaboratively, then reconnect — data and UI recovery  
- Malformed input: empty forms, very long text, special characters, HTML/script injection  
- Two users editing the same document field at once  
- Throttle to 3G; note hung spinners, silent failures, missing loading states  
- Check server logs for unhandled errors during the above  

| Metric | Your baseline |
|--------|---------------|
| Console errors during normal usage | |
| Unhandled promise rejections (server) | |
| Network disconnect recovery | Pass / Partial / Fail |
| Missing error boundaries | List locations |
| Silent failures identified | List with reproduction steps |

---

## Category 7: Accessibility Compliance

**Measure:** Whether Ship’s **Section 508** and **WCAG 2.1 AA** claims hold up. Verify; do not assume.

Define the audited major pages before scanning, using orientation context; include at minimum login plus core authenticated app flows.
Run accessibility checks in an authenticated browser session for protected pages and record the exact URLs/routes.

**How:**

- Lighthouse accessibility on **every major page** — record score per page  
- axe-core, pa11y, or axe browser extension — violations by Critical / Serious / Moderate / Minor  
- Keyboard-only navigation (Tab, Enter, Escape, arrows) — every interactive element reachable?  
- Screen reader (VoiceOver, NVDA, etc.) — structure and controls understandable?  
- Color contrast on text, buttons, controls — **4.5:1** minimum (WCAG 2.1 AA)  

| Metric | Your baseline |
|--------|---------------|
| Lighthouse accessibility score (per page) | List scores |
| Total Critical/Serious violations | |
| Keyboard navigation completeness | Full / Partial / Broken |
| Color contrast failures | |
| Missing ARIA labels or roles | List locations |

---

## During the audit: do not

- Change application code to “fix” issues  
- Turn in a report with empty or missing category tables  
- Benchmark API or database behavior on an empty or unrealistic dataset without saying so  

---

## Pass / fail (self-check)

- [ ] Written report with all **7** categories  
- [ ] Each category: methodology, baseline numbers, weaknesses, ranked severity  
- [ ] Methodology, tools, and raw data included  
- [ ] Orientation completed before measuring  

---

## Source documents

- [GFA Week 4 — ShipShape (txt)](./SOURCE-OF-TRUTH/GFA-Week-4-ShipShape.txt)  
- [GFA Week 4 — ShipShape (pdf)](./SOURCE-OF-TRUTH/GFA%20Week%204%20-%20ShipShape.pdf)  
- [ShipShape Kickoff (txt)](./SOURCE-OF-TRUTH/ShipShape-Kickoff.txt)

*Depth over breadth. Proof over promises.*
