# Decision Log

Durable choices made during the audit/improvement work. This file exists so we can defend why structural decisions were made, what they do not claim, and what future work must preserve.

## 2026-05-21: Architecture Deepening Pass

### D020: Canonical Collaboration Room Names

Status: Accepted

Decision: On WebSocket upgrade, resolve `document_type` from the database and use `buildCollaborationRoomName(document_type, documentId)` as the sole in-memory room key. Log and ignore client room prefixes that do not match `document_type` (legacy `doc:` prefix still allowed for wiki only via `roomPrefixMatchesDocumentType`).

Why: Discovery 2 showed `issue:` and `wiki:` rooms for the same UUID persisted different Yjs states into one row. Canonical rooms prevent forked realtime state.

Alternatives considered: Reject mismatched prefixes with 403 (stricter, breaks old clients); client-only fix (insufficient). Server canonicalization fixes persistence without requiring every client to update simultaneously.

Consequences: Protocol constants live in `shared/src/collab-protocol.ts`. Future Editor/collab changes must not reintroduce ad-hoc close codes or message types in only one tier.

Evidence: `api/src/collaboration/index.ts` upgrade path uses `getDocumentTypeById` and `buildCollaborationRoomName`.

**Decision Gist**: One Yjs room per document row — always `{document_type}:{uuid}` on the server.

### D021: Shared Content Extractors And Mention IDs

Status: Accepted

Decision: Move TipTap JSON extractors (`extractHypothesisFromContent`, section extractors, `checkDocumentCompleteness`) and `extractDocumentMentionIds` into `@ship/shared`. API keeps a thin re-export file for existing import paths.

Why: Client and server duplicated plan extraction with different whitespace rules; mention ID extraction was only tested via E2E.

Alternatives considered: API-only module imported by web (violates monorepo boundary); duplicate logic with sync tests. Shared package is the existing cross-tier contract home.

Consequences: Web `Editor.tsx` must import from `@ship/shared`, not maintain parallel extractors. New content-shape rules belong in `shared/src/content-extract.ts` first.

Evidence: `api/src/__tests__/shared-content-boundary.test.ts`; `api/src/routes/backlinks.test.ts` editor-boundary test using `extractDocumentMentionIds` → POST links → GET backlinks.

**Decision Gist**: TipTap content semantics are defined once in `@ship/shared` and consumed by API and web.

### D022: Unified Association Write Helpers

Status: Accepted

Decision: Route association mutations through `syncBelongsToAssociations`, `syncProgramAssociation`, `syncAssociationOfType`, and `syncAssociationOfTypeForDocuments` in `document-crud.ts`. Migrate issues create/PATCH and projects program_id paths off inline SQL.

Why: Four mutation styles for one junction table created regression risk (`associations-regression.test.ts`).

Alternatives considered: New `AssociationSyncService` class (more abstraction than needed); REST-only associations router. Helper functions match existing `document-crud` style.

Consequences: New association side effects (carryover, broadcasts) should wrap helpers inside transactions, not reintroduce inline DELETE/INSERT.

Evidence: `api/src/routes/issues.ts`, `api/src/routes/projects.ts` migrations; existing regression suite still applies.

**Decision Gist**: `document_associations` writes go through `document-crud` helpers, not per-route SQL copies.

### D023: Document View Types And E2E App Fixtures

Status: Accepted

Decision: Add `shared/src/document-view.ts` for web editor/sidebar view types; wire `UnifiedEditor` and partial `PropertiesPanel` imports. Add `e2e/fixtures/app.ts` for shared login and wiki document creation. Harden `e2e/check-aria.spec.ts` to fail when seed tree lacks expandable nodes.

Why: Parallel TS unions drifted from `@ship/shared`; E2E duplicated setup and `check-aria` silently skipped.

Alternatives considered: OpenAPI-only web types (coverage incomplete); monolithic isolated-env refactor (deferred).

Consequences: Panel-only fields remain local extensions on shared views. More specs should migrate to `app.ts` fixtures over time.

Evidence: `pnpm type-check` passes; `e2e/fixtures/app.ts`; backlinks/mentions/check-aria imports.

**Decision Gist**: Durable web document shapes and E2E auth/doc helpers live in shared modules, not per-file copies.

### D024: Document Repository And Content Codec Slices

Status: Accepted

Decision: Add narrow modules `api/src/db/documents-repository.ts` (read/update helpers, `getDocumentTypeById`) and `api/src/db/document-content-codec.ts` (Yjs ↔ JSON encode/decode/`resolveInitialContent`) without rewriting god routes in this pass.

Why: eelon-scope: full repository for all routes is churn-heavy; slices establish seams for Category 3/4 work later.

Alternatives considered: Full `weeks.ts` extraction (deferred); inline SQL forever (blocks measurement). Slice is the leverage point.

Consequences: Collab upgrade and future perf work should call repository/codec helpers instead of growing `collaboration/index.ts` further. Category 3/4 claims remain `TBD` until benchmarks rerun.

Evidence: `api/src/db/__tests__/document-content-codec.test.ts` round-trip tests.

**Decision Gist**: SQL and Yjs conversion get named boundaries; route files shrink incrementally, not in one rewrite.

## 2026-05-21: Architecture Follow-up Pass

### D025: useCollabSession Owns Transport Only

Status: Accepted

Decision: Extract IndexedDB gate, WebSocket provider lifecycle, awareness dedupe, and shared-protocol message/close handling into `web/src/hooks/useCollabSession.ts`. `Editor.tsx` keeps TipTap/extensions; the hook returns `{ syncStatus, connectedUsers, provider, roomName }` and uses `buildCollaborationRoomName(documentType ?? roomPrefix, documentId)` with `COLLAB_*` from `@ship/shared`.

Why: ~220 lines of collab logic in `Editor.tsx` duplicated protocol literals and blocked E2E confidence in room naming.

Alternatives considered: React Query collab cache (overkill); class-based `CollabSession` (more surface than needed). Hook matches existing hooks folder.

Consequences: Any new collab client behavior belongs in the hook + shared protocol, not inline in `Editor.tsx`.

Evidence: `useCollabSession.test.ts` (7 mocked behavioral tests after verify pass); collab E2E 7/7 in `test-results/arch-followup-collab/` and `arch-verify-collab/`. Verify pass: ref-stable callbacks, WS `message` listener cleanup.

**Decision Gist**: Editor renders; `useCollabSession` transports Yjs with shared protocol constants.

### D026: getOrCreateDoc Uses DocumentContentCodec

Status: Accepted

Decision: `api/src/collaboration/index.ts` `getOrCreateDoc` loads initial state via `resolveInitialContent` from `document-content-codec.ts` instead of inline JSON/Yjs branches. `parseTipTapContent` in the codec handles JSON strings and skips XML-like legacy strings.

Why: D024 created the codec but left duplicated load logic in collab; drift risk on API-created docs.

Alternatives considered: Delete codec and keep inline (rejects D024); full repository load path (deferred). Codec call preserves logging and `freshFromJsonDocs`.

Consequences: New collab load rules must extend `resolveInitialContent` / codec tests first.

Evidence: `document-content-codec.test.ts` (+ string/XML, corrupt yjs fallback, empty `content: []`); `src/collaboration` vitest suite pass. Verify pass fixed `getOrCreateDoc` to accept empty doc arrays (not only `content.length > 0`).

**Decision Gist**: Server collab bootstrapping shares one content-resolution function with tests.

### D027: Repository Slice — Issues List And PATCH Content

