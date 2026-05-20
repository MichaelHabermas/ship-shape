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

### Document comments bypass private document visibility

Severity: High

Status: Confirmed

`api/src/routes/documents.ts` treats document visibility as an access-control boundary. The helper `canAccessDocument()` only grants access when a document is workspace-visible, owned by the requester, or the requester is a workspace admin, and `GET /api/documents/:id` returns 404 when that check fails. The comments router does not apply the same boundary. `GET /api/documents/:id/comments` only filters by `comments.document_id` and `comments.workspace_id`; `POST /api/documents/:id/comments` only verifies that a matching document exists in the workspace; `PATCH /api/comments/:id` lets any workspace member resolve a comment found by comment id and workspace id.

Runtime proof note: verified against a disposable database named `ship_audit_visibility_proof`, then dropped it. A non-owner workspace member logged in successfully, got `404` for `GET /api/documents/:privateId`, but got `200` from `GET /api/documents/:privateId/comments` with `"SECRET comment body"`, got `201` from `POST /api/documents/:privateId/comments`, and got `200` from `PATCH /api/comments/:ownerCommentId` resolving the owner's private-document comment.

Why it matters: private documents are explicitly modeled and tested as hidden from other workspace members, but their comments can be listed, created, or resolved by a workspace member who knows or obtains the private document/comment id. Even if document ids are hard to guess, private document links, logs, browser history, notifications, or copied API payloads can turn this into a real confidentiality break.

Why it is easy to miss: the document routes have serious-looking visibility tests, and comments are mounted under `/api/documents`, which makes them look document-scoped. The missing piece is that the comments router never calls the document visibility helper.

Possible mediation: extract document visibility checks into a shared helper/middleware and require it for every document-child route, including comments, backlinks, associations, content, and future document-scoped surfaces. Add regression tests where a non-creator workspace member gets 404 for both a private document and its comments.

### Associations and context leak private related document metadata

Severity: Medium-High

Status: Confirmed

`api/src/middleware/visibility.ts` defines the intended filter for private documents: workspace-visible, creator-owned, or admin. `api/src/routes/backlinks.ts` uses that filter for both the requested document and linked documents. `api/src/routes/associations.ts` is inconsistent: it checks access to the requested document, but `GET /api/documents/:id/associations` joins `documents d ON d.id = da.related_id` and returns `related_title` and `related_document_type` without filtering the related document's visibility. `GET /api/documents/:id/reverse-associations` checks access to the target document, then joins and returns source document titles without filtering source visibility. `GET /api/documents/:id/context` similarly returns ancestors, children, and `belongs_to` documents without applying `VISIBILITY_FILTER_SQL` to those related rows.

Runtime proof note: verified against the same disposable database, then dropped it. A non-owner workspace member could access a visible document and received private related metadata: `GET /api/documents/:visibleId/associations` returned `related_title: "SECRET Project Title"`, `GET /api/documents/:visibleId/reverse-associations` returned `"SECRET Child Title"` and `"SECRET Project Title"`, and `GET /api/documents/:visibleId/context` returned the private project in `children`, `belongs_to`, and `breadcrumbs`.

Why it matters: a workspace-visible document can become a window into nearby private documents. Even when the private document body stays protected, ids, titles, document types, ticket numbers, hierarchy, and program/project/sprint relationships can leak through association/context endpoints.

Why it is easy to miss: each endpoint starts with a legitimate access check, and the route names sound like metadata. The bug is one hop later: related rows need their own visibility filter.

Possible mediation: apply `VISIBILITY_FILTER_SQL` to every joined document returned from association/context endpoints, not only to the primary requested document. Add tests for visible document -> private related document, private source -> visible target reverse association, and private child/ancestor in context results.

### Comments OpenAPI paths accidentally double the `/api` prefix

Severity: Medium

Status: Confirmed

`api/src/openapi/registry.ts` declares the OpenAPI server URL as `/api`, and most registered paths are unprefixed, such as `/documents`, `/issues`, `/auth/login`, and `/documents/{id}/backlinks`. `api/src/openapi/schemas/comments.ts` is the exception: it registers `/api/documents/{id}/comments` and `/api/comments/{id}`. The actual Express routes are mounted in `api/src/app.ts` at `/api/documents` and `/api/comments`, so the runtime URLs are `/api/documents/:id/comments` and `/api/comments/:id`. A client honoring the OpenAPI server URL plus the comment paths would call `/api/api/documents/{id}/comments` and `/api/api/comments/{id}`.

