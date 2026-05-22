# Memory

High-signal only. Record recurring patterns, architectural decisions, persistent gotchas, team preferences, and cross-session learnings that prevent repeated mistakes or speed up future work. Prune ruthlessly.

Never log: one-off debugging steps, transient session notes, low-confidence observations, or anything that belongs in git history, issues, or chat.

## Product And System Invariants

Things that should stay true across features, refactors, and fixes.

- Durable choices from audit/improvement work belong in `my-docs/DECISION_LOG.md`; keep `MEMORY.md` to short rules and traps, and use the decision log when a choice needs rationale, alternatives, consequences, and evidence.
- Type-safety work should prioritize runtime boundary typing: API route request/query parsing, PostgreSQL row-to-domain mappers, and document `properties` narrowing.
- Week document properties are canonically only `sprint_number` and `owner_id`; route code may still read/write legacy plan/review fields, but type aliases should not present those fields as the source-of-truth week model.

## Counterfeit Progress

Work that looks helpful but does not actually improve the system.

- Superficial `any` -> `unknown` changes without meaningful narrowing do not count as real type-safety improvement.
- Repeated local aliases that rename product concepts are a drift source, not harmless duplication. Keep SQL projection row types local, but derive durable document property/domain types from `@ship/shared`.
- Discovery reconciliation needs explicit status hygiene: resolved audit leads can stay as baseline history, but they should be marked resolved/retired and removed from active provisional candidate lists so future passes do not rediscover already-fixed work.

## Local Reality Checks

Repo-specific facts that prevent wrong assumptions.