Status: Accepted

Decision: Expand `documents-repository.ts` with `listIssuesMetadata` (D015 projection SQL) and wire `GET /api/issues` list + `PATCH /api/documents/:id/content` to repository helpers. Explicitly exclude `weeks.ts` / `team.ts` in this pass.

Why: eelon-scope: one list query block + one content UPDATE is high leverage without god-route rewrite.

Alternatives considered: Full issues route extraction (churn); leave SQL inline (blocks Cat 4 measurement). Relocation only — no response shape change.

Consequences: Further issues/documents SQL should move into the repository before new filters or projections.

Evidence: `issues.ts` calls `listIssuesMetadata`; `documents.ts` calls `updateDocumentContent`; type-check pass.

**Decision Gist**: List and content-update SQL live in `documents-repository`, not scattered copies.

### D028: OpenAPI Pilot On GET /issues List

Status: Accepted

Decision: Migrate `useIssuesQuery` `fetchIssues` to typed `apiClient.GET('/issues')` because `/issues` is registered and not stale. At the time, defer other hooks until their route families are covered.

Why: D018 requires family-by-family migration; `GET /issues` is the safest covered read.

Alternatives considered: Broad hook migration (false confidence with 82 missing routes); stay on `apiGet` forever. Pilot proves the pattern.

Consequences: Next OpenAPI migrations should follow the same gate: `pnpm openapi:check` per family, then `apiClient`, then optional `expectOpenApiResponse`. Later D021 completed full route parity.

Evidence: `web/src/hooks/useIssuesQuery.ts`; `pnpm openapi:check` 2026-05-21 initially reported 82 missing and 8 stale operations before the later D021 contract-completion pass.

**Decision Gist**: One covered list endpoint uses the generated client; the rest wait for contract honesty.

## 2026-05-21: Medium-Risk Dependency Cleanup Pass

### D018: Dependency Cleanup Stays Inside Current Framework Lines

Status: Accepted

Decision: Take only medium/low-risk dependency upgrades that preserve the current framework lines: React 18, TipTap 2, Zod 3, Tailwind 3, TypeScript 5, Vite 6, `@vitejs/plugin-react` 4, `y-websocket` 2, `jsdom` 27, Node 20+ as declared, and direct Express 4 runtime. Accept Testcontainers 12 and Playwright 1.60 as dev/test platform upgrades because the repo wrapper and targeted E2E checks passed.

Why: The dependency audit had real security value, especially Vite/Rollup, Testcontainers transitives, SVGO, `uuid`, Express transitives, and YAML/Markdown parsing transitives. Crossing product framework majors at the same time would mix supply-chain cleanup with source migration risk.

Alternatives considered: Jump to Vite 8/React 19/Tailwind 4/TipTap 3/Zod 4 together; only document audit risk without changing packages; rely solely on `pnpm audit` recommendations. The first option is too many migrations in one branch. The second leaves known patched vulnerabilities in place. The third would push unsafe majors such as Express 5 or Zod 4 without project-specific compatibility checks.

Consequences: `pnpm.overrides` now pins patched transitive versions for `flatted`, `markdown-it`, `qs`, and `yaml`, plus scoped `picomatch` overrides. The `picomatch` override must stay scoped: legacy chokidar consumers still need the 2.x line, while Vite/Vitest/tinyglobby paths can use 4.x. Root `@types/node` is pinned to the Node 22 type line to avoid accidental Node 25 type drift. `jsdom` intentionally stays on 27.4.0 because 29.x would silently raise the effective Node floor. These overrides should be reviewed during future parent-package upgrades and removed when no longer needed. `@modelcontextprotocol/sdk` still brings Express 5 transitively, but the app's direct API runtime remains Express 4.22.2.

Evidence: `pnpm audit --prod --audit-level low` and `pnpm audit --audit-level low` both reported 0 advisories after the corrected pass. Static/build/unit/OpenAPI checks passed. E2E smoke, icons, and isolated Testcontainers checks passed. Full E2E remained non-green, but a clean-master comparison of the same failing spec files also failed, so the broad-suite failures are tracked as existing/overlapping E2E debt rather than a proven dependency-branch regression. The old baseline worktree path is no longer present on this machine.

**Decision Gist**: Use same-current-line dependency upgrades plus explicit patched transitive overrides; defer framework-major migrations to dedicated branches.

## 2026-05-21: Full-Content Search Product Pass

### D016: Content Search Gets Its Own Endpoint And Derived Index

Status: Accepted

Decision: Keep `/api/search/documents` title-only for command-palette lookup, and add `/api/search/content` as the user-facing full-content document search endpoint. `/docs` uses `/api/search/content`. The searchable index lives in `document_search_index` as derived, rebuildable state with weighted `tsvector` data: title `A`, selected properties `B`, TipTap body text `C`.

Why: The product needed real document content search, but broadening the command-palette endpoint would blur two different jobs: fast navigation by title versus ranked content discovery. A derived Postgres full-text index gives visibility-aware search without adding an external search service or making indexed text a new source of truth.

Alternatives considered: Reuse `/api/search/documents`; query `documents.content::text ILIKE`; add an external search engine. Reusing the endpoint breaks the command-palette contract. `ILIKE` over JSON content is neither ranked nor performance-evidence friendly. An external engine is unnecessary until Postgres full-text search is proven insufficient.

Consequences: Search writes must keep the index fresh after REST document create/update and collaboration persistence, and repair/backfill scripts must be able to rebuild it from source documents. Visibility filtering stays in SQL before `LIMIT`: workspace-visible docs, creator-owned private docs, or admin-visible docs. Archived and deleted documents stay excluded.

Evidence: Implementation added migration `038_document_search_index.sql`, fresh-schema bootstrap support, TipTap/property extraction utilities, `/api/search/content`, OpenAPI schema registration, API tests, `/docs` UI integration, `search:reindex`, and benchmark/query-count/EXPLAIN coverage for content search. Focused DB-backed search tests passed: `src/routes/search.test.ts` 26/26. Content-search query-count evidence is `test-results/perf/query-count-api-2026-05-21T15-33-21-438Z.json`; EXPLAIN evidence is `test-results/perf/explain-performance-2026-05-21T15-33-25-144Z.json` and shows `document_search_index_vector_idx` bitmap index scans; bounded benchmark evidence is `test-results/benchmarks/content-search-api-2026-05-21T15-35-00.json`.

**Decision Gist**: Full-content document search is a distinct product endpoint backed by a derived Postgres full-text index; command-palette search remains title-only.

### D017: Authenticated Route Context Replaces New Non-Null Assertions

Status: Accepted

Decision: Add `getAuthenticatedRouteContext(req)` and use it in newly touched authenticated routes instead of adding more `req.userId!` / `req.workspaceId!` assertions.

Why: Auth middleware does attach those fields, but repeated non-null assertions smear the boundary across route code. A small helper keeps the invariant explicit without a broad route rewrite.

Alternatives considered: Leave assertions in place; globally type `authMiddleware` to refine `Request`; rewrite all authenticated routes. Leaving assertions continues drift. A global Express type refinement is not reliable through middleware composition. A repo-wide rewrite is churnier than the current need.

Consequences: New or touched authenticated routes should prefer the helper. Existing assertions can be retired opportunistically when a route is already being changed.

Evidence: `api/src/routes/search.ts` now uses the helper, and `pnpm --filter @ship/api type-check` passes.

**Decision Gist**: Newly touched authenticated routes should acquire user/workspace ids through a route-context helper, not scattered non-null assertions.