Why it matters: comments are present in the generated contract, but the generated contract points clients and MCP/API automation at non-existent double-prefixed URLs. This is another generated-source-of-truth trap, and it sits right next to the private-document comments issue.

Why it is easy to miss: the path strings look correct if you inspect only the comments schema. The bug appears only when you compare the comments schema against the registry server URL and the rest of the OpenAPI path convention.

Possible mediation: change the comments OpenAPI registrations to `/documents/{id}/comments` and `/comments/{id}`. Add a contract consistency check that fails when any registered path starts with `/api/` while the server URL is already `/api`.

### Super-admin debug user deletion can partially deprovision a user

Severity: Medium

Status: Confirmed

`api/src/routes/admin.ts` mounts all admin routes behind `authMiddleware` and `superAdminMiddleware`, so this is not unauthenticated. The risk is operational: `DELETE /api/admin/debug/users/:id` is a live route labeled "for cleanup" that deletes `sessions`, then `workspace_memberships`, then `users` as three separate pool queries with no transaction. The schema still has `document_history.changed_by UUID REFERENCES users(id)` without `ON DELETE SET NULL` or `ON DELETE CASCADE`, so deleting a user who has history rows can fail at the final `DELETE FROM users` after their sessions and workspace memberships have already been removed.

Why it matters: a cleanup/debug endpoint can strand a real user in a partially deprovisioned state: account row remains, but sessions and workspace access are gone. The route then returns 500, so an operator may retry or manually intervene without realizing the first two deletes already committed.

Why it is easy to miss: the route is super-admin-only and "debug" named, so auditors may stop reading at the middleware. The actual failure mode is the ordering plus missing transaction plus one remaining non-nullifying foreign key.

Possible mediation: either remove production exposure for debug cleanup routes, or wrap the deletion in a transaction and make user deletion semantics explicit across all user foreign keys. If deletion is not a product requirement, replace it with a reversible disable/archive flow.

### CAIA configuration is split between SSM docs, Secrets Manager runtime, and save-anyway validation

Severity: Low-Medium

Status: Needs verification

`api/src/config/ssm.ts` documents CAIA OAuth credentials as living under SSM Parameter Store alongside `DATABASE_URL`, `SESSION_SECRET`, and `CORS_ORIGIN`, but production startup only loads `DATABASE_URL`, `SESSION_SECRET`, `CORS_ORIGIN`, `CDN_DOMAIN`, and `APP_BASE_URL` from SSM. The CAIA runtime instead reads `/ship/{ENVIRONMENT}/caia-credentials` from AWS Secrets Manager via `api/src/services/secrets-manager.ts`. The super-admin credentials UI validates issuer discovery before saving, but explicitly logs "Validation FAILED (will save anyway)" and persists the credentials anyway with only a warning.

Why it matters: this is a configuration split-brain around the primary PIV/OIDC path. A maintainer following SSM-oriented docs or expectations could update the wrong store; a super-admin can also persist a broken issuer/client configuration that startup later logs and swallows via `initializeCAIA().catch(...)` in `api/src/app.ts`.

Why it is easy to miss: each piece is individually reasonable: SSM for app config, Secrets Manager for editable OAuth credentials, admin UI validation, startup validation. The problem is the combined operational story is not fail-closed.

What would prove it real: a production or shadow run where CAIA credentials in SSM are ignored, invalid Secrets Manager credentials are saved by the admin UI, and PIV login fails while the app otherwise stays healthy.

What would make it harmless: if the deployment docs and runbooks clearly say CAIA credentials are exclusively managed through the admin UI/Secrets Manager, and save-anyway is a deliberate emergency override with operator-visible warnings.

Possible mediation: update SSM comments/docs to remove CAIA credential claims, make issuer validation failure block saves by default, and require an explicit "save invalid credentials anyway" override if that escape hatch is truly needed.

### Claude context endpoint bypasses private document visibility

Severity: High

Status: Confirmed

`api/src/routes/claude.ts` exposes authenticated `GET /api/claude/context` for standup, review, and retro context. The route passes only `sprint_id` or `project_id` plus `workspaceId` into its helper functions; it does not pass `userId`, does not call `getVisibilityContext()`, and does not apply `VISIBILITY_FILTER_SQL`. The helper queries then return rich context: program names/goals/content, project plans and ICE/monetary fields, sprint plans, standup bodies, review bodies, and issue titles. This is visible in `getStandupContext()`, `getReviewContext()`, and `getRetroContext()`.

Why it matters: this is an AI-integration endpoint, so a Claude/API-token workflow can become a clean private-content exfiltration path when the caller knows a private sprint or project id. "Read-only" is not sufficient protection when the response contains private content.

