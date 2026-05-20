# Discovery Write-Up

---

## Discovery 1

### Name

The unified document model moves complexity to type boundaries

### Severity

High

### Where Found

- `api/src/db/schema.sql`: the `documents` table is the unified content table, with `document_type`, shared editor content, Yjs state, parent hierarchy, and lifecycle fields.
- `api/src/db/schema.sql`: the `properties JSONB` column stores type-specific fields such as issue state, project metadata, sprint dates, and person profile data.
- `my-docs/AUDIT_REPORT.md`: Category 1 identified `api/src/routes/weeks.ts`, `api/src/routes/projects.ts`, and `api/src/routes/issues.ts` as the densest production type-safety files.

### What It Does And Why It Matters

Ship uses a flexible Notion-style model where wiki pages, issues, programs, projects, sprints, people, weekly plans, retros, standups, and reviews all live in the same `documents` table. That design gives the product a clean conceptual spine: content types differ mostly by discriminator and properties, not by separate table families.

The tradeoff is that the compiler loses precision at the database boundary. Once type-specific fields move into `properties JSONB`, route code has to recover meaning from a generic row. The audit showed the natural failure mode: `any`, `as`, non-null assertions, and unsafe row access concentrate in route files that turn flexible documents into concrete API responses.

This is not just a cleanup problem. It is the central architecture tradeoff of the app. A flexible content model needs explicit runtime narrowing, typed row mappers, and route-boundary validation, otherwise the flexibility becomes invisible risk.

### Future Application

On future projects, a polymorphic or JSON-heavy model should come with typed boundary helpers from the beginning. If the database shape is intentionally flexible, the application layer needs intentionally strict parsers and mappers. Otherwise, the schema looks simple while complexity leaks into every endpoint.

---

## Discovery 2

### Name

API test setup can erase real data unless the database is disposable

### Severity

High

### Where Found

- `api/src/test/setup.ts`: the API test setup runs `TRUNCATE TABLE ... CASCADE` across workspaces, users, documents, audit logs, associations, sessions, files, comments, and related tables.
- `package.json`: root `pnpm test` runs the API test suite by default.
- `my-docs/MEMORY.md`: the sidecar `ship_test_audit` database is explicitly reserved for destructive API test and coverage benchmarking.

### What It Does And Why It Matters

The API test harness clears core tables before tests. That can be reasonable for integration tests, but only if the database target is guaranteed to be disposable. In this repo, the destructive setup is close to normal developer commands: root `pnpm test` points at API tests, and local development uses PostgreSQL directly rather than an always-isolated container by default.

The hazard is not theoretical. If `DATABASE_URL` points at the wrong local database, the setup can wipe real development data. That includes documents, users, workspaces, sessions, comments, files, and audit history.

This matters because test infrastructure is trusted infrastructure. A test command should never require the developer to remember which database is safe; the harness should prove that before destructive cleanup runs.

### Future Application

Any destructive test setup should include a hard safety check: database name, environment variable, host, or test-specific marker table. The best version fails closed unless the target clearly identifies itself as disposable.

---

## Discovery 3

### Name

Executable startup scripts were more accurate than setup docs

### Severity

Medium

### Where Found

- `scripts/dev.sh`: creates `api/.env.local` when missing.
- `scripts/dev.sh`: derives a local database name from the worktree directory and creates the database if needed.
- `scripts/dev.sh`: runs migrations before seed on fresh databases.
- `scripts/dev.sh`: finds available API and web ports dynamically and writes `.ports`.
- `my-docs/Codebase-Orientation-Checklist.md`: records the differences found during orientation.

### What It Does And Why It Matters

The repo's actual local startup behavior lives in `scripts/dev.sh`. It handles environment creation, database bootstrapping, migration order, seed order, dynamic port selection, and multi-worktree ergonomics.

That operational truth was more precise than the static setup docs. The docs were not useless, but they lagged behind the automation. For a new engineer, following the README alone could lead to unnecessary Docker assumptions, wrong setup order, or hard-coded port expectations.