## 2026-05-20: Submission-Gated Foundation Pass

### D001: Bootstrap Is An App-Shell Hydration Boundary

Status: Accepted

Decision: Add `GET /api/bootstrap` as a read-only authenticated endpoint for app-shell data currently fetched by startup providers. The web app seeds existing TanStack Query keys from the bootstrap payload instead of replacing the underlying page-level APIs.

Why: The source-of-truth submission gates require measured performance and database-query evidence. Before optimization work can be credible, the app needs a single, explicit place to reduce cold protected-route request fanout without changing document/product semantics. Seeding existing query keys keeps this conservative: pages still own their normal APIs, while bootstrap reduces duplicate startup fetches.

Alternatives considered: Leave startup fanout as-is and optimize individual list endpoints later; replace page APIs with a broader bootstrap-only data model. The first option does not create leverage for Category 4 measurement. The second option is too invasive and would make bootstrap a new source of product truth.

Consequences: `/api/bootstrap` must stay projection-aligned with the underlying list endpoints for visibility, document associations, project status inference, and standup status semantics. The client seeds existing TanStack Query keys and lets `staleTime`/invalidation govern freshness; it does not force `refetchOnMount: 'always'` after bootstrap hydration. If a list endpoint changes, bootstrap is a contract-drift candidate and should be tested.

Evidence: Focused bootstrap/search/visibility/boundary tests pass against `ship_test_audit`; at the time, `IMPROVEMENT_REPORT.md` kept Category 3 and 4 measurement as `TBD` until before/after benchmark and query-count evidence existed. D014 later added flow-level query-count evidence for the bootstrap app-shell flow.

**Decision Gist**: `/api/bootstrap` preloads existing startup data in one authenticated request to reduce app-shell fanout without replacing normal page APIs as the source of truth.

### D002: Document Search Is Title-Only For Command Palette

Status: Superseded in part by D016

Decision: Implement `/api/search/documents` as title-only, metadata-only search for command-palette navigation. Do not claim or imply full-text document content search from that endpoint. At the time, `/docs` search remained client-side title filtering.

Why: The audit found a false OpenAPI full-text search contract. The submission-gated plan needed to stop command palette from fetching all documents, but full-text content search is a larger product and indexing decision. Title-only search solves the immediate fanout issue without inventing search semantics the product has not chosen.

Alternatives considered: Remove `/search/documents` entirely; implement full-text search now; replace `/docs` search with server search. Removing it preserves honesty but does not reduce command-palette fanout. Full-text search now risks scope creep and unmeasured ranking/security decisions. Replacing `/docs` search changes user-facing behavior beyond the command-palette requirement.

Consequences: Search docs and OpenAPI must call this endpoint title-only. D016 later added full-content search as the distinct `/api/search/content` endpoint with visibility, indexing, ranking, and measurement rails.

Evidence: Focused search tests cover auth, title-only behavior, type filtering, limits, and visibility. `discovery-research-log.md` marks the old false full-text contract as partially resolved.

**Decision Gist**: `/api/search/documents` remains title-only command-palette search; full-content search lives separately at `/api/search/content`.

### D003: Runtime Boundary Schemas Are The Primitive Contract Source

Status: Accepted

Decision: Shared primitive API concepts such as document type, document visibility, belongs-to relationship type, issue state/priority/source, and accountability type should come from `api/src/schemas/document-boundary.ts` and be reused by route validators and OpenAPI schemas.

Why: The audit repeatedly found contract drift between shared types, route-local Zod schemas, database enums, and generated OpenAPI. Duplicated enum literals are cheap until they drift; at this foundation layer drift creates fake-green tests and broken generated clients.

Alternatives considered: Keep route-local schemas and rely on tests; move all domain schema into `@ship/shared`; introduce a broad mapper/refactor pass. Route-local schemas have already drifted. Moving every runtime validator into shared is too broad for this pass. A broad mapper rewrite would create more risk than leverage.

Consequences: SQL projection row types can stay local, but durable API/domain primitive values should not be re-declared in route files or OpenAPI files. Drift tests should compare shared values, runtime Zod values, database enum values, and OpenAPI values for high-risk primitives.

Evidence: `api/src/schemas/document-boundary.test.ts` covers document type drift across shared/runtime/OpenAPI/database, and route/OpenAPI schemas now reuse boundary primitives in high-risk paths.

**Decision Gist**: Shared API primitive values live in `document-boundary.ts` so routes, OpenAPI, shared types, and database enums stop drifting apart.

### D004: Current `schema.sql` And Numbered Migrations Must Coexist

Status: Accepted for current repo shape

Decision: Treat `api/src/db/schema.sql` as the current bootstrap schema for fresh databases, while making numbered migrations idempotent when they add structures already present in `schema.sql`.

Why: The project currently runs `schema.sql` first and then numbered migrations. Fresh Docker-backed databases exposed multiple split-brain failures where `schema.sql` already contained later-era objects and pending migrations attempted to create or rename them again. Making these migrations idempotent preserves fresh bootstrap and existing-database upgrade paths without rewriting the migration system mid-pass.

Alternatives considered: Stop running `schema.sql` before migrations; remove later-era objects from `schema.sql`; mark migrations as applied after schema bootstrap. All three are larger migration-system decisions with higher data-risk. The conservative fix is to make duplicate-structure migrations tolerate the current bootstrap schema.

Consequences: New migrations that add objects also present in `schema.sql` must use `IF NOT EXISTS`, conditional `DO` blocks, or equivalent checks. This is not a permanent endorsement of the current migration architecture; it is the current operating rule until the repo chooses a cleaner bootstrap/migration model.

Evidence: Docker-backed `ship_dev` and sidecar `ship_test_audit` migrations now complete after idempotency fixes to `010_oauth_state.sql`, `025_prevent_circular_parent.sql`, `033_sprint_to_week_rename.sql`, and `035_add_comments.sql`.

**Decision Gist**: `schema.sql` remains the fresh-database bootstrap path for now, while migrations are made idempotent where they overlap with it.

### D005: Raw E2E Is Guarded; The Safe Runner Is Canonical

Status: Accepted

Decision: Make raw `pnpm test:e2e` fail closed with guidance. Use `pnpm test:e2e:run` as the canonical E2E command. Keep `pnpm test:e2e:raw` as the internal raw Playwright path used by `scripts/run-e2e.sh`.

Why: The audit identified raw Playwright output as a fake-green/fake-signal rail: it can flood output, hide failures, and make Codex sessions unstable. The source-of-truth wants defensible evidence, so E2E must run through the controlled runner that tracks progress and final status.

Alternatives considered: Leave raw Playwright available and rely on discipline; rename existing scripts without a guided failure. Discipline is too weak for a repeated operational footgun. A guided failure makes the correct path discoverable.

Consequences: Documentation, memory, and future agents must treat `pnpm test:e2e:run` as the entrypoint. Raw Playwright should only be used deliberately through `test:e2e:raw` when investigating runner internals.

Evidence: `pnpm test:e2e` exits nonzero with runner guidance; `pnpm test:e2e:run -- --list` previously listed the suite through the controlled path.

**Decision Gist**: Raw `pnpm test:e2e` is intentionally blocked, and `pnpm test:e2e:run` is the canonical E2E evidence path.

### D006: OpenAPI YAML Must Be Tool-Valid, Not Just Generated

Status: Accepted

Decision: The OpenAPI generator formats YAML with Prettier so `api/openapi.yaml` is valid for stricter YAML tooling, not merely accepted by one parser.