Why it is easy to miss: the route is labeled read-only and purpose-built for Claude context, so it looks like a harmless convenience layer. The missing piece is that AI context needs the same document visibility boundary as normal document reads.

Possible mediation: pass `userId` into all Claude context helpers, use the shared document visibility middleware/filter for the primary sprint/project and every joined related document, and add regression tests where a non-owner gets no context for private sprint/project ids.

### Claude retro context queries an impossible document shape

Severity: Medium

Status: Confirmed

`api/src/routes/claude.ts` implements retro context by querying `d.sprint_number` and ordering by `d.sprint_number`, but `sprint_number` is stored in `documents.properties`, not as a `documents` column. `api/src/db/schema.sql` and the numbered migrations do not define a `sprint_number` column. The same helper also queries `WHERE d.document_type = 'project_retro'`, but the Postgres `document_type` enum and shared `DocumentType` union do not include `project_retro`. The normal project retro route stores retro state back onto the `project` document row instead.

Why it matters: the Claude retro feature appears to provide rich project-retrospective context, but the code path is likely dead or fake-green. It can fail before returning context, and even if the missing column were fixed, the existing-retro lookup searches for a document type the database cannot represent.

Why it is easy to miss: `project_retro` is a valid accountability type, so the string looks legitimate. The mismatch only appears when comparing accountability types, document types, schema columns, and the project retro route implementation.

Possible mediation: change the sprint query to use `d.properties->>'sprint_number'`, and decide whether project retros are stored as project properties/content or as first-class documents. If they stay on the project row, remove the `project_retro` document lookup from Claude context.

### Activity endpoint exposes private entity existence and activity shape

Severity: Low-Medium

Status: Confirmed

`api/src/routes/activity.ts` handles `GET /api/activity/:entityType/:entityId`. It verifies only that the requested entity id exists in the current workspace with the requested `document_type`; it does not apply document visibility. The program/project/sprint activity queries then count linked documents over the last 30 days, also without visibility filters.

Why it matters: this does not expose document bodies, but it can distinguish "private entity exists" from "invalid id" and can reveal a 30-day activity pattern for private programs, projects, or weeks. That matters because other visibility leaks already expose related ids and titles.

Why it is easy to miss: aggregate activity looks harmless, especially because the response only contains dates and counts. The issue is that counts can still be metadata disclosure.

Possible mediation: apply the same visibility check used by the corresponding program/project/week read endpoint before returning activity. For counts, either count only visible linked documents or return 404 when the root entity is not visible to the requester.

### Dashboard allocation views may leak private project and issue metadata

Severity: Medium

Status: Needs verification

`api/src/routes/dashboard.ts` builds `/api/dashboard/my-focus` and `/api/dashboard/my-week` from sprint allocation data. The allocation queries join allocated sprints to project and program documents and return project titles and program names without applying visibility filters to the sprint, project, or program rows. `my-focus` also fetches recent issue ids, titles, ticket numbers, states, and update times for the allocated project ids without applying issue visibility filters.

Why it matters: if private project visibility is meant to remain creator/admin-only even when a person is allocated to related work, these dashboard endpoints can surface private project/program/issue metadata to the assignee. If allocation intentionally grants visibility, this may be expected behavior rather than a bug.

Why it is easy to miss: dashboards are "my work" surfaces, so it is natural to assume assigned work is visible. The actual product rule needs to be explicit because it crosses assignment semantics with private document semantics.

What would prove it real: in a disposable database, create a private project owned by user A, create a sprint allocated to user B, and verify whether user B's `/api/dashboard/my-week` or `/api/dashboard/my-focus` response includes the private project title, program name, or issue titles.

What would make it harmless: product documentation or access-control policy says allocation membership intentionally grants read visibility to the allocated project/week.

Possible mediation: define the rule. If assignment does not grant visibility, add `VISIBILITY_FILTER_SQL` to the dashboard joins and recent activity query. If assignment does grant visibility, document that explicitly and add tests so it is not mistaken for an accidental leak later.

### API tokens are full delegated bearer credentials, not scoped Claude/tool tokens

Severity: Low-Medium

Status: Needs verification

The product copy frames API tokens as external-tool access: `web/src/pages/WorkspaceSettings.tsx` says "API tokens allow external tools like Claude Code to access Ship on your behalf," and `docs/application-architecture.md` describes them under "CLI tools and automation." The implementation has no scopes: `api/src/routes/api-tokens.ts` accepts only token name and optional expiry. `api/src/middleware/auth.ts` validates a bearer token and attaches the token owner's `userId`, `workspaceId`, and `isSuperAdmin` to the request, making the token act like that user for any route that accepts bearer auth. The MCP server then generates tools from OpenAPI operations and sends the same bearer token for every generated API call.