This matters because inherited systems often have two forms of documentation: prose and executable workflow. When they disagree, the script usually reveals what the maintainers actually optimized for.

### Future Application

When orienting in an unfamiliar codebase, inspect the startup scripts early. They reveal assumptions about databases, ports, environment files, package manager versions, and developer workflows that prose docs often miss. Then reconcile docs to match the executable path.

---

## Other Candidates

### Devtools dependency looks like an assessment trap

Severity: Medium

`web/package.json` lists `@tanstack/react-query-devtools` under production `dependencies`, and `web/src/main.tsx` imports and renders `ReactQueryDevtools` eagerly. This is noteworthy because the source brief explicitly asks for bundle-size measurement, missing code splitting, unused dependencies, and oversized dependencies. The package name itself says "devtools", so it is a conspicuous candidate for auditors to catch. I would not claim it was intentionally planted without evidence, but it looks assessment-shaped: easy to notice, easy to verify, and directly aligned with the prompt.

Related dependency notes:

- `@tanstack/query-sync-storage-persister` appears unused by static import checks and bundle-report checks.
- `@modelcontextprotocol/sdk` is in API production dependencies, but it is imported by `api/src/mcp/server.ts`, which is exposed as an `mcp` package script. That needs classification before calling it misplaced.

### Root lint was a no-op placeholder

Severity: Low-Medium

Before the ESLint remediation, root `pnpm lint` ran `pnpm --recursive run lint`, but no workspace package had a `lint` script. The command exited 0 while doing no linting. This is useful evidence that green commands can be counterfeit, but it is less deep than the top discoveries.

### Search ownership drifted across docs, UI, and API

Severity: Medium

Architecture docs describe server search with offline fallback, the backend exposes mention and learning search endpoints, and the Docs page filters the already-loaded document list client-side by title. The term "search" means different things in different layers. This is a good candidate if later work touches search, but it is currently less central than the top three.

### Provisional assessment-shaped leads

Severity: Needs verification

These are not finished discoveries yet. They are suspicious because they look like the kinds of issues an audit prompt may expect someone to notice, but each one needs a tighter verification pass before it should be promoted, fixed, or deleted.

- Tracked deployment bundles: git tracks four `deploy-api-ship-api-*.zip` files, each about 577 KB. A spot check shows compiled `api/dist`, `shared/dist`, source maps, SQL migrations, package metadata, and a Dockerfile inside the bundle. No `.env` or obvious secret filename appeared in the quick listing check, so this is currently a repository hygiene and release-artifact concern, not a proven secret leak.
- Tracked temporary deployment plan: `temporary.deployment-plan.md` was created by us as disposable planning context, with the explicit intention to delete or replace it once the real deployment checklist is settled. This is not a mystery artifact or external defect. Remove this note from `DISCOVERY.md` once the file is deleted.
- Dash-prefixed progress file: `-progress.txt` is tracked at the repo root. The size is tiny, but the leading dash is a shell footgun for commands that do not use `--` before filenames. This is probably low severity unless it reflects broader artifact hygiene problems.
- Migration runner catch behavior: `api/src/db/migrate.ts` catches any thrown error whose message includes `already exists` and then logs "Database schema already exists, continuing..." without rethrowing. Because that catch wraps schema setup and numbered migrations together, it needs verification to prove whether a real migration failure could be misclassified and skip later work. The current `schema.sql` is mostly idempotent, so this may be a nothing burger; the catch scope is what looks suspicious.
- Route-level code splitting may be incomplete: `web/src/main.tsx` eagerly imports the major page components and eagerly renders `ReactQueryDevtools`. The app does use `React.lazy` for document tabs in `web/src/lib/document-tabs.tsx`, so this is not "no code splitting." The candidate is narrower: top-level route pages may still be bundled together, which matters because the audit/source docs call out bundle size, missing code splitting, and oversized dependencies.
- Stubbed RACI fields: `shared/src/types/document.ts` includes `consulted_ids` and `informed_ids` comments marked "stubbed for now." That may be harmless future-proofing, or it may mean shared types advertise a product capability that the implementation does not actually support. Needs a UI/API pass before ranking.