Why: Generated contracts are evidence artifacts. A YAML file that looks generated but fails common tooling is a contract rail failure. Since Prettier is already a project dependency, using it in generation avoids hand-formatting generated output.

Alternatives considered: Keep JSON as the only authoritative artifact; manually run Prettier after generation; add a new YAML dependency. JSON-only would leave a broken advertised artifact. Manual formatting is easy to forget. A new YAML dependency is unnecessary because Prettier is already available.

Consequences: `openapi:generate` now has an async generation path and depends on the existing Prettier package. Verification should include JSON parse, YAML parse, and `pnpm exec prettier --check api/openapi.yaml`.

Evidence: OpenAPI JSON/YAML parse passes, and `pnpm exec prettier --check api/openapi.yaml` passes after generation.

**Decision Gist**: Generated OpenAPI YAML must be valid for normal tooling, so generation formats it with Prettier instead of producing barely-parseable output.

### D007: Explicit Database URLs Must Win During Migration

Status: Accepted

Decision: `api/src/db/migrate.ts` should not let production secret loading overwrite an explicitly provided `DATABASE_URL`.

Why: Shadow-copy and test workflows intentionally pass explicit database URLs. If production-mode secret loading can replace that URL, a shadow/test migration command can accidentally target prod. That is a high-severity operational boundary error.

Alternatives considered: Require callers to also set `ENVIRONMENT=shadow`; make shadow scripts call a separate migration script. Those can still be footguns. The invariant should live in the migration runner: explicit process input wins.

Consequences: Production secret loading remains fallback behavior only when no `DATABASE_URL` is set. Scripts that pass explicit URLs are safer and easier to reason about.

Evidence: Rails/DB review found and fixed the risk in `migrate.ts`; shell scripts passed syntax validation.

**Decision Gist**: An explicitly provided `DATABASE_URL` must always win during migrations so test/shadow workflows cannot be silently redirected to production.

### D008: API Benchmark Harness Is The Measurement Rail

Status: Accepted

Decision: Add `pnpm benchmark:api` backed by `scripts/benchmark-api.mjs` as the repeatable API benchmark runner. The runner logs in with fixed benchmark credentials, exercises fixed high-value endpoints including `/api/bootstrap`, supports controlled duration/concurrency/rate settings, writes JSON output, and exits nonzero on request failures or non-2xx responses.

Why: Category 4 performance claims are only defensible if the measurement path is repeatable. Ad hoc curl timing or browser impressions are too easy to cherry-pick and too hard to compare before/after. A small repo-local runner gives us a stable measurement rail without adding a new dependency or external service.

Alternatives considered: Use manual curl loops; add a full load-testing framework; defer performance measurement until after feature work. Manual loops are not evidence. A full framework is more tool than this submission pass needs. Deferring measurement recreates the audit problem: claims before proof.

Consequences: Benchmark results are evidence artifacts, not product behavior. Endpoint lists, default credentials, concurrency, rate cap, and output path are now part of the measurement contract and should be changed deliberately. Claims in docs should remain `TBD` until this runner or a stronger measurement path has produced before/after data.

Evidence: `package.json` exposes `benchmark:api`; `scripts/benchmark-api.mjs` writes JSON under `test-results/benchmarks/` by default and fails on non-2xx/fetch failures.

**Decision Gist**: `pnpm benchmark:api` is the repeatable API measurement rail for performance claims, with fixed endpoints, auth, rate/concurrency controls, and JSON output.

### D009: Shadow Database Copy Must Fail Closed

Status: Accepted

Decision: Shadow database copy scripts must stop on schema reset, restore, or verification failures. They should use `ON_ERROR_STOP=1`, capture restore logs, suppress only noisy notices, verify copied row counts, and avoid printing success before verification passes.

Why: The audit found a dangerous fake-green path: a script could drop the target schema, fail restore, and still continue as if shadow was refreshed. That is worse than no automation because it gives confidence while destroying the test surface needed for submission evidence.

Alternatives considered: Keep warnings for count mismatches; rely on manual inspection of restore output; only fix the local copy path. Warnings are too weak after destructive schema reset. Manual inspection is not a guardrail. Fixing only one path leaves the SSM copy flow with the same failure mode.

Consequences: Shadow refresh is stricter now. Some copies that used to limp forward will fail loudly, and that is intentional. If migrations legitimately change row counts, the script should be updated with an explicit verification rule instead of downgrading restore or schema failures back to warnings.

Evidence: `scripts/copy-db-to-shadow.sh` and `scripts/copy-db-via-ssm.sh` now fail on schema reset/restore errors and require users/documents counts to match before reporting success.

**Decision Gist**: Shadow database copy scripts must fail closed on reset, restore, or verification errors instead of printing fake success after a broken refresh.

### D010: Evidence Runs Must Separate Measurement From Claims

Status: Accepted

Decision: Add `pnpm evidence:run` and `pnpm evidence:compare` as repo-local submission evidence rails. Collectors write raw measurements and artifacts under `my-docs/evidence-runs/<run-id>/`, while claim status is recorded separately as `met`, `failed`, or `not_measured`. This is the evidence-runner status vocabulary, not the schema v2 reviewer ledger category vocabulary.

Why: The source-of-truth requires proof: before/after benchmarks, query counts, EXPLAIN output, tests, accessibility reports, and runtime evidence. Prior reports sometimes had useful work recorded beside `TBD` proof gaps. A runner that separates collection from claim evaluation makes overclaiming harder and keeps evidence repeatable.

Alternatives considered: Keep using ad hoc shell snippets; build one large all-or-nothing submission script. Ad hoc snippets are too easy to lose or compare incorrectly. A large monolith would be brittle and would hide which evidence lane failed. Small collectors keep the design modular and let incomplete lanes report `not_measured` honestly.

Consequences: Evidence artifacts are now part of the submission workflow and may be tracked when they support proof. The runner must remain read-only by default and must not regenerate tracked contracts unless explicitly asked. New collectors should report missing prerequisites as `not_measured`, not as a fake pass.

Evidence: `pnpm evidence:run -- --phase final-review --run-id codex-final-review` writes artifacts under `my-docs/evidence-runs/codex-final-review/`; its manifest is correctly failed because the nested `openapi.prettier.json` claim is failed, while incomplete proof lanes remain `not_measured`. `pnpm evidence:compare codex-final-check codex-final-review` passes and writes comparison artifacts under the final-review run directory.

**Decision Gist**: Evidence collection is modular and claim-aware, so proof gaps stay visible instead of becoming prose claims.

### D011: Performance Measurement Rails Precede Performance Claims

Status: Accepted

Decision: Add idempotent audit-load seeding, query-count capture, and EXPLAIN capture scripts before making Category 3 or Category 4 improvement claims.

Why: `/api/bootstrap` is a strong app-shell fanout foundation, but it does not by itself satisfy the Category 3 endpoint P95 requirement. Category 3 requires identical-condition endpoint benchmarks, and Category 4 requires query-count or slow-query proof. Measurement rails must exist before optimization claims are credible.

Alternatives considered: Claim bootstrap as an API latency win; optimize endpoints first and measure afterward. Bootstrap is a flow/fanout improvement, not a direct endpoint P95 reduction. Optimizing before fixed measurement recreates the audit problem.

Consequences: Category 3 remains incomplete until before/after endpoint P95 results meet the source requirement under identical data volume, concurrency, and hardware. D014 later captured Category 4 flow-level query-count proof for bootstrap. `ship_dev` remains the runtime/performance database, while `ship_test_audit` remains the destructive test database.