- Historical lint note: before the ESLint type-safety remediation, root `pnpm lint` was a no-op placeholder. Current root `pnpm lint` runs `eslint .`, so do not reuse older audit notes as current gate evidence.
- Week 4 runtime audit measurements require source-of-truth-scale data: 500+ documents, 100+ issues, 20+ users, and 10+ sprints. In the May 2026 audit checkout, normal `pnpm db:seed` created 257 docs and 11 users, so `pnpm perf:seed-audit-load` now tops up tagged issue documents, person docs, memberships, sprint docs, and audit logs under `audit_load_tag`; remeasure seed scale before assuming those counts still hold.
- The security-audit source brief is a separate Category 8 track: it requires a runnable probe across auth/session, WebSocket validation, input sanitization, dependency CVEs, plus manual CORS/CSP/secrets/rate-limit/error review and at least two verified vulnerability fixes. Do not treat security findings as completed by the seven-category ShipShape improvement ledger.
- `ship_test_audit` is a sidecar local database for destructive API test/coverage benchmarking only. Use `DATABASE_URL=postgresql://ship:ship_dev_password@localhost:5432/ship_test_audit pnpm --filter @ship/api exec vitest run` or the same command with `--coverage` for Category 5 reruns; use `ship_dev` for browser/runtime/performance categories.
- If local API tests cannot reach PostgreSQL on 5432, check the local PostgreSQL service before treating the API suite as blocked. Docker is required for E2E/Testcontainers flows, not for normal API Vitest database access. For verification-only reruns, a fresh disposable database is safer than relying on stale `ship_test_audit` migration bookkeeping.
- Issues are discoverable through Programs: each program document has an Issues tab. The global `/issues` route exists too, but audits should not assume it is the only or primary path.
- Local PostgreSQL does not have `pg_stat_statements` enabled, so query-efficiency baselines use the temporary in-process query-count harness plus targeted `EXPLAIN (ANALYZE, BUFFERS)` through the locally installed `psql` binary.
- Document search has two deliberate contracts: `/api/search/documents` remains title-only metadata search for command-palette lookup, while `/api/search/content` is server-backed full-content search for `/docs`. Do not broaden the command-palette endpoint into content search by implication.
- The document content search index is derived/rebuildable state in `document_search_index`; `documents.content`, selected `documents.properties`, and collaboration Yjs state remain source of truth. Keep visibility filtering in SQL before `LIMIT`, keep archived/deleted documents excluded, and use `pnpm --filter @ship/api search:reindex` for backfill/repair instead of rebuilding inside search requests.
- Use `getAuthenticatedRouteContext(req)` in newly touched authenticated API routes instead of adding more `req.userId!` / `req.workspaceId!` assertions.
- OpenAPI registration paths are mounted under `/api` by the app; schema files should register paths without an extra `/api` prefix.
- OpenAPI is now the chosen generated frontend API type source: run `pnpm openapi:generate` to refresh `web/src/api/generated/ship-openapi.d.ts`, use `web/src/api/client.ts` for covered authenticated endpoints, and keep legacy `apiGet`/`apiPost` only for uncovered/raw paths.
- `pnpm openapi:check:strict` is enforced in Husky pre-commit; `pnpm openapi:check` remains the report-only alias. After grid v1/v2 removal + scanner fix (2026-05-21), coverage is **193** runtime routes / **193** OpenAPI operations (0 missing, 0 stale). See `docs/openapi-contract.md`.
- Typed OpenAPI client behavior must preserve legacy API helper semantics when endpoints migrate, especially CSRF retry, session-expiration redirects, JSON/HTML guards, and logout cache clearing.
- Runtime response validation is test-time via `expectOpenApiResponse` on auth, setup, workspaces, files, feedback, and bootstrap families; production middleware (`OPENAPI_VALIDATE_RESPONSES`) remains deferred.
- `defineRoute` (`api/src/openapi/define-route.ts`) pilots on setup routes; new routes should migrate to it over duplicate `registerPath` + handler Zod. `defineRoute` validation failures must return `{ success: false, error: { code, message } }` (same as other routes).
- OpenAPI path parity does not guarantee response fidelity — align schemas to handler JSON on families you migrate to `apiClient` or `expectOpenApiResponse`. Shared envelopes: `ApiErrorResponseSchema`, `SuccessResponseSchema` in `openapi/schemas/common.ts`.
- Use `pgResult()` for row-returning mocked PostgreSQL results and `pgCommand()` for no-row command results in API tests, especially update/delete paths that drive `204` responses.
- Treat unused-variable cleanup in tests as risky when the removed symbol fed an assertion. Preserve or strengthen the assertion, not just the lint count.
- Always surface 10x options explicitly in any planning or tradeoff context, not only API/frontend boundaries. For this codebase, current 10x follow-ups include route/spec coverage enforcement and runtime response validation after generated OpenAPI typing.
- Hook tests that exercise state-changing requests through `apiPost` must mock the CSRF preflight JSON response before the actual request response.
- Regular authenticated HTTP requests persist `last_activity` at 60-second granularity to avoid page-load write amplification; `/api/auth/extend-session` still writes immediately.
- Code simplification orchestration (2026-05-21): master plan in `my-docs/code-simplification-orchestration-plan.md`. Phase 1 targets `route-http.ts`, `config/runtime.ts`, dead accountability-grid v1/v2 removal, and unified `extractPlanItems`. Defer `weeks.ts` and `App.tsx` file splits until approval/access/repository modules land — large splits without category metrics are counterfeit GFA progress.
- Session cookie SameSite for Render lives in `api/src/config/session-cookies.ts` (`sessionCookieOptions`, `sessionSameSitePolicy`); do not re-inline `ENVIRONMENT === 'render'` in routes.
- Plan bullet extraction: use `extractPlanItemsFromContent` from `@ship/shared` (rebuild shared after edits). Dashboard uses `{ includeParagraphs: false, withChecked: true }`. Accountability grid: only `/api/team/accountability-grid-v3` remains; v1/v2 removed 2026-05-21.
- Route HTTP helpers live in `api/src/utils/route-http.ts` (`sendValidationError`, `sendInternalError`); bootstrap may pass structured 500 body as 4th arg.
- Sprint/week routes live under `api/src/routes/weeks/` (`index.ts` mounts sprints, my-week, standups, reviews, approvals). Shared sprint helpers: `weeks/shared.ts`. Top-level import stays `./routes/weeks.js`.
- Issue detail reads: `getIssueDetailById` / `getIssueDetailByTicketNumber` in `documents-repository.ts`; use `getActor(req)` for access context on new issue handlers.
- `defineRoute` pilots: `setup.ts`, `standups.ts`, `feedback.ts` (protected routes). Regenerate OpenAPI after path/schema changes.
- App shell split: `useAppMode.ts`, `components/app/AppHeader.tsx`, `components/app/AppSidebar.tsx`; `App.tsx` composes only.
- Deployment helpers: `api/src/config/runtime.ts` (`isProduction`, `isTestEnv`, `isDevEnv`, `isRenderProduction`, `useS3Uploads`, `databaseSslOptions`).
- Route HTTP helpers are the default for 500/validation envelopes in major API routes: use `sendValidationError`, `sendInternalError(res, err, 'context')`, and `sendLegacyError` for `{ error: string }` 4xx/404 when touching handlers. Transaction rollbacks before `sendInternalError` stay in the route (`ROLLBACK` then `sendInternalError`).
- Express routers: `const router = Router()` in route modules; use `import { type Router as ExpressRouter }` only for **named exports** (`searchRouter`, `filesRouter`, etc.). Do not reintroduce per-file `RouterType = ReturnType<typeof Router>`.
- `simplify-1` verification (2026-05-21): automated gates green (type-check, OpenAPI strict 193/193, API routes 313/313). Known follow-ups: prod `databaseSslOptions()` TLS verify policy; tests for standalone standups + `GET /feedback/:id`; `asApprovalRecord` runtime guard; OpenAPI 400 schema vs `defineRoute` param validation envelope on standups/feedback.