---

## Assessment-Shaped Candidates From Follow-Up Audit

These are deliberately kept broad. They are not yet ranked against the top discoveries above. The goal is to preserve the weird, high-signal audit leads before pruning them into the final submission.

### Security enforcement docs claim CI gates that are not present

Severity: High

Status: Confirmed

`SECURITY.md` says GitHub Actions provides a second layer of enforcement with `secrets-scan` and `attestation-check`, and says those are required status checks that PRs cannot merge without passing. The repo has no tracked `.github` workflow files (`git ls-files .github | wc -l` returned `0`). The only tracked local hook is `.husky/pre-commit`, and it skips compliance scanning entirely when `comply` is not installed. The same hook also runs `comply opensource ... --skip-trivy`, while `SECURITY.md` describes vulnerability scanning via Trivy.

Why it matters: this is safety theater with operational consequences. A maintainer can believe secrets, attestation, and vulnerability checks are enforced in CI when the tracked repo does not contain that enforcement.

Why it is easy to miss: the policy prose is confident, `ATTESTATION.md` says `scan_result: PASS`, and the pre-commit hook exists. The weakness only appears when comparing policy, tracked CI config, and hook behavior.

Possible mediation: either add actual CI workflows and branch protection for the named gates, or downgrade the docs and attestation language to match the current enforcement. If local compliance is intended to block commits, missing `comply` should fail closed instead of warning and proceeding.

### API production bundles include compiled tests and source maps

Severity: Medium

Status: Confirmed

`api/tsconfig.json` includes `src/**/*` and only excludes `src/test/**/*`, which means `__tests__` directories and `*.test.ts` files compile into `api/dist`. The root `tsconfig.json` enables `sourceMap` and `declarationMap`. A local build artifact check found `api/dist` contained 513 files, including 112 test-related files and 214 map files. `scripts/deploy.sh` bundles `api/dist` wholesale into the Elastic Beanstalk deploy zip.

Why it matters: production deploys carry test code and source maps. That increases artifact size, exposes implementation structure, and makes release artifacts look less production-shaped than the deploy script implies.

Why it is easy to miss: `dist` is ignored by git and the build script looks conventional. You have to inspect emitted files or deployment bundle contents to see the leak.

Possible mediation: exclude `**/*.test.ts` and `**/__tests__/**` from the API production build. Decide whether production deploys should emit source maps at all; if yes, make that an explicit release choice instead of an inherited compiler default.

### Tracked deploy, Terraform, and Vite dev artifacts bypass ignore rules

Severity: Medium

Status: Confirmed

Git tracks four root `deploy-api-ship-api-*.zip` files, `terraform/environments/shadow/tfplan`, and `web/dev-dist/*`. `.gitignore` ignores `ship-api-*.zip`, but not `deploy-api-ship-api-*.zip`; it ignores only `terraform/*.tfplan` and `terraform/tfplan`, not nested environment plans; it also ignores `web/dev-dist/`, but those files remain tracked because ignores do not untrack existing files. The deploy zips are about 577 KB each, the Terraform plan is about 28 KB, and `web/dev-dist/workbox-91dfe804.js` is about 170 KB.

Why it matters: build and deployment byproducts are mixed into source control. The deploy zip contents include compiled API, compiled tests, source maps, package metadata, lockfile, Dockerfile, and vendor dist files. The Terraform plan is environment-specific generated state.

Why it is easy to miss: `.gitignore` appears to cover the artifact categories, but the patterns miss the actual file names and tracked files are grandfathered in.

Possible mediation: decide whether any artifact is intentionally archival. Otherwise remove the tracked artifacts, tighten ignore patterns for `deploy-api-*.zip` and nested `terraform/**/tfplan`, and add a tracked-artifact check for release bundles, plans, dev-dist, reports, traces, and screenshots.