Evidence: `node --check scripts/seed-audit-load.mjs`, `node --check scripts/query-count-api.mjs`, and `node --check scripts/explain-performance.mjs` pass; the scripts are exposed through `pnpm perf:seed-audit-load`, `pnpm perf:query-count-api`, and `pnpm perf:explain`. `seed-audit-load` is workspace-scoped and tops up tagged issue documents, users/person docs, sprints, and audit logs. Closeout artifacts were written to `test-results/perf/query-count-api-2026-05-20T23-37-27-346Z.json` and `test-results/perf/explain-performance-2026-05-20T23-37-37-930Z.json`.

**Decision Gist**: Performance work now has measurement rails; Category 3 still needs endpoint P95 proof, while Category 4 has later flow-level query-count proof in D014.

### D012: Backlinks Offline State Is Degraded, Not Dead

Status: Accepted

Decision: When backlink polling fails or the browser goes offline, preserve the last successful backlinks, show an accessible stale/offline status, pause polling while offline, retry on reconnect, and avoid repeated console-error spam.

Why: The audit found Backlinks as a console-only runtime failure during disconnects. Treating the panel as a degraded surface keeps the document usable and tells users whether relationship context may be stale.

Alternatives considered: Keep the existing red error state; hide the panel while offline; add a broad global offline system first. A red dead-end discards useful stale context. Hiding the panel loses information. A global offline system is larger than the current source-required fix.

Consequences: Backlinks can display stale data with an explicit status. This improves runtime behavior but does not complete Category 6 until before/after screenshot or recording evidence is captured.

Evidence: `pnpm --filter @ship/web exec vitest run src/components/editor/BacklinksPanel.test.tsx src/components/editor/CommentMark.test.ts` passes.

**Decision Gist**: Backlinks keep useful stale context and expose degraded state instead of failing silently or noisily.

### D013: Closeout Accessibility Runs Stay Report-First Until Known Debt Is Fixed

Status: Accepted

Decision: Use `pnpm a11y:closeout` as a repeatable Playwright/axe reporter for `/docs`, a real `/documents/:id`, and `/my-week`. Keep it non-blocking by default, with `-- --fail-on-serious` available when the known contrast debt is resolved and the team wants a hard gate.

Why: The manual closeout found real product/a11y signals, but some are currently known failures. A report-first runner saves manual effort without making the normal E2E lane fail on already-known debt.

Consequences: Category 7 can be remeasured quickly, and the report can become a gate when serious violations are resolved. Later closeout evidence showed the `--fail-on-serious` gate passing on `/docs`, a selected document page, and `/my-week`; Lighthouse remains unrereun.

Evidence: `pnpm a11y:closeout` writes `test-results/a11y-closeout/axe-summary.json` and screenshots.

**Decision Gist**: Automate the repeatable accessibility scan now; turn it into a blocker only after the known violations are gone.

### D014: Flow Query Counts Are The Bootstrap Proof Unit

Status: Accepted

Decision: Extend `pnpm perf:query-count-api` so it measures named user flows in addition to individual endpoints. Use the protected docs startup app-shell flow as the Category 4 proof unit for bootstrap: old fanout is `/api/auth/me`, wiki documents, programs, projects, issues, standup status, and action items; current behavior is `/api/bootstrap`.

Why: `/api/bootstrap` is designed to reduce request fanout and repeated authenticated list/status work. Endpoint-only measurements can show that `/api/bootstrap` is heavier than any one old endpoint, but that is the wrong comparison. The unit that matters is the startup flow it replaces.

Alternatives considered: Keep endpoint-only query counts; use browser network traces only; optimize bootstrap payload bytes first. Endpoint-only counts understate the benefit. Browser traces are useful but less repeatable for SQL counts. Payload bytes were not the bottleneck in the measured run: current bootstrap was only 79 bytes larger than old fanout against the same data.

Consequences: Future bootstrap changes must preserve flow-level evidence, not just endpoint rows. Category 3 P95 claims still require `pnpm benchmark:api` or stronger before/after latency evidence. Category 4 query-count claims can use the named flow aggregate when run under the same database, user, process, and hardware.

Evidence: `test-results/perf/query-count-api-2026-05-21T02-15-44-061Z.json` measured old protected docs startup fanout at 7 requests, 33 SQL queries, 984,044 response bytes, and 32 ms total elapsed. Current `/api/bootstrap` measured 1 request, 24 SQL queries, 984,123 response bytes, and 17 ms total elapsed. That is -9 queries / -27.3% and requests 7 -> 1 / -85.7% for the flow. `test-results/perf/explain-performance-2026-05-21T02-16-39-379Z.json` records current EXPLAIN output; no slow-query improvement is claimed.

**Decision Gist**: Bootstrap performance proof is flow-level query-count evidence, not a one-endpoint comparison.

### D015: Issue Lists Are Metadata Projections

Status: Accepted

Decision: Keep `GET /api/issues` and `/api/bootstrap` issue data as metadata-only list projections. They do not select or return TipTap `content`, and they omit absent optional fields such as missing ticket numbers, assignees, estimates, rejection reasons, and accountability fields. Issue detail routes continue to return editor content.

Why: Audit-scale data made issue payloads dominate both `/api/issues` and `/api/bootstrap`. List and app-shell views render titles, state, priority, associations, and small metadata; shipping full editor JSON and null-heavy fields through those paths adds bytes without adding user-visible value.

Alternatives considered: Keep full issue objects everywhere; optimize SQL/indexes first; make bootstrap define a separate bespoke issue shape. Full objects kept the payload bottleneck. SQL/index work was not the measured bottleneck for this lane. A bespoke bootstrap shape would create drift from the issue list contract, so the safer contract is one shared list projection.

Consequences: Frontend list, kanban, and picker surfaces must treat some issue metadata as optional. OpenAPI exposes `IssueListItem` separately from full `Issue`. Future issue-detail work must not infer that list responses contain editor content.

Evidence: Valid before benchmark `test-results/benchmarks/api-2026-05-21T02-40-19-503Z.json`; final after benchmark `test-results/benchmarks/api-2026-05-21T03-11-53-590Z.json`; payload spot check after compaction measured `/api/issues` at 307,043 bytes and `/api/bootstrap` at 429,806 bytes on the audit-load dev database. `GET /api/issues` P95 improved by 30.0% at 10c and 26.7% at 25c in the final run, while `/api/bootstrap` P95 remains mixed.

**Decision Gist**: List/app-shell issue data is a compact metadata contract; full editor content belongs on issue detail routes.

### D018: OpenAPI Is The Generated Frontend API Type Source

Status: Accepted

Decision: Use OpenAPI as the generated frontend API contract source. Generate `web/src/api/generated/ship-openapi.d.ts` from `api/openapi.json` with `openapi-typescript`, use `openapi-fetch` through `web/src/api/client.ts`, and keep legacy `apiGet`/`apiPost` helpers only as compatibility shims for uncovered or intentionally raw endpoints.

Why: Hand-maintained frontend response casts and `readJson<T>` calls made the API boundary easy to drift. A generated client makes request params, bodies, and responses flow from the same contract used for API docs and MCP-facing route registration.

Alternatives considered: Continue local frontend interfaces and casts; add runtime validation first; migrate all frontend calls immediately. Local casts recreate the current drift. Runtime validation is a valuable future 10x option, but it is larger and does not replace compile-time contract generation. Immediate broad migration is unsafe because the route/spec checker currently shows incomplete and stale OpenAPI coverage.