## Leverage Points

Places where a small, focused change creates outsized value.

- Bundle work should target initial-load JavaScript, especially the large `assets/index-*.js` entry chunk. Prefer lazy-loading route pages, emoji picker, editor/collaboration, and highlighting over chasing the existing many tiny chunks.
- Test-quality work should optimize for trust and risk, not raw test count: green failing web tests, guard API tests against non-disposable databases, then add focused regression tests for workspace isolation and document association behavior.
- E2E optimization source of truth lives in `docs/claude-reference/testing.md`; `e2e/AGENTS.md` owns test-writing flake patterns, and the Vite memory explosion doc is incident history only. Use `pnpm test:e2e:run`, preserve `vite preview`, tune `PLAYWRIGHT_WORKERS`, set `E2E_RESULTS_DIR` for concurrent lanes/shards, and use Playwright's exit code plus `${E2E_RESULTS_DIR:-test-results}/playwright/.last-run.json` for final status because `summary.json` is progress-only.
- Raw `pnpm test:e2e` is intentionally a guarded failure that points to `pnpm test:e2e:run`; the raw Playwright script is `pnpm test:e2e:raw` and should only be called by `scripts/run-e2e.sh`.
- First full post-lane E2E baseline on 2026-05-20: `E2E_RESULTS_DIR=test-results/full-run pnpm test:e2e:run` finished in 6.6 minutes with 862 passed, 1 failed, 6 flaky. The hard accessibility tree auto-expand failure was a stale selector against the newer ARIA `group` tree shape; closeout verification later passed the focused selector proof with `E2E_RESULTS_DIR=test-results/a11y-tree-closeout pnpm test:e2e:run e2e/accessibility-remediation.spec.ts -g "navigating to nested document auto-expands tree ancestors"`.
- `/api/bootstrap` is a read-only app-shell hydration endpoint that seeds existing TanStack Query keys. It must preserve the same visibility and projection semantics as the underlying list endpoints; if those routes change, bootstrap is a contract-drift candidate.
- `pnpm benchmark:api` runs the reproducible API benchmark harness and writes JSON under `test-results/benchmarks/`; do not claim Category 3 or 4 improvements until before/after output is captured under identical data, concurrency, and hardware conditions.
- `pnpm evidence:run -- --phase <phase> --run-id <id>` writes claim-aware submission artifacts under `my-docs/evidence-runs/<id>/`; use `pnpm evidence:compare <before-id> <after-id>` for comparisons. Claims must remain `not_measured` until the underlying evidence exists. Self-comparisons are rejected because they create false confidence.
- Performance/query measurement rails now exist: `pnpm perf:seed-audit-load`, `pnpm perf:query-count-api`, and `pnpm perf:explain`. The seed rail is workspace-scoped and defaults to 1000 issue documents, 10000 audit logs, 20 users, and 10 sprints. Use `ship_dev` for those runtime/perf captures and `ship_test_audit` for destructive API tests.
- Closeout perf rail artifacts on 2026-05-20: `test-results/perf/query-count-api-2026-05-20T23-37-27-346Z.json` and `test-results/perf/explain-performance-2026-05-20T23-37-37-930Z.json`. These are current-condition measurements, not before/after Category 3 or 4 completion evidence.
- `pnpm perf:query-count-api` now includes flow evidence. The 2026-05-21 `ship_dev` run measured old protected docs startup fanout at 7 requests / 33 queries / 984,044 bytes and current `/api/bootstrap` at 1 request / 24 queries / 984,123 bytes, so bootstrap proves the Category 4 query-count branch for that app-shell flow but not a payload-byte win.
- Category 3 payload projection evidence on 2026-05-21: valid before benchmark `test-results/benchmarks/api-2026-05-21T02-40-19-503Z.json`; final after benchmark `test-results/benchmarks/api-2026-05-21T03-11-53-590Z.json`. `GET /api/issues` P95 improved by 30.0% at 10c and 26.7% at 25c, but regressed at 50c; `/api/bootstrap` payload shrank materially but P95 remained mixed, so do not mark Category 3 fully closed yet.
- Issue list and bootstrap issue payloads are metadata projections, not editor-document projections. Keep TipTap `content` on issue detail endpoints, but keep list/bootstrap issue rows free of `content` and omit null/default-heavy optional fields when the UI treats absence the same as null.
- Category 6 runtime evidence should use `E2E_RESULTS_DIR=test-results/category-6-runtime-evidence PLAYWRIGHT_WORKERS=1 pnpm test:e2e:run e2e/error-handling.spec.ts` so the named Playwright screenshots land in an isolated artifact directory. Docker must be running because the fixture starts Testcontainers PostgreSQL.
- `schema.sql` already includes several later-era structures, so numbered migrations that add those same structures must be idempotent. Recent examples: `010_oauth_state.sql`, `025_prevent_circular_parent.sql`, `033_sprint_to_week_rename.sql`, and `035_add_comments.sql`.
- Keep the API test DB guard in place: destructive setup should only truncate disposable databases such as `ship_test_audit`, with explicit override required for anything else.
- Inline comment cancellation must remove the exact `commentMark` instance by `commentId`; clearing UI state or removing all marks of the type can leave stale highlights or break overlapping comments.
- Backlinks are intentionally degraded offline: preserve the last successful backlinks, show an accessible stale/offline status, pause polling while offline, and retry on reconnect. Do not reintroduce repeated console-only fetch spam.
- `pnpm a11y:closeout -- --fail-on-serious` is the Category 7 blocking gate for `/docs`, the first `/documents/:id`, and `/my-week`, writing `test-results/a11y-closeout/axe-summary.json` plus screenshots. As of 2026-05-21, it passes with 0 violations on all three scanned pages after fixing BacklinksPanel badge contrast, My Week current-day label contrast, and future-row inherited opacity.
- Manual closeout on 2026-05-20 proved Backlinks behavior: a created mention from Architecture Guide to the Cat6 XSS-title doc appeared as a backlink; offline mode preserved that saved backlink and showed `Offline. Showing saved backlinks.`; returning online cleared the stale status; clicking the backlink navigated correctly. Console noise during offline was collaboration WebSocket reconnect spam, not repeated BacklinksPanel fetch spam.
- Manual closeout found two accessibility polish gaps that should be automated or fixed next: the Action Items modal traps focus and Escape closes it, but the close button is skipped/invisible in tab order and two row focus stops are not visibly obvious; the docs tree has visible focus and Enter expand/collapse, but arrow-key tree navigation does not work.
- Radix dialog warnings can be caused by overriding `Dialog.Title` / `Dialog.Description` ids instead of letting Radix wire generated ids. The session-timeout modal fix removed manual `aria-labelledby`/`aria-describedby` overrides and added `SessionTimeoutModal.test.tsx` to catch missing `DialogContent` title/description warnings.
- Improvement reports should keep second-pass result placeholders separate from verified evidence. If implementation or measurement has not run, write `TBD` rather than extrapolating from the discovery proof.
- Dependency cleanup trap from 2026-05-21: `pnpm audit` can be cleared without framework-major jumps by staying on current lines and adding documented pnpm overrides for patched transitives. Current override set: `flatted@3.4.2`, `markdown-it@14.1.1`, `qs@6.15.2`, `yaml@2.9.0`, plus scoped `picomatch` overrides. Do not use one global `picomatch@4` override: chokidar-era consumers still need `picomatch@2.3.2`, while Vite/Vitest/tinyglobby paths can use 4.0.4. Revisit/remove these when parent packages naturally resolve safe versions.
- Dependency cleanup is security/evidence hygiene, not completion of the Week 4 seven-category product outcomes by itself. It can support the source-of-truth work, but do not count it as a category win unless tied to a measured source requirement.
- Keep `jsdom` on the Node-compatible line unless the repo intentionally raises its Node floor. `jsdom@29` requires a newer practical Node baseline than the current `>=20.0.0` declaration, so this branch keeps `jsdom@27.4.0` and pins root `@types/node` to the Node 22 line.
- E2E dependency-gate reality from 2026-05-21: the full suite is not clean on `master` for the failing spec group. For dependency branches, use smoke plus targeted dependency-sensitive specs as the immediate pass/fail signal, then compare any full-suite failures against clean master before labeling them regressions.
- Architecture follow-up collab gate (2026-05-21): `E2E_RESULTS_DIR=test-results/arch-followup-collab PLAYWRIGHT_WORKERS=1 pnpm test:e2e:run e2e/document-isolation.spec.ts e2e/content-caching.spec.ts` — 7/7 pass with Docker. Use `login` from `e2e/fixtures/app.ts`; `authenticatedPage` fixture available for new specs.
- `useCollabSession` (`web/src/hooks/useCollabSession.ts`) owns IndexedDB + WebSocket + shared `COLLAB_*` protocol; `Editor.tsx` must not reintroduce transport logic or magic close codes.
- `getOrCreateDoc` uses `resolveInitialContent` from `document-content-codec.ts`; extend codec tests when changing load behavior.
- `listIssuesMetadata` in `documents-repository.ts` is the SQL home for `GET /api/issues` list projection; `updateDocumentContent` for PATCH content.
- `fetchIssues` in `useIssuesQuery` uses typed `apiClient.GET('/issues')` — pilot only; other hooks may still be on legacy helpers even though OpenAPI route coverage now exists.
- Category 3/4 rerun after architecture follow-up: start API (`pnpm dev:api` or deploy), then `pnpm benchmark:api` and `pnpm perf:query-count-api` on `ship_dev`. `pnpm benchmark:api` defaults to `http://localhost:3000`; set `API_BASE_URL` when dev chooses another API port.
- Architecture follow-up **verification** (2026-05-21): multi-agent audit found and fixed empty-doc collab regression, server `COLLAB_*` drift, hook callback-deps teardown, WS listener leak, and weak F2d tests. Re-gates: API **489**, web **165**, collab E2E **7/7** (`test-results/arch-verify-collab/`). Do not count `useCollabSession.test` as a GFA Cat 5 “meaningful test” until it exercises behavior (now 7 mocked tests do).
- GFA category mapping trap: architecture deepening **supports** Cat 5/6 (collab protocol, E2E isolation) but does **not** satisfy Cat 1 (25% type-safety reduction) or full Cat 6 (error-handling gaps + screenshot) by itself.