### OpenAPI advertises full document search that Express does not implement

Severity: Medium

Status: Confirmed

`api/src/openapi/schemas/search.ts` registers `GET /search/documents` with the description "Full-text search across all document types." `api/openapi.json` and `api/openapi.yaml` include that path. But `api/src/routes/search.ts` only implements `/mentions` and `/learnings`, and `api/src/app.ts` mounts that router at `/api/search`. There is no `searchRouter.get('/documents')`.

Why it matters: generated API clients, Swagger users, and MCP/API automation can trust an endpoint that will 404 at runtime. This is a capability mirage, not just stale prose.

Why it is easy to miss: the OpenAPI artifact is generated and looks authoritative. The contradiction only appears when comparing schema registration to the mounted router.

Possible mediation: implement `/api/search/documents`, or remove it from OpenAPI and update docs to say current search is limited to mention search, learning search, and client-side document-title filtering.

### API coverage pre-commit gate is a changed-file heuristic, not a repo integrity check

Severity: Low-Medium

Status: Confirmed

`scripts/check-api-coverage.sh` says it verifies API coverage for UI routes. In pre-commit it runs with `--staged`, only scans staged JavaScript/TypeScript files, skips non-`web/` files, extracts simple `fetch('/api/...')` and `axios.*('/api/...')` patterns, then exits 0 when no staged UI files are found. Running it with no matching changed files produced "No UI files changed" and exited 0 even though the OpenAPI/router search drift above exists.

Why it matters: the script name sounds like a coverage gate, but it cannot catch existing route/OpenAPI drift and many API call shapes. It can still be useful, but only as a narrow staged-change lint.

Why it is easy to miss: pre-commit output is green and the script has a serious name.

Possible mediation: rename it to describe the actual scope, or add a separate repo-wide route/OpenAPI consistency check. If kept as a gate, make false-positive exceptions explicit and test the checker itself.

### First-time setup allows a race into multiple super admins

Severity: High

Status: Confirmed

`api/src/routes/setup.ts` exposes unauthenticated `POST /api/setup/initialize`. It checks `SELECT COUNT(*) FROM users`, then creates a workspace, super-admin user, membership, person document, and welcome document without an explicit transaction, lock, or "setup already claimed" constraint. Two requests against an empty database could both observe zero users before either insert commits.

Verification note: the disposable database was only a microscope, not the finding. The preexisting repo issue is the setup route's unlocked check-then-create flow. Verified with a throwaway database: 25 concurrent `POST /api/setup/initialize` requests all returned `201` with `success: true`. The database then reported `{"users":25,"super_admins":25}`. The server logged 25 separate "Initial setup complete: raceN@example.test is now super admin" messages.

Why it matters: first-user bootstrap is a tiny path with huge authority. In a real empty deployment, concurrent setup attempts can mint multiple initial super admins and multiple workspaces.

Why it is easy to miss: the code comment calls the user count check "the critical security check," and for normal single-user setup it works.

Possible mediation: wrap setup initialization in a transaction with a database advisory lock, or use a single-row setup lock table / unique sentinel insert that only one request can win.

### Migration runner misclassifies real migration failures as success

Severity: High

Status: Confirmed

`api/src/db/migrate.ts` wraps schema setup and all numbered migration execution in one broad `try`. If any thrown error message includes `already exists`, it logs "Database schema already exists, continuing..." and exits without rethrowing. The comment says "`already exists` errors from schema.sql are fine," but the catch scope includes pending numbered migrations too.

Verification note: the disposable database was only a microscope, not the finding. The preexisting repo issue is the migration runner's broad success-on-`already exists` catch. Verified with a throwaway database: `DATABASE_URL=... pnpm --filter @ship/api db:migrate` printed successful application through `009_audit_logs_nullable_actor`, then hit `010_oauth_state.sql`, printed `Database schema already exists, continuing...`, and exited 0. The database had only 10 rows in `schema_migrations`, ending at `009_audit_logs_nullable_actor`, while the repo has 42 migration files.