Consequences: Route-family work that touches frontend API shape should update OpenAPI first, regenerate types, then migrate callers. At this decision point, `pnpm openapi:check` was report-first because the existing contract was incomplete; later D021 made strict route parity a pre-commit gate. The next 10x step after route/spec coverage is optional runtime response validation for trust-boundary hardening.

Evidence: `pnpm openapi:generate` writes `api/openapi.json`, `api/openapi.yaml`, and `web/src/api/generated/ship-openapi.d.ts`. At this point, `pnpm openapi:check` reported 195 runtime routes, 121 OpenAPI operations, 82 missing, and 8 stale after fixing duplicate route mounts, path-param normalization, and the files/auth route families on 2026-05-21. Later D021 completed parity at 195 runtime / 195 OpenAPI operations, 0 missing, 0 stale. `pnpm type-check` passes after the first typed-client migrations.

**Decision Gist**: OpenAPI is now the frontend API type source, but coverage debt must be closed before broad generated-client migration.

### D019: Runtime Response Validation Waits For Honest Route Coverage

Status: Accepted

Decision: Do not add production runtime response validation as the next blanket move. Use test-time response validation first: selected integration tests should assert that runtime JSON responses match the same Zod schemas that generate OpenAPI. At this decision point, close OpenAPI coverage for each migrated route family before making that family strict.

Why: Runtime validation only improves trust if the schema being enforced is true. At this point, the checker still reported 195 runtime routes, 121 OpenAPI operations, 82 runtime routes missing from OpenAPI, and 8 stale OpenAPI operations. Test-time validation catches drift without adding request-path production risk while the contract is still being cleaned up.

Alternatives considered: Add production middleware immediately; skip runtime validation entirely; migrate all frontend calls to generated types first. Immediate middleware is premature while stale/missing route coverage is known. Skipping validation leaves the trust boundary compile-time only. Broad migration first would spread generated false confidence through more UI code.

Consequences: The next API-contract 10x path is ordered: route/spec coverage, strict coverage gate, targeted test-time response validation, optional staging-only production validation, then broader generated-client migration. Runtime validators should focus on endpoints where malformed server data can silently corrupt UI state, not every low-risk read on day one.

Evidence: `api/src/test/openapi-response.ts` provides `expectOpenApiResponse`, and `api/src/routes/openapi-contract.test.ts` validates `GET /api/auth/session`, `GET /api/csrf-token`, and `POST /api/auth/login` against their registered OpenAPI component schemas. The focused DB-backed test run passed. At the time, `pnpm openapi:check` was report-only and reported 82 missing routes and 8 stale operations; later D021 made strict route parity pass at 195/195. `web/src/api/client.ts` uses `openapi-fetch` with legacy-compatible CSRF/session/JSON behavior, but it does not perform production response validation.

**Decision Gist**: Runtime validation is valuable, but only after the OpenAPI source is honest enough to validate against.

### D021: Full OpenAPI Route Coverage With Strict Pre-Commit Gate

Status: Accepted

Decision: Register all 195 runtime API routes in OpenAPI (including admin and public families), remove stale operations, enforce `pnpm openapi:check:strict` in Husky pre-commit, expand test-time `expectOpenApiResponse` coverage, and pilot `defineRoute` on setup routes. Keep production response middleware deferred.

Why: D018–D019 left 82 missing and 8 stale operations, so generated types and MCP tools could not trust the contract. Full registration with a strict gate prevents regression without adding per-request production overhead.

Alternatives considered: Document admin routes as intentional exclusions; add production middleware first; big-bang `defineRoute` migration. Exclusions were rejected in favor of full registration. Production middleware before honest schemas would fail noisily. Incremental `defineRoute` rollout limits blast radius.

Consequences: `pnpm openapi:generate` must run when OpenAPI schemas change. New routes require schema registration (via `registerPath` or `defineRoute`). Frontend migrations can proceed route-family by route-family. Next 10x: migrate files/auth to `defineRoute`, then optional `OPENAPI_VALIDATE_RESPONSES` in staging.

Evidence: `pnpm openapi:check:strict` reports 195 runtime / 195 OpenAPI, 0 missing, 0 stale. New modules: `admin.ts`, `admin-credentials.ts`, `caia-auth.ts`, `feedback.ts`, `invites.ts`, `setup.ts`, `route-helpers.ts`. Contract tests pass on `ship_test_audit` for openapi-contract, files, feedback, workspaces, bootstrap, and `define-route.test.ts`.

**Decision Gist**: The OpenAPI contract is now complete and enforced locally; runtime production validation remains a later opt-in.

### D022: OpenAPI Path Parity Requires Handler-Aligned Schemas

Status: Accepted

Decision: After achieving 195/195 path coverage, run a handler-vs-schema fidelity audit and fix P0 mismatches (wrong status codes, envelopes, and field names) before treating OpenAPI as client-trustworthy. Introduce shared `ApiErrorResponseSchema` and `SuccessResponseSchema` in `common.ts`; fix `defineRoute` validation errors to use the standard `{ success: false, error: { code, message } }` envelope.

Why: Strict route counting can pass while generated types lie about response bodies (e.g. CAIA `available` vs `configured`, workspaces switch returning `workspaceId` only, feedback GET without envelope).

Alternatives considered: Leave loose `z.record(z.unknown())` everywhere; change handlers to match incorrect specs. Loosening hides bugs; mass handler changes are higher risk than spec alignment for established clients.

Consequences: New registrations should match runtime JSON on success and error paths. Remaining loose admin/team schemas are documented debt. Production `OPENAPI_VALIDATE_RESPONSES` stays deferred until targeted families have strict schemas.

Evidence: Multi-agent audit 2026-05-21; fixes in `caia-auth.ts`, `workspaces.ts`, `feedback.ts`, `invites.ts`, `setup.ts`/`define-route.ts`, `documents.ts`, `backlinks.ts`, `admin.ts`; `pnpm openapi:check:strict` and 501 API tests pass on `ship_test_audit`.

**Decision Gist**: Path coverage is the floor; envelope and field alignment is the ceiling for trusting generated clients.

### D020: Document Authorization Is A Service Boundary

Status: Accepted

Decision: Centralize document/workspace authorization in `api/src/services/document-access.ts` and have route code ask intent-shaped questions such as readable document, referenceable document, association access, and self-or-admin person access.

Why: The fail-open paths shared the same root cause: authorization was a route-by-route convention. Workspace matching alone is not enough for document references because private documents and removed memberships can still be guessed by UUID.

Alternatives considered: Patch each route with local SQL; move immediately to broad ACL tables. Local SQL would preserve the root cause. ACL tables would contradict the current source-of-truth intent: workspace membership plus document visibility, not per-program ACLs.

Consequences: Routes own request intent; the service owns access rules. New mutations that accept document IDs must validate those IDs through the service before mutating. Aggregate SQL may still use a predicate helper, but that predicate must remain actor-scoped.

Evidence: `pnpm type-check` passes after adding `document-access.ts` and wiring API token, documents, associations, feedback, weekly plan/retro, and activity paths. The focused authz-adjacent API batch passed against disposable `ship_test_audit`: 34 files / 498 tests.

**Decision Gist**: Authorization moves from copy-pasted route convention to a shared service boundary.

### D021: Hybrid Fail-Closed Guardrails Beat A Schema Rewrite

Status: Accepted