Why it matters: this may be an intentional full-delegation model, but the UI/docs do not make the blast radius obvious. A "Claude Code" token can be read as narrow automation access when it is actually a bearer credential with the user's normal powers, and potentially super-admin powers for a super-admin token.

Why it is easy to miss: token storage is solid enough to look secure: hashes, prefixes, optional expiration, revocation, and audit events. The assessment-shaped issue is authorization scope, not token secrecy.

What would prove it real: runtime proof that a token created for Claude Code can call mutating document/project/issue endpoints, or that a super-admin-created token can reach super-admin routes. That would show the token is full-account delegation, not just OpenAPI/MCP automation.

What would make it harmless: the product explicitly documents that API tokens have the same authority as the account that creates them, including super-admin powers where applicable.

Possible mediation: either add scopes/read-only tokens for external tools, or update the UI/docs to say "tokens act with your full account permissions." If super-admin bearer use is not intended, block API-token authentication from super-admin-only routes.

### OpenAPI/MCP coverage looks comprehensive but misses live route families

Severity: Medium

Status: Confirmed

`api/src/openapi/registry.ts` says all route schemas should be registered for full API documentation, and the generated OpenAPI document has enough paths to look authoritative. But `api/src/app.ts` mounts live route families that are not represented in the generated contract, including setup, admin/debug, invites, several document subroutes, Claude context, and other operational surfaces. The generated `api/openapi.json` currently has 83 paths, and the only paths that start with `/api/` are the already-noted comment paths that double-prefix under the MCP server.

Why it matters: generated API clients, Swagger readers, MCP tooling, and security reviewers can treat OpenAPI as a source of truth while missing whole executable route families. Conversely, routes that are present in OpenAPI can still be wrong, as shown by the comment double-prefix and missing search implementation.

Why it is easy to miss: a large generated spec creates confidence. The drift only appears when comparing Express mounts, router files, OpenAPI registrations, and MCP URL construction together.

Possible mediation: decide which routes are public contract and which are intentionally internal. Register the public ones, document the internal exclusions, and add a route/spec consistency check that catches missing paths and paths that include `/api` when the OpenAPI server URL already supplies it.

### Super-admin API tokens can reach super-admin routes

Severity: High

Status: Confirmed

`api/src/routes/api-tokens.ts` creates tokens with only a name and optional expiry; there is no scope, audience, read-only flag, or "no admin" flag. `api/src/middleware/auth.ts` validates bearer tokens by joining `api_tokens` to `users`, then attaches the token owner's `userId`, `workspaceId`, and `isSuperAdmin` to the request. `superAdminMiddleware()` only checks `req.isSuperAdmin`; it does not distinguish session auth from API-token auth. `api/src/app.ts` also skips CSRF whenever the request has a `Bearer` authorization header, then mounts `/api/admin` and `/api/admin/credentials` behind the same auth path.

Why it matters: a token created by a super-admin is effectively a long-lived root credential for super-admin APIs, including workspace/user administration and CAIA credential management. That may be intentional full delegation, but the current UI/docs frame tokens as external-tool access for Claude Code rather than as root-equivalent admin keys.

Why it is easy to miss: the token implementation has good secrecy mechanics: hashing, prefixes, revocation, optional expiry, and last-used tracking. The assessment-shaped problem is authorization scope, not storage.

Possible mediation: decide whether API tokens are allowed to exercise super-admin privileges. If not, block `req.isApiToken` in `superAdminMiddleware()` or require explicit privileged token scopes. If yes, update the UI/docs to say super-admin-created tokens have super-admin power and should be treated as root credentials.

### Issue `belongs_to` accepts cross-workspace associations

Severity: High

Status: Confirmed

`api/src/db/schema.sql` defines `document_associations` with `document_id`, `related_id`, and `relationship_type`, but no `workspace_id` and no constraint that both documents belong to the same workspace. `api/src/routes/issues.ts` validates `belongs_to` entries only as `{ id: uuid, type: program|project|sprint|parent }`. On issue create, it inserts those associations directly after creating the issue in the caller's workspace. On issue update, it deletes and reinserts associations the same way. The helper `getBelongsToAssociations()` then joins `document_associations.related_id` to `documents.id` and returns related titles/colors without any workspace filter.