## Sharp Edges

Known traps, fragile paths, or easy ways to break things.

- Architecture deepening pass (2026-05-21): collaboration WebSocket rooms are canonicalized server-side to `{document_type}:{uuid}` so `issue:` / `wiki:` prefixes cannot fork one DB row into separate Yjs states. Client `roomPrefix` should match `document_type` (legacy `doc:` accepted only for wiki).
- Association writes for issues/projects should go through `syncBelongsToAssociations`, `syncProgramAssociation`, or `syncAssociationOfTypeForDocuments` in `api/src/utils/document-crud.ts`, not inline DELETE/INSERT in routes.
- Document references must be actor-authorized before mutation, not merely workspace-matched. For `parent_id`, `program_id`, `sprint_id`, and `belongs_to`, validate readability/referenceability first so inaccessible references cannot be silently ignored or used to erase existing associations.
- Relationship DB guardrails are intentionally hybrid: actor-specific visibility lives in `document-access.ts`, while migrations 039/040 block structural impossibilities such as cross-workspace, deleted, or wrong-type relationships and clean them on unsafe document mutations.
- Plan/hypothesis extraction is canonical in `@ship/shared` (`content-extract.ts`); API re-exports via `api/src/utils/extractHypothesis.ts`; web Editor imports shared extractors directly.
- E2E shared entrypoints: `e2e/fixtures/app.ts` (`login`, `createWikiDoc`, `setDocumentTitle`) — prefer over per-spec copies.

## User And Team Preferences

Stable human preferences that should shape future work.

- Update `MEMORY.md` when a durable preference, recurring project pattern, or cross-session learning is useful.

## External Constraints

Limits imposed by tools, infrastructure, policy, vendors, or environments.

_None yet._

## Retired Beliefs

Old assumptions that were proven wrong and should not come back.

_None yet._