Decision: Use a hybrid strategy: route/service authorization for actor-specific checks, plus low-risk database guards for impossible states such as cross-workspace/deleted association targets and wrong target types for `program`, `project`, and `sprint` relationships.

Why: Actor visibility cannot be enforced by generic foreign keys, but same-workspace and target-type invariants can. Those invariants make dangerous internal helpers safer without forcing a broad schema redesign.

Alternatives considered: Application-only checks; broad session/token/membership foreign-key rewrites; per-program ACLs. Application-only checks leave unsafe internal write paths. Broad FK work creates churn around super-admin token assumptions and sessions. Per-program ACLs weaken the project intent.

Consequences: `api_tokens` authentication now requires current workspace membership unless the user is super-admin, and migration `039_fail_closed_document_access_guards.sql` revokes orphaned non-super-admin tokens while adding narrow trigger guards. Migration `040_relationship_mutation_guards.sql` cleans existing invalid relationship rows and blocks later document workspace/type/soft-delete mutations from leaving cross-workspace, deleted, or wrong-type relationships behind. `parent_id` remains hierarchy; `document_associations` owns program/project/sprint relationships.

Evidence: Migrations `039_fail_closed_document_access_guards.sql` and `040_relationship_mutation_guards.sql` plus matching `schema.sql` trigger definitions. `pnpm --filter @ship/api db:migrate`, `pnpm type-check`, and the focused API batch pass.

**Decision Gist**: Actor auth lives in code; structural impossibilities are blocked in the database.

### D029: Code Simplification Orchestration (SOLID/DRY Pass)

Status: In progress

Decision: Execute ten simplification opportunities in dependency order via parallel sub-agents (route-http, runtime config, dead grid deletion, extractPlanItems unify, approval workflow, document-access/repository widening, defineRoute pilots, deferred `weeks.ts`/`App.tsx` splits). Master plan: `my-docs/code-simplification-orchestration-plan.md`.

Why: Five copies of Render SameSite policy were already consolidated into `session-cookies.ts`. Remaining wins are god routes (`weeks.ts` ~3.3k lines), duplicate approval/TipTap/HTTP patterns, dead accountability-grid v1/v2, and OpenAPI split-brain. Eelon advisory: delete dead surfaces first; defer file splits until S5/S6/S7 land with tests.

Alternatives considered: Big-bang `weeks.ts` split first (high merge/conflict risk, weak GFA attribution); skip deletion and only abstract (leaves dead OpenAPI surface).

Consequences: No git commits in this pass unless user asks. Phase 3 splits (S8/S10) gated on Phase 1–2 integration + type-check/API tests. v3 accountability grid endpoint path unchanged (`/accountability-grid-v3`).

Evidence: Orchestration plan; parallel agents A1–A4 Phase 1; eelon agent advisory 2026-05-21.

**Decision Gist**: Delete dead code first, unify cross-cutting helpers second, split god files last with measurement.

### D030: Canonical `extractPlanItemsFromContent` In Shared

Status: Accepted

Decision: Move weekly plan bullet extraction to `shared/src/content-extract.ts` as `extractPlanItemsFromContent` with optional `withChecked` / `includeParagraphs`. API consumers (`weekly-plans`, `dashboard`, `ai-analysis`) import from `@ship/shared`; dashboard keeps a thin mapper for `PlanItem[]`.

Why: Three near-duplicate walkers risked drift (D021 pattern). Shared package is the cross-tier contract home.

Alternatives considered: `api/src/utils/document-content.ts` only (web cannot import). Keeping three locals (DRY violation).

Consequences: Run `pnpm --filter @ship/shared build` after changing shared extractors. Retro full-text for AI still uses `extractText` from `document-content.ts`. Next: dedupe `extractPlainText` vs `extractText`.

Evidence: `api/src/__tests__/shared-content-boundary.test.ts`; type-check + 25 targeted API tests pass (2026-05-21).

### D031: Weeks Route Module Split

Status: Accepted

Decision: Split `api/src/routes/weeks.ts` into `api/src/routes/weeks/` (`types`, `shared`, `sprints`, `my-week`, `nested-standups`, `reviews`, `approvals`, `index`). Keep `weeks.ts` as `export { default } from './weeks/index.js'`.

Why: ~3.3k-line god file blocked review and duplicated sprint helpers. Shared `getSprintOwnerReportsTo` / `broadcastAccountabilityUpdateToSprintOwner` live in `weeks/shared.ts`.

Consequences: New sprint/approval routes go in the matching submodule; mount order in `index.ts` must keep static paths before `/:id`.

Evidence: `pnpm type-check`; weeks + projects tests pass on `ship_test_audit` (2026-05-21).

**Decision Gist**: Sprint routes are a folder package, not one file.

### D032: App Shell Component Split

Status: Accepted

Decision: Extract `useAppMode`, `AppHeader`, and `AppSidebar` from `App.tsx`; leave `AppLayout` as composition (~220 lines).

Why: 1.9k-line layout mixed mode detection, chrome, and sidebar trees.

Consequences: Sidebar/mode changes touch `AppSidebar` or `useAppMode`, not the full page.

Evidence: `pnpm --filter @ship/web type-check` pass (2026-05-21).

**Decision Gist**: App layout is composition of focused components.

### D033: Issue Detail Reads Via Repository + Access Actor

Status: Accepted

Decision: Add `getIssueDetailById` / `getIssueDetailByTicketNumber` to `documents-repository.ts`; wire `issues.ts` GET `/:id`, `/by-ticket/:number`, and `/:id/children` parent check through `getActor` + repository / `canReadDocument`.

Why: Extends D015 list projection pattern to detail reads without widening visibility SQL.

Consequences: New issue detail fields belong in repository SELECT, not inline route SQL.

Evidence: `issues.test.ts` pass on `ship_test_audit` (2026-05-21).

**Decision Gist**: Issue detail SQL lives in the repository; access checks use `document-access`.

### D034: Route HTTP Helper Sweep (Phase 4)

Status: Accepted

Decision: Standardize legacy `{ error }` / `{ error, details }` envelopes via `api/src/utils/route-http.ts` across major route files and `api/src/routes/weeks/*` submodules. Keep route-specific 404/403 messages as inline `res.status(...).json({ error: '...' })` unless migrating to `sendLegacyError`.

Why: Phase 1 pilot left most routes on copy-paste `console.error` + 500 JSON. Sweep removes ~100+ duplicate catch blocks without changing response shapes.

Alternatives considered: Middleware-only error handler (would change global behavior); `defineRoute` everywhere first (higher churn).

Consequences: New/edited catch blocks in swept files should use `sendInternalError`. Zod validation should use `sendValidationError`.

Evidence: `pnpm type-check`; `vitest run src/routes/` 313/313 on `ship_test_audit` (2026-05-21).

**Decision Gist**: One helper trio for legacy route JSON errors; routes keep domain-specific 404 text inline.

### D035: OpenAPI Route Scanner Parity (Phase 4b)

Status: Accepted

Decision: Import `standups.js` in `api/src/openapi/index.ts` so `defineRoute` registrations appear in generated spec. Extend `scripts/check-openapi-routes.mjs` to scan `api/src/routes/weeks/*` when `weeks.ts` is a re-export shell.

Why: After S8/S9 split, strict check reported 5 missing standups routes and 24 stale weeks routes despite runtime and OpenAPI being aligned.

Evidence: `pnpm openapi:check:strict` — Runtime 193, OpenAPI 193, 0 missing/stale (2026-05-21).