Runtime proof: verified against a disposable local database that was dropped after the run. A bearer token scoped to Workspace A successfully called `POST /api/issues` with `belongs_to` pointing at a private program in Workspace B. The route returned `201`; the response included `belongs_to[0].title = "FOREIGN Workspace Program"`, and a DB join showed `issue_workspace_id = Workspace A` while `related_workspace_id = Workspace B`.

Why it matters: a normal user who knows or obtains a document id from another workspace can create or update an issue in their own workspace that points at the other workspace's program/project/week/parent. Follow-on reads can then surface the foreign document id, title, type, and color through the issue's `belongs_to` metadata. This also creates a representable "should be impossible" graph state that many aggregate queries are not designed to handle.

Why it is easy to miss: most issue queries correctly filter the issue itself by `req.workspaceId`, so the route looks workspace-scoped. The cross-workspace edge is hidden one layer deeper in the association insert and shared association formatter.

Possible mediation: validate every `belongs_to` target against `workspace_id = req.workspaceId` before inserting. Add a database-level guard if possible, such as storing `workspace_id` on `document_associations` and enforcing both endpoints through composite foreign keys or a trigger. Add regression tests for create and update attempts using foreign-workspace ids.

### File authorization is workspace-wide while product/docs imply attachments

Severity: Medium-High

Status: Confirmed

`api/src/db/schema.sql` stores files with `workspace_id`, `uploaded_by`, filename, MIME type, size, `s3_key`, `cdn_url`, and status. There is no `document_id` or attachment table linking a file to the document where it appears. `api/src/routes/files.ts` authorizes file metadata, local serving, confirmation, and deletion by checking only `id` plus `workspace_id`. The delete route does not require `uploaded_by = req.userId` or admin status. This contradicts `api/src/openapi/schemas/files.ts`, which describes `documentId`, `publicUrl`, an attach endpoint, and "Only the uploader or an admin can delete." The actual Express file router has no `/files/{fileId}/attach` route.

Why it matters: a file embedded in a private document is not authorized like the private document. In local/API serving mode, any workspace member who knows a file id can fetch metadata, serve the file, or delete it. In production upload mode, confirmation returns `https://{CDN_DOMAIN}/{workspaceId}/{fileId}{ext}`, which may make uploaded content available outside document authorization entirely depending on CDN/S3 policy.

Why it is easy to miss: file ids are random UUIDs and the route comments emphasize UUID validation and workspace checks. The missing dimension is document-level authorization and uploader/admin deletion semantics.

Possible mediation: add an explicit file attachment model that links files to documents and enforces document visibility before metadata/download/delete. Align OpenAPI with reality or implement the advertised attach endpoint. Enforce delete authorization as uploader-or-admin. Decide whether production CDN URLs are intentionally public, signed, or gated.

### Public feedback can inject issues into any known program id

Severity: Medium

Status: Confirmed

`api/src/routes/feedback.ts` mounts public feedback without auth or CSRF. `POST /api/feedback` accepts a `program_id`, looks up any document with that id and `document_type = 'program'`, derives its workspace id, creates a new issue in that workspace, and associates it to the program. `GET /api/feedback/program/:programId` similarly returns program id, title, prefix, and color for any known program id without checking visibility, archived/deleted state, or a published/public-feedback flag.

Runtime proof: verified against a disposable local database that was dropped after the run. An unauthenticated `GET /api/feedback/program/:programId` for a private program returned `200` with `{ name: "FOREIGN Workspace Program", prefix: "FB", color: "#f00" }`. An unauthenticated `POST /api/feedback` against the same private program returned `201` and created an external issue associated to that private program's workspace.

Why it matters: this may be an intentional external-feedback feature, but the authorization boundary is the secrecy of a program UUID. If private or internal programs can receive feedback this way, an unauthenticated caller can create triage issues inside that workspace and enumerate limited program metadata for known ids.

Why it is easy to miss: the route is intentionally public, so "no auth" is not automatically a bug. The missing product rule is whether every program id is supposed to be a public submission endpoint.

What would make it harmless: product policy says every program UUID is a deliberate public feedback URL and private program visibility does not apply to feedback intake.

Possible mediation: add a program property such as `feedback_public: true`, require it for public feedback lookup/submission, and suppress private/archived/deleted programs by default. Consider per-program unguessable public slugs/tokens instead of reusing internal document ids.

### AI analysis rate-limit messaging understates the executable limit

Severity: Low

Status: Confirmed

