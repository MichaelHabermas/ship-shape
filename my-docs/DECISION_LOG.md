# Decision Log

Durable choices made during the audit/improvement work. This file exists so we can defend why structural decisions were made, what they do not claim, and what future work must preserve.

## 2026-05-20: Submission-Gated Foundation Pass

### D001: Bootstrap Is An App-Shell Hydration Boundary

Status: Accepted

Decision: Add `GET /api/bootstrap` as a read-only authenticated endpoint for app-shell data currently fetched by startup providers. The web app seeds existing TanStack Query keys from the bootstrap payload instead of replacing the underlying page-level APIs.

Why: The source-of-truth submission gates require measured performance and database-query evidence. Before optimization work can be credible, the app needs a single, explicit place to reduce cold protected-route request fanout without changing document/product semantics. Seeding existing query keys keeps this conservative: pages still own their normal APIs, while bootstrap reduces duplicate startup fetches.

Alternatives considered: Leave startup fanout as-is and optimize individual list endpoints later; replace page APIs with a broader bootstrap-only data model. The first option does not create leverage for Category 4 measurement. The second option is too invasive and would make bootstrap a new source of product truth.

Consequences: `/api/bootstrap` must stay projection-aligned with the underlying list endpoints for visibility, document associations, project status inference, and standup status semantics. The client seeds existing TanStack Query keys and lets `staleTime`/invalidation govern freshness; it does not force `refetchOnMount: 'always'` after bootstrap hydration. If a list endpoint changes, bootstrap is a contract-drift candidate and should be tested.

Evidence: Focused bootstrap/search/visibility/boundary tests pass against `ship_test_audit`; `IMPROVEMENT_REPORT.md` keeps Category 3 and 4 measurement as `TBD` until before/after benchmark and query-count evidence exists.

**Decision Gist**: `/api/bootstrap` preloads existing startup data in one authenticated request to reduce app-shell fanout without replacing normal page APIs as the source of truth.

### D002: Document Search Is Title-Only For Command Palette

Status: Accepted

Decision: Implement `/api/search/documents` as title-only, metadata-only search for command-palette navigation. Do not claim or imply full-text document content search. Keep `/docs` search as client-side title filtering for now.

Why: The audit found a false OpenAPI full-text search contract. The submission-gated plan needed to stop command palette from fetching all documents, but full-text content search is a larger product and indexing decision. Title-only search solves the immediate fanout issue without inventing search semantics the product has not chosen.

Alternatives considered: Remove `/search/documents` entirely; implement full-text search now; replace `/docs` search with server search. Removing it preserves honesty but does not reduce command-palette fanout. Full-text search now risks scope creep and unmeasured ranking/security decisions. Replacing `/docs` search changes user-facing behavior beyond the command-palette requirement.

Consequences: Search docs and OpenAPI must call this endpoint title-only. Future full-text search should be a distinct decision with visibility, indexing, ranking, and measurement evidence.

Evidence: Focused search tests cover auth, title-only behavior, type filtering, limits, and visibility. `discovery-research-log.md` marks the old false full-text contract as partially resolved.

**Decision Gist**: `/api/search/documents` is title-only command-palette search, reducing document fetch fanout without pretending we built full-text content search.

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