### D036: Express Router Declaration Standard (Phase 4d)

Status: Accepted

Decision: Default route modules use `const router = Router()` (inferred type). Named exported routers (`searchRouter`, `filesRouter`, etc.) annotate with `import { type Router as ExpressRouter }` only where export typing is required. Remove per-file `type RouterType = ReturnType<typeof Router>()` and duplicate `import type { Router as RouterType }` lines.

Why: ~25 files repeated three equivalent patterns with no behavioral value.

Alternatives considered: `createRouter()` factory (extra indirection); shared `AppRouter` type alias file (unnecessary).

Consequences: New route files follow inference-first; use `ExpressRouter` only on named exports.

Evidence: `pnpm type-check` green across api/web/shared (2026-05-21).

**Decision Gist**: One router idiom — infer by default, annotate exports only.

### D037: simplify-1 Multi-Agent Verification Pass (Phase 5)

Status: Accepted (conditional ship)

Decision: Treat `simplify-1` refactor as **correctness-verified for merge** on automated gates and read-only audits, with documented follow-ups for test coverage and prod SSL policy — not as a full GFA category closure.

Why: Foundational refactors (route-http, weeks split, document-access pilots, defineRoute pilots) need evidence beyond green status-code tests. Parallel agents (security, OpenAPI, weeks structure, web shell, thermo review, test-contract) found **no CRITICAL** regressions; visibility/approval/session behavior preserved vs `master`.

Findings catalogued in `my-docs/code-simplification-orchestration-plan.md` Verification report. Intentional: defineRoute validation envelope; grid route removal (193 paths). Follow-up: prod `databaseSslOptions`, approval-workflow tests, feedback/standups contract tests, `asApprovalRecord` guard.

Evidence: `pnpm type-check`; `openapi:check:strict` 193/193; `vitest run src/routes/` 313/313; standups+feedback 21/21 on `ship_test_audit` (2026-05-21).

**Decision Gist**: Ship the structural pass; track HIGH follow-ups before claiming full GFA/test maturity.

### D038: Compact Issue List Projection

Status: Accepted

Decision: Use one shared issue list mapper for `/api/issues` and `/api/bootstrap`, keep full timestamps/associations on issue detail responses, and omit list-only `created_at` plus empty `belongs_to` from list/bootstrap issue rows.

Why: The benchmark bottleneck was payload/serialization, not SQL. The UI already treats missing `belongs_to` as `[]`, and `created_at` is optional for issue list consumers, so this removes repeat data without weakening the unified document model.

Consequences: Future list/bootstrap issue fields belong in `api/src/utils/issue-response.ts`; OpenAPI `IssueListItem` must stay honest about optional `created_at` and `belongs_to`.

Evidence: payload check 307,043 -> 246,883 bytes for `/api/issues`; duration-matched focused benchmark `test-results/benchmarks/api-2026-05-22T15-04-55-978Z.json`; `pnpm type-check`; `pnpm openapi:generate`; `pnpm openapi:check`.

**Decision Gist**: Issue detail is complete; issue list is compact.

### D039: First-run Setup Uses Transaction Lock

Status: Accepted

Decision: Guard `POST /api/setup/initialize` with a transaction-scoped PostgreSQL advisory lock and perform the "no users exist" check plus all first-user/workspace inserts in that transaction.

Why: The old route checked `COUNT(*)` before inserts with no lock, so two concurrent first-run requests could both pass the empty-user check. First-run setup is a security boundary, not a normal create form.

Consequences: Keep setup initialization narrow and database-backed; do not split first-user, workspace, membership, person, and welcome-doc creation across separate autocommit calls.

Evidence: `DATABASE_URL=postgresql://ship:ship_dev_password@localhost:5432/ship_test_audit pnpm --filter @ship/api exec vitest run src/routes/setup.test.ts src/routes/openapi-contract.test.ts` — 2 files / 5 tests passed.

**Decision Gist**: First-run setup is one locked transaction.

### D040: My Week Optimizes Round Trips Before Indexes

Status: Accepted

Decision: Optimize `GET /api/dashboard/my-week` by collapsing serialized route queries and parallelizing independent reads, while preserving the existing response shape. Do not start with indexes or bootstrap trimming for this slice.

Why: The measured endpoint was small in payload and low in SQL execution time; the higher-leverage issue was sequential app-layer round trips.

Consequences: Keep the route's weekly document lookup as one `document_type IN ('weekly_plan', 'weekly_retro')` query and split rows in memory. Fetch standups and allocations together with `Promise.all` after date-derived inputs are known.

Evidence: `pnpm type-check`; `pnpm perf:query-count-api` wrote `test-results/perf/query-count-api-2026-05-22T15-50-29-330Z.json` with `/api/dashboard/my-week` at 5 queries; valid benchmark `test-results/benchmarks/api-2026-05-22T15-54-22-482Z.json` shows 0 non-2xx for the endpoint and P95 13.99/21.41/32.63ms at 10/25/50c. This is useful but not enough to mark Category 3 complete.

**Decision Gist**: Remove serialized round trips first; keep Category 3 claims evidence-bound.

### D041: Legacy Public Feedback Routes Can Use defineRoute

Status: Accepted

Decision: Public feedback routes should use `defineRoute` and exported schemas, but preserve legacy flat unauthenticated response bodies. `defineRoute` now has an optional validation-error hook for routes whose public contract predates the standard envelope.

Why: Route/OpenAPI ownership should not force a breaking response-shape change on public feedback forms.

Consequences: Use the hook sparingly. New routes should use the default standard envelope unless they are explicitly preserving a legacy public contract.

Evidence: `pnpm openapi:generate`; `pnpm openapi:check:strict` 193 runtime / 193 OpenAPI / 0 missing / 0 stale; focused feedback/defineRoute/setup tests passed 11/11 on `ship_test_audit`.

**Decision Gist**: Contract ownership and legacy compatibility are compatible when the exception is explicit and tested.

### D042: Submission Ledger Is The Reviewer Claim Source

Status: Accepted

Decision: Treat `my-docs/evidence/submission-ledger.json` as the structured source for reviewer-facing submission claims, with `my-docs/reviewer-dashboard.html` generated from it. Schema v2 must cover canonical Categories 1-8 and keep category-owned summary cards, targets, acceptance tests, claims, evidence, caveats, and sources together. Narrative docs can explain context, but category status and acceptance-test truth belong in the ledger first.

Why: `IMPROVEMENT_REPORT.md` is useful history, but prose ledgers drift and can hide partial evidence. The structured ledger makes pass/fail/warn acceptance tests explicit, keeps source requirements beside measurements, and lets the dashboard be regenerated without hand-editing reviewer output.

Consequences: Evidence-changing work should update only the affected ledger categories, keep unproven claims as `partial`, `open`, `needs_fill_in`, or `not_measured`, then run `pnpm submission:validate` and `pnpm submission:render`. `pnpm submission:render` validates first and then regenerates `my-docs/reviewer-dashboard.html`. The validator blocks `proven` categories with failing required acceptance tests or incomplete required rubric items.

Evidence: `package.json` exposes `submission:validate`, `submission:render-dashboard`, `submission:render`, and `submission:validate:strict`; `pnpm submission:validate` currently reports Cats 1 and 5 passing, Cat 5 with warning `cat5-e2e-baseline-not-green`, and Cats 2, 3, 4, 6, 7, and 8 carrying honest open gates.

**Decision Gist**: Reviewer claims are ledger-first; prose reports are context, not the claim authority.