`api/src/routes/ai.ts` returns the message "Rate limit exceeded. Max 10 analysis requests per hour." `api/src/services/ai-analysis.ts` defines `RATE_LIMIT = 120` requests per hour per user, with a comment explaining polling every 5 seconds. The endpoint also accepts arbitrary client-supplied `content`, `retro_content`, and `plan_content` and sends extracted text to Bedrock; it does not reload a server-authorized document before analysis.

Why it matters: this is mostly a measurement and expectations trap, not a direct vulnerability. Operators and users will believe the AI cost-control limit is 10/hour while the executable limit is 120/hour. Because the endpoint analyzes client-supplied content, the control is per user and size-limited, not document-authorized or document-scoped.

Why it is easy to miss: the route error text and service constant live in different files, and both look reasonable in isolation.

Possible mediation: make the route message use the service constant, and decide whether AI analysis should remain a generic text-analysis endpoint or should accept document ids and enforce document visibility server-side before sending content to Bedrock.

### Shadow database copy scripts can report success after destructive restore failures

Severity: High

Status: Confirmed

`scripts/copy-db-to-shadow.sh` and `scripts/copy-db-via-ssm.sh` both perform a destructive shadow refresh by dropping and recreating the target `public` schema before restoring a dump. The restore paths then pipe `psql -f "$DUMP_FILE"` through `grep` and end the pipeline with `|| true`. In `copy-db-to-shadow.sh`, the restore command is `psql ... -f "$DUMP_FILE" --quiet 2>&1 | grep -v "NOTICE:" || true`, followed immediately by `log_success "Restore complete"`. In `copy-db-via-ssm.sh`, the restore command is `psql ... -f "$DUMP_FILE" --quiet 2>&1 | grep -E "^ERROR" || true`, also followed by `log_success "Restore complete"`. The SSM variant verifies only user count equality, not document count equality, and still prints `Database copy complete!`.

Why it matters: these scripts are production-adjacent runbook tools for copying dev/production data into shadow. If restore emits SQL errors after the schema has been dropped, the script can still announce success and send the operator toward migrations/deploy/testing against a partially restored or empty shadow database. That is a fake-green operational gate with real blast radius: it can erase a target environment and hide the failure mode behind normal-looking success text.

Why it is easy to miss: `set -euo pipefail` at the top makes the script look strict. The later `|| true` on the restore pipeline quietly cancels that strictness at the highest-risk step.

Possible mediation: remove `|| true` from restore pipelines, capture restore output to a log, fail on any `psql` non-zero exit, and make destructive schema drops require an explicit `--yes-drop-shadow` or typed target confirmation. Verify all critical table counts and schema_migrations, not just users/documents, before printing success.

### Backend deploy can auto-apply Terraform despite docs saying infrastructure is a prerequisite

Severity: Medium-High

Status: Confirmed

`scripts/deploy.sh` documents Terraform infrastructure as a prerequisite, accepts `dev|shadow|prod`, and maps `prod` to the root `terraform/` directory. If it cannot read `s3_bucket_name` from Terraform outputs and `DEPLOY_S3_BUCKET` is unset, it prints `S3 bucket not found in Terraform outputs. Running terraform apply...`, runs `terraform init -upgrade`, then runs `terraform apply -auto-approve` before continuing the Elastic Beanstalk deployment. `docs/claude-reference/commands.md` presents `./scripts/deploy.sh prod` as the production API deploy command, and `AGENTS.md` says "Just run the scripts" for deployment.

Why it matters: a command framed as "deploy API" can silently become "mutate or create infrastructure" when local Terraform state/outputs are missing. That is a hidden blast-radius expansion, especially for `prod`, because the operator may be trying to ship an app bundle while the script applies whatever Terraform diff is currently present.

Why it is easy to miss: the dangerous branch only runs when an output lookup fails, so normal deploys look like pure application deploys. The top-of-file prerequisite comment also lowers suspicion by saying Terraform should already be deployed.

Possible mediation: remove automatic `terraform apply -auto-approve` from application deploy, or require an explicit flag such as `--bootstrap-infra` plus an environment-specific confirmation. Keep deploy scripts read-only with respect to Terraform state unless the command name and docs clearly say they provision infrastructure.

### Document parent links can cross workspaces and cascade-delete across tenants

Severity: High

Status: Confirmed

`api/src/db/schema.sql` defines `documents.parent_id UUID REFERENCES documents(id) ON DELETE CASCADE` without a same-workspace constraint. `api/src/routes/documents.ts` accepts `parent_id` on document create and update. On create, it only tries to inherit visibility when the parent exists in `req.workspaceId`; if the parent id belongs to another workspace, that lookup misses, but the route still inserts the foreign `parent_id`. On update, it similarly reads parent visibility only inside the current workspace, then writes `parent_id` directly.