Why it matters: migration scripts are deployment-critical. This is a fake-green migration path: a fresh database can look successfully migrated while 32 migrations are unapplied.

Why it is easy to miss: schema setup is mostly idempotent, and the broad catch looks like a friendly bootstrap compatibility path.

Possible mediation: narrow the `already exists` catch to schema bootstrap only, or better, make `schema.sql` fully idempotent and let numbered migration failures always fail closed.

### Dash-prefixed root progress file is a tiny shell footgun

Severity: Low

Status: Confirmed

Git tracks a root file named `-progress.txt`. The content is tiny, but the leading dash can confuse shell commands that do not use `--` before filenames.

Why it matters: low by itself, but it is a strong smell in an assessment-shaped audit because it combines artifact hygiene with shell ergonomics.

Why it is easy to miss: it appears as just another small text artifact unless you inspect tracked root files carefully.

Possible mediation: remove or rename the file. Add a tracked-root-artifact scan for leading-dash filenames, archives, plans, traces, and temporary documents.

### Temporary deployment plan is tracked project debris

Severity: Low

Status: Confirmed

Git tracks `temporary.deployment-plan.md`. The file name itself says it is temporary, and the content is deployment planning context rather than product/source documentation.

Why it matters: probably harmless operationally, but it is repository hygiene evidence. Temporary planning docs age into false source-of-truth documents unless they are retired or promoted intentionally.

Why it is easy to miss: markdown planning docs look like normal repo documentation until their name and content are compared against the real deployment docs.

Possible mediation: delete it if obsolete, or promote the still-valid parts into the real deployment docs with a non-temporary filename.

### Route-level code splitting remains incomplete at the app entry

Severity: Medium

Status: Needs verification

`web/src/main.tsx` eagerly imports major route pages and renders `ReactQueryDevtools` eagerly. The app does use `React.lazy` for document tabs, so the issue is not "no code splitting." The narrower issue is that page-level routing may still pay for expensive surfaces on initial load, while the audit requirement specifically rewards initial bundle reduction.

Why it matters: bundle reports showed the main JS chunk dominates the production bundle, so route-level lazy loading may be one of the cleanest ways to reduce initial load without removing functionality.

Why it is easy to miss: the build emits many chunks, which makes "we have code splitting" look true until you inspect the main chunk.

What would prove it real: a production bundle comparison showing large route/page modules in the initial chunk and a meaningful main-chunk reduction after route-level `React.lazy`.

What would make it harmless: if Rollup already tree-splits most page code despite eager imports, or if the main chunk is dominated by shared editor/collab dependencies that every initial route truly needs.

Possible mediation: dynamically import route pages, dev-only gate React Query Devtools, and lazy-load editor-only dependencies from non-editor routes.

### RACI fields graduated from "stubbed" comments to partial product surface

Severity: Low-Medium

Status: Needs verification

`shared/src/types/document.ts` comments mark `consulted_ids` and `informed_ids` as "stubbed for now." Follow-up search shows those fields are now accepted by project/program routes, included in OpenAPI schemas, mapped through document routes, and rendered in Program/Project sidebars. The suspicious part is not that the fields are absent; it is that the shared type comments still describe them as stubs while API/UI now expose them as a real capability.

Why it matters: stale "stubbed" comments around accountability fields can hide whether the fields are meant to drive permissions, notifications, filtering, or only passive display. That ambiguity matters for RACI semantics.

Why it is easy to miss: the implementation has enough surface area to look real, while the type comments preserve old uncertainty.

What would prove it real: product/docs or tests imply consulted/informed users should receive behavior beyond storage/display, but no such behavior exists.

What would make it harmless: if consulted/informed are intentionally passive metadata and the comments are merely stale.

Possible mediation: update terminology and tests around RACI semantics. If C/I are passive display fields, say so. If they imply workflow behavior, implement or remove the advertised semantics.