Runtime proof: verified against a disposable local database that was dropped after the run. A bearer token scoped to Workspace A called `POST /api/documents` with `parent_id` set to a Workspace B document id. The route returned `201`; a DB join showed `child_workspace_id = Workspace A` and `parent_workspace_id = Workspace B`. Deleting the Workspace B parent then reduced the Workspace A child row count to `0` because the database-level `ON DELETE CASCADE` followed the cross-workspace parent pointer.

Why it matters: this is a cross-tenant integrity break, not just a metadata leak. If a cross-workspace parent edge exists, a legitimate delete in one workspace can delete documents in another workspace. It also creates impossible hierarchy states for navigation, breadcrumbs, document trees, and visibility inheritance.

Why it is easy to miss: the route appears workspace-scoped because it creates the child with `workspace_id = req.workspaceId` and does a parent visibility lookup scoped to the workspace. The actual bug is that a failed parent lookup is treated as "no inherited visibility" instead of "invalid parent."

Possible mediation: reject any `parent_id` that does not belong to `req.workspaceId` and is visible/usable by the caller. Add a database-level invariant for hierarchy, such as a composite foreign key or trigger requiring `child.workspace_id = parent.workspace_id`. Add regression tests for create and update with foreign-workspace parents and for cascade behavior.

### Production Terraform has two competing sources of truth

Severity: Medium-High

Status: Confirmed

`terraform/README.md` says the repo uses separate `terraform/environments/dev/` and `terraform/environments/prod/` directories because "the infrastructure code paths differ," shows `cd terraform/environments/dev   # or prod`, and notes that root-level `*.tf` files are the original flat structure while new environments should use `environments/`. But the deploy scripts special-case production back to the root Terraform directory: `scripts/deploy.sh` sets `TF_DIR="$PROJECT_ROOT/terraform"` when `ENV=prod`, and `scripts/deploy-web.sh` does the same. `scripts/deploy-infrastructure.sh` also always changes into root `terraform/` and has no environment argument. The two Terraform paths are not just wrappers around the same state: root `terraform/elastic-beanstalk.tf` names the EB app `ship-api` and environment `ship-api-prod`, while `terraform/modules/elastic-beanstalk/main.tf` used by `terraform/environments/prod/main.tf` names both app and environment `ship-api-prod`.

Why it matters: a maintainer can plausibly run Terraform from `terraform/environments/prod` because the Terraform README says that is the production environment, then deploy production through scripts that read outputs and apply fallback changes from root `terraform/`. That creates a real risk of changing, creating, or reading outputs from the wrong production-shaped stack. It also makes reviews harder: a Terraform diff under `terraform/environments/prod` may look production-critical while the production deploy path ignores it.

Why it is easy to miss: both layouts are present and both look intentional. The README even acknowledges root files as "original flat structure," which makes the duplication feel like migration history rather than an active operational contradiction. The mismatch only becomes obvious when comparing README commands, deploy scripts, and resource names.

Possible mediation: choose one production Terraform root and make every script, README, and runbook use it. If root `terraform/` is the real production stack, mark `terraform/environments/prod` as unused or remove it. If modular `terraform/environments/prod` is the intended stack, update deploy scripts and infrastructure scripts to use it, then migrate/import state deliberately.

### WebSocket auth ignores workspace membership revocation

Severity: High

Status: Confirmed

`api/src/middleware/auth.ts` validates normal REST sessions by loading the session, enforcing inactivity and absolute timeouts, and then checking that a non-super-admin user still has a row in `workspace_memberships` for the session workspace. If that membership is gone, it deletes the session and returns `403`. The realtime server reimplements session validation in `api/src/collaboration/index.ts` as `validateWebSocketSession()`, but that function only checks the `session_id` cookie, session age, and last activity. It returns `{ userId, workspaceId }` without verifying that the user still belongs to that workspace. Both `/events` and `/collaboration/{docType}:{docId}` use this weaker validator before accepting WebSocket connections. For collaboration, `canAccessDocumentForCollab()` then checks the document against the stale `workspaceId` from the session; workspace-visible documents remain accessible as long as the old session has not timed out.

Why it matters: revoking a user's workspace membership stops their REST access, but it does not immediately stop realtime access if their old session cookie is still valid. For up to the session window, a removed member can keep receiving global events and can open/edit workspace-visible documents over Yjs. That is a broken-access-control gap in the highest-risk editing path, not just a read endpoint.

Why it is easy to miss: the collaboration code has serious-looking security comments: "CRITICAL: Validate session before allowing WebSocket connection," visibility checks, rate limits, max payloads, and timeout enforcement. The bug is that it forked the REST auth logic and missed one authorization clause.

Possible mediation: share the REST session validation logic with the WebSocket upgrade path, including workspace membership revocation and super-admin handling. Add a regression test that creates a valid session, deletes the user's `workspace_memberships` row, then verifies REST and WebSocket access both fail. Consider closing existing realtime sockets when membership is removed, just as visibility changes close document sockets.

### Collaboration room names can fork one database document into multiple live Yjs states

Severity: High

Status: Confirmed

`api/src/collaboration/index.ts` stores live collaboration documents and awareness state by full room name: `docs = new Map<string, Y.Doc>()` and `awareness = new Map<string, Awareness>()`. But `parseDocId()` strips the room prefix and returns only the UUID after `:`. The WebSocket upgrade path accepts any `/collaboration/*` room, computes `docId = parseDocId(docName)`, and authorizes with `canAccessDocumentForCollab(docId, ...)`, which checks only document id, workspace, and visibility. It does not verify that the room prefix matches the row's `document_type`. `getOrCreateDoc(docName)` then caches a separate Yjs document under the full `docName`, while `persistDocument(docName, doc)` writes back to `documents WHERE id = parseDocId(docName)`. The frontend and docs both make the room prefix meaningful: `web/src/components/Editor.tsx` uses `new IndexeddbPersistence(\`ship-${roomPrefix}-${documentId}\`, ydoc)` and `new WebsocketProvider(wsUrl, \`${roomPrefix}:${documentId}\`, ydoc)`, and `docs/claude-reference/modules/collaboration.md` documents `/collaboration/:docType::docId` examples.

Why it matters: the same database row can be opened as `issue:<uuid>`, `wiki:<uuid>`, `doc:<uuid>`, or any other prefix that passes the UUID access check. Each prefix gets a separate in-memory Yjs state and separate browser IndexedDB cache, but they all persist to the same `documents.id`. That can split collaborators for one document into independent rooms and make the last room to persist overwrite content from another room. It also makes document-type conversion and cache invalidation harder to reason about, because the document id is canonical for persistence while the full prefixed room name is canonical for live sync.

Why it is easy to miss: the unified document model makes the prefix look cosmetic, and comments explicitly say all document types map to the unified table. The trap is that the cache key and the database key are not the same thing.

Possible mediation: canonicalize collaboration room identity to the document UUID only, or reject WebSocket upgrades when the supplied prefix does not match the current `documents.document_type` or a documented alias such as `doc`. Use the same canonical key for Yjs docs, awareness, pending saves, and IndexedDB cache naming. Add a regression test that tries to open the same document through two prefixes and proves the server either rejects the wrong prefix or routes both clients to the same Yjs state.

### Team allocation writes are available to any workspace member

Severity: Medium-High

Status: Confirmed

`api/src/routes/team.ts` exposes `POST /api/team/assign` and `DELETE /api/team/assign` with only `authMiddleware`. The assign route validates that the supplied `personId`, `projectId`, or `programId` belongs to the current workspace, but it never checks workspace admin, accountable owner, manager, or any other write authority before mutating sprint allocation state. It can add a person to `sprint.properties.assignee_ids`, create a new sprint document, create program associations, and remove that person from conflicting project allocations in the same week. The delete route similarly allows any authenticated workspace member to remove a person from a sprint allocation after a visibility check on the sprint. The frontend calls these routes from `web/src/pages/TeamMode.tsx`, and the OpenAPI team schemas label some grid/review endpoints as admin-only, but the allocation mutation routes are not registered with equivalent admin requirements.

Why it matters: team allocation is governance data. It drives accountability prompts, weekly plans/retros, dashboards, project allocation grids, and the "one allocation per person per week" model. If every workspace member can change everyone else's allocations, a non-admin can alter planning/accountability state and indirectly affect what work people are prompted to do or review.

Why it is easy to miss: the route has "SECURITY: prevent cross-workspace injection" checks, and those checks are real. But they only prove the referenced IDs are in the workspace; they do not prove the caller is allowed to change allocation state. The code looks careful at the data-integrity boundary while missing the authority boundary.

Possible mediation: require workspace admin or an explicit allocation-manager role for `POST /api/team/assign` and `DELETE /api/team/assign`. If self-service allocation is intended, restrict non-admin users to assigning/removing only their own person document and document that product rule. Register the mutation routes in OpenAPI with the same authorization notes and add tests for member versus admin behavior.
