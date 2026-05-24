# Decision Log

Durable choices made during the audit/improvement work. This file exists so we can defend why structural decisions were made, what they do not claim, and what future work must preserve.

## 2026-05-24: Evidence Freeze

### D069: Put Generic Document Mutations Behind One Core

Status: Accepted

Decision: Introduce a reason-coded `DocumentPolicy` plus `document-mutations.ts` boundary and migrate `POST /api/documents`, `PATCH /api/documents/:id`, `PATCH /api/documents/:id/content`, `DELETE /api/documents/:id`, and `POST /api/documents/:id/convert` through it. During review, harden the boundary by enforcing `"Untitled"` creation, soft-delete retention, creator/admin delete authorization, top-level RACI blocking, archived conversion parity, issue ticket allocation, weekly `/content` approval reset, and unambiguous association update shapes. Keep broader weekly/collaboration/web adapter refactors deferred.

Why: The highest-risk document behavior was still routed through large HTTP handlers that owned access checks, property merging, association writes, content extraction, Yjs invalidation, search updates, visibility revocation, accountability resubmission side effects, deletion, and in-place issue/project conversion. A small mutation core gives future work one auditable boundary without disturbing the already-proven submission evidence.

Alternatives considered: full document service rewrite; policy compiler with generated guards; leaving route code untouched. A full rewrite risks submission evidence churn. Generated guards are promising but premature. Leaving the route untouched preserves duplication in the most security-sensitive mutation path.

Consequences: New generic document mutation work should prefer the mutation boundary over adding route-local side effects. The static policy-case table is a seed for future generated probes/guards, not a compiler yet. Delete semantics are now intentionally soft-delete plus creator/admin authorization. No schema change and no submission-ledger claim change.

Evidence: `pnpm type-check` passed; focused API regressions for document policy/documents/visibility/associations passed 72/72. Full API suite passed 579/579. `pnpm security:probe:ci` is not accepted as evidence for this pass because it failed at seeded admin login with HTTP 500 after migrate/seed/package tests.

**Decision Gist**: Centralize generic document writes in one auditable mutation core; keep generated policy tooling as a later proof mechanism, not first-pass architecture.

### D077: Central Security Capability Layer (2026-05-24)

Status: Accepted

Decision: Add `Principal`, reason-coded `Capability`, `authorize()`, and `requireCapability()` as the shared security layer for sessions, API tokens, setup actors, document reads/writes/references, files, collaboration, workspace admin actions, and token governance. Keep existing `document-access`, `document-policy`, and mutation helpers as inputs/adapters rather than parallel authorization systems.

Why: The active findings were not one-route bugs; they were duplicated authority decisions across REST, WebSockets, file serving, setup, and token paths. One capability boundary makes the safer path simpler: new code asks for a named capability and gets a reason-coded decision.

Alternatives considered: patch every route independently; full generated policy compiler first; separate auth systems for REST and realtime. Route patches leave drift. A compiler is useful later but premature before the capability vocabulary stabilizes. Separate realtime auth was the class of bug this pass removed.

Consequences: New sensitive behavior should add or reuse a capability, not copy workspace/user checks. Existing API tokens receive `legacy:full` compatibility; new tokens are admin-created, scoped, audited, and expire by default. Setup initialization is gated by a server-side token when configured/production. Document-bound files authorize through the linked document; legacy unbound files fall back to uploader/admin. Collaboration joins and revalidation use the same capability layer as REST.

Evidence: Focused API/security tests passed; file route tests passed after applying migration `041_security_capabilities.sql` to `ship_test_audit`; `pnpm type-check`, `pnpm openapi:check:strict`, and `pnpm security:probe:test` passed. `SECURITY_PROBE_API_PORT=3101 SECURITY_PROBE_WEB_PORT=5201 pnpm security:probe:ci` produced `runs/security-probe-ci-20260524-141159/` with 5/5 surfaces, 40/40 probes passed, and 0 findings; the wrapper then reported generated-findings output stale after recording verifications, which was resolved with `pnpm security:findings:render` and `pnpm security:findings:check`.

**Decision Gist**: Authorize capabilities, not routes; REST, files, tokens, setup, and realtime share one reason-coded security model.

### D078: Close Security Findings Only Through Evidence-Backed CLI Updates (2026-05-24)

Status: Accepted

Decision: Treat `security-findings.json` as the source of truth and close SS-FIND rows only after a mapped probe or focused regression test proves the original exploit path is blocked. Use `pnpm exec shipshape-security findings record-manual` or probe verification, then `findings status`, then regenerate/check the findings ledger.

Why: The security architecture closure fixed several code paths before the findings registry reflected them. Closing rows from code inspection would make the evidence story look cleaner than it is. The safer rule is slower but defensible: no proof, no fixed status.

Consequences: The identity/token/file closeout wave marked `SS-FIND-013`, `014`, `016`, `018`, `021`, `028`, `032`, and `033` fixed because focused API/security tests covered the relevant behavior. Other rows that appear partly mitigated remain open until they have direct probes/tests.

Evidence: Focused API/security run passed 51/51 across workspaces, setup, API tokens, files, OpenAPI contract, and capabilities. `pnpm security:findings:render` and `pnpm security:findings:check` passed after CLI updates.

**Decision Gist**: Findings close by evidence, not vibes.

### D066: Treat Generated Reviewer Bundles As Build Output

Status: Accepted

Decision: Treat generated reviewer bundle output as build output, prune stale evidence-run archives, and remove temporary orchestration-plan files from the durable docs surface. Keep source evidence in the submission ledger, source-of-truth briefs, security-audit evidence, retained source-referenced run artifacts, and referenced test artifacts; regenerate reviewer bundles with `pnpm submission:render-bundle`.

Why: The source-of-truth assignment rewards measured evidence, but duplicated generated artifacts create false authorities. The bundle copies can diverge from source docs, old run archives mixed superseded measurements with current proof, and temporary plans kept inviting agents to re-execute completed coordination.

Alternatives considered: Leave everything in place and rely on readers to infer which files are source; hand-edit generated bundle copies after source docs change. Both approaches increase drift and weaken reviewer navigation.

Consequences: Future doc edits should update the source docs and ledger first, then regenerate generated outputs. Do not preserve one-off orchestration plans unless they are actively guiding current work. Do not prune run artifacts that are still referenced by the ledger or reviewer dashboard. This does not change Categories 1-8 claims.

Evidence: Documentation cleanup removed stale evidence-run archives and two temporary orchestration-plan files; retained ledger-referenced Category 2 evidence; regenerated reviewer bundle output; stale durable doc references were patched in `docs/claude-reference/anti-patterns.md`, `docs/claude-reference/testing.md`, and `docs/research/fpki-auth-client-dcr-analysis.md`.

**Decision Gist**: Source docs should be few and authoritative; generated packages should be rebuilt, not curated by hand.

### D067: Evidence Run Retention Policy

Status: Accepted

Decision: Add retention metadata to evidence-run manifests and a conservative `pnpm evidence:prune` command. New runs default to `scratch`; callers can pass `--retention source-evidence`, `--retention scratch`, or `--retention generated-package`. Prune runs in dry-run mode unless `--apply` is passed, and it refuses to delete runs referenced by the submission ledger, checklist, improvement report, or reviewer dashboard.

Why: Manual evidence cleanup is error-prone because some generated run directories are disposable while others are part of source-required proof. A retention policy makes the distinction explicit and moves deletion decisions into a reusable tool.

Alternatives considered: keep deleting archive folders by hand; preserve every run forever. Manual deletion risks broken reviewer links. Keeping everything recreates the docs-noise problem and hides current evidence under stale snapshots.

Consequences: Evidence producers should mark durable proof with `--retention source-evidence`; local experiments can stay default `scratch`. Use `pnpm evidence:prune` first to inspect, then `pnpm evidence:prune -- --apply` only after reviewing protected/kept runs.

Evidence: `scripts/evidence/run.mjs` writes `manifest.retention`; `scripts/evidence/prune.mjs` protects referenced runs and deletes only unprotected runs when applied; `package.json` exposes `pnpm evidence:prune`.

**Decision Gist**: Evidence retention is metadata-driven and delete-safe by default.

### D064: Freeze Product Code And Package Reviewer Evidence

Status: Accepted

Decision: Stop product and architecture changes after the ledger-proven Categories 1-8 state, and spend the final pass on submission packaging: checklist, proof map, deploy smoke evidence, claim boundaries, and generated dashboard/ledger consistency.

Why: The source-of-truth assignment rewards measured improvements with proof. Additional implementation after proven ledger status risks invalidating benchmark comparability and diffusing reviewer attention. The stale artifact was not the code; it was the blank reviewer checklist and scattered proof paths.

Alternatives considered: start another architecture-deepening pass around file authorization or visibility joins; rerun broad product refactors for SOLID/DRY polish. Those are real backlog items, but they do not improve the current submission unless they produce new source-required evidence, and they could force costly reruns.

Consequences: Product code is frozen unless a validation command exposes a blocker. `my-docs/evidence/submission-ledger.json` remains the claim authority. Narrative docs can explain caveats, but generated dashboard/report truth comes from `pnpm submission:render`. No staging, unstaging, or commits without explicit instruction.

Evidence: `my-docs/SUBMISSION_CHECKLIST.md` now indexes deliverables, category proof, deploy smoke, final commands, and claim boundaries; `my-docs/evidence/deploy-smoke-2026-05-24.md` records the basic public Render smoke.

**Decision Gist**: After proof is good enough, protect it; package evidence instead of reopening implementation.

### D065: Profile E2E By Resource Sensitivity

Status: Accepted

Decision: Route full E2E runs through `scripts/run-e2e-profiled.sh`, which classifies specs into normal, realtime, and isolated lanes. Normal specs run with moderate parallelism; realtime/collaboration and state-sensitive specs run with one worker by default. Targeted E2E invocations still delegate to the existing runner.

Why: The previous full-suite failure pattern mixed true bugs with resource-pressure flakes: collaboration persistence, multi-page auth, session timeout, bulk selection, and stale My Week data all competed in one broad lane. Running everything together made the suite brittle and made failures expensive to classify.

Alternatives considered: Keep one global worker count for all specs; mark failing specs flaky; only rerun focused clusters. A global low worker count hides the resource model and slows every run. Flaky annotations weaken the signal. Focused reruns help diagnosis but do not make the default full suite trustworthy.

Consequences: New E2E spec files must be classified before the full profiled run starts. Specs that depend on WebSockets, editor persistence, browser context isolation, or timing-sensitive modal/session state should go in realtime or isolated lanes until proven otherwise. `pnpm test:e2e:run` is now the stable full-suite entrypoint; raw Playwright remains behind the runner.

Evidence: Final focused failure cluster exited successfully in `test-results/failure-cluster-final-8` with retry-pass output: 35 passed, 1 flaky. Final full profiled E2E exited successfully in `test-results/profiled-full-final` with normal 525 passed / 4 flaky, realtime 177 passed / 1 flaky, and isolated 166 passed.

**Decision Gist**: Default E2E should encode the system's resource reality instead of asking every spec to survive maximum contention.

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

Decision: Add `getAuthenticatedRouteContext(req)` for workspace-authenticated routes and `getAuthenticatedUserContext(req)` for user-only authenticated routes, then use those helpers in touched routes instead of adding more `req.userId!` / `req.workspaceId!` assertions.

Why: Auth middleware does attach those fields, but repeated non-null assertions smear the boundary across route code. A small helper keeps the invariant explicit without a broad route rewrite.

Alternatives considered: Leave assertions in place; globally type `authMiddleware` to refine `Request`; rewrite all authenticated routes. Leaving assertions continues drift. A global Express type refinement is not reliable through middleware composition. A repo-wide rewrite is churnier than the current need.

Consequences: New or touched authenticated routes should prefer the matching helper. Workspace-bound routes should use the route context helper; super-admin/audit routes that only need a user id should use the user-only helper. Existing assertions can be retired opportunistically when a route is already being changed.

Evidence: `api/src/routes/search.ts` uses the workspace helper. The 2026-05-22 non-null assertion sweep converted authenticated routes across standups, feedback, documents, issues, projects, weeks, team, dashboard, admin, credentials, and API-token families; `pnpm type-safety:counts` reports production non-null assertions at 35, all in `api/src/db/seed.ts`, and `pnpm type-check` passes.

**Decision Gist**: Newly touched authenticated routes should acquire user/workspace ids through context helpers, not scattered non-null assertions.

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

Evidence: Historical `pnpm evidence:run -- --phase final-review --run-id codex-final-review` output proved the runner shape and comparison behavior; stale generated archives were later pruned after durable findings moved into the narrative docs and ledger.

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

Decision: Use `pnpm a11y:closeout` as a repeatable Playwright/axe reporter for `/docs`, `/projects`, a real `/documents/:id`, and supporting `/my-week`. Keep it non-blocking by default, with `-- --fail-on-serious` available when the known contrast debt is resolved and the team wants a hard gate.

Why: The manual closeout found real product/a11y signals, but some are currently known failures. A report-first runner saves manual effort without making the normal E2E lane fail on already-known debt.

Consequences: Category 7 can be remeasured quickly, and the report can become a gate when serious violations are resolved. Later closeout evidence showed the `--fail-on-serious` gate passing on `/docs`, `/projects`, a selected document page, and supporting `/my-week`; Lighthouse remains unrereun.

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

Decision: Execute ten simplification opportunities in dependency order via parallel sub-agents (route-http, runtime config, dead grid deletion, extractPlanItems unify, approval workflow, document-access/repository widening, defineRoute pilots, deferred `weeks.ts`/`App.tsx` splits). The temporary master plan was retired after durable decisions were recorded here.

Why: Five copies of Render SameSite policy were already consolidated into `session-cookies.ts`. Remaining wins are god routes (`weeks.ts` ~3.3k lines), duplicate approval/TipTap/HTTP patterns, dead accountability-grid v1/v2, and OpenAPI split-brain. Eelon advisory: delete dead surfaces first; defer file splits until S5/S6/S7 land with tests.

Alternatives considered: Big-bang `weeks.ts` split first (high merge/conflict risk, weak GFA attribution); skip deletion and only abstract (leaves dead OpenAPI surface).

Consequences: No git commits in this pass unless user asks. Phase 3 splits (S8/S10) gated on Phase 1–2 integration + type-check/API tests. v3 accountability grid endpoint path unchanged (`/accountability-grid-v3`).

Evidence: Parallel agents A1–A4 Phase 1; eelon agent advisory 2026-05-21; durable phase outcomes in this decision log and `my-docs/IMPROVEMENT_REPORT.md`.

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

Findings were catalogued in the retired orchestration verification report and preserved here. Intentional: defineRoute validation envelope; grid route removal (193 paths). Follow-up: prod `databaseSslOptions`, approval-workflow tests, feedback/standups contract tests, `asApprovalRecord` guard.

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

Decision: Treat `my-docs/evidence/submission-ledger.json` as the structured source for reviewer-facing submission claims, with `my-docs/reviewer-dashboard.html` and the `IMPROVEMENT_REPORT.md` Current Ledger Truth block generated from it. Schema v2 must cover canonical Categories 1-8 and keep category-owned summary cards, targets, acceptance tests, claims, evidence, caveats, and sources together. Narrative docs can explain context, but category status and acceptance-test truth belong in the ledger first.

Why: `IMPROVEMENT_REPORT.md` is useful history, but prose ledgers drift and can hide partial evidence. The structured ledger makes pass/fail/warn acceptance tests explicit, keeps source requirements beside measurements, and lets the dashboard be regenerated without hand-editing reviewer output.

Consequences: Evidence-changing work should update only the affected ledger categories, keep unproven claims as `partial`, `open`, `needs_fill_in`, or `not_measured`, then run `pnpm submission:validate`, `pnpm submission:render`, and `pnpm submission:check`. `pnpm submission:render` validates first and then regenerates `my-docs/reviewer-dashboard.html` plus the generated ledger block in `IMPROVEMENT_REPORT.md`. The validator blocks `proven` categories with failing required acceptance tests or incomplete required rubric items; `pnpm submission:check` blocks stale generated outputs.

Evidence: `package.json` exposes `submission:validate`, `submission:render-dashboard`, `submission:render-markdown`, `submission:render`, `submission:check`, `submission:test`, and `submission:validate:strict`; `pnpm submission:validate` reports category pass/fail/warn status from `my-docs/evidence/submission-ledger.json`.

**Decision Gist**: Reviewer claims are ledger-first; prose reports are context, not the claim authority.

### D043: Meaningful Cast Cleanup Uses Boundary Modules

Status: Accepted

Decision: Reduce high-risk `as` casts by adding narrow boundary modules instead of scattering new assertions: query coercion helpers for API routes, `asApprovalRecord` as a persisted JSONB guard, frontend API status errors, and a web-local document response-to-editor-view mapper.

Why: Raw `as` counts were still high after the `any` and non-null sweeps, but many remaining casts were not equally risky. The useful work is where untyped external data enters the app: request queries, JSONB properties, API responses, and status-bearing errors.

Consequences: Future route cleanup should prefer schemas/helpers over `req.query.foo as string`; future editor/page cleanup should map API responses once before passing typed document views into UI components. Keep `as const` and ordinary DOM/library casts out of the main success claim unless they hide real boundary risk.

Evidence: `pnpm type-safety:counts` after the pass reports `as` assertions at 460 total / 346 production, down from the previous 575 total / 461 production. `pnpm type-check` passed; focused web mapper/tab tests passed 25/25; focused API route tests passed 108/108 on `ship_test_audit`; full web suite passed 168/168; full API suite passed 509/509.

Correctness follow-up: Review found that persisted document types must not be silently remapped to `wiki`, and runtime query parsing should not live under the OpenAPI schema module. The mapper now preserves `standup` and `weekly_review` as base editor views, returning `null` only for truly unknown document type strings. Runtime query helpers live in `api/src/utils/query-params.ts`; `api/src/openapi/schemas/query-helpers.ts` only exports schema constants. Focused verification passed: `pnpm type-check`; web mapper test 5/5; API search/OpenAPI tests 30/30 on `ship_test_audit`; query-param and approval-workflow utility tests 7/7 on `ship_test_audit`.

**Decision Gist**: Remove casts at ingress boundaries, not by moving assertions around.

### D044: AI Provider Outage Uses Explicit Degraded Mode

Status: Accepted

Decision: Treat missing Bedrock/AWS credentials as an expected degraded runtime state, not as a generic server failure. AI status and analysis endpoints return controlled `ai_unavailable` JSON, and plan/retro quality banners show a concise unavailable message while keeping editor content and existing persisted analysis visible.

Why: The AI assistant is helpful but non-critical. A provider credential outage should not look like data loss, a blank assistant, or noisy stack output to the user.

Consequences: Future AI features should share the same provider-availability guard and degraded response shape. Do not count provider outage handling as Security Cat 8; it is Category 6 runtime-error UX evidence.

Evidence: `pnpm --filter @ship/web exec vitest run src/components/PlanQualityBanner.test.tsx` passed; `node scripts/cat6-ai-unavailable-evidence.mjs` wrote `test-results/category-6-ai-unavailable/cat6-ai-unavailable-degraded-ui.png`. The collector now requires an existing weekly plan or `CAT6_DOCUMENT_PATH`, so it does not manufacture evidence data.

**Decision Gist**: AI unavailable is a supported degraded mode.

### D045: Bootstrap Payload Can Be Narrower Than Detail Payloads

Status: Accepted

Decision: `/api/bootstrap` may return metadata/list projections for app-shell hydration while detail endpoints remain full-fidelity. Bootstrap-seeded React Query list caches should be marked stale when fields are intentionally narrowed so observed list/detail queries refetch their complete contracts.

Why: Bootstrap is an app-shell accelerator, not a detail endpoint. Shipping editor/detail-heavy fields in the shell payload increases latency risk without improving initial navigation.

Consequences: Any narrowed bootstrap field must be reflected in OpenAPI and frontend consumers. Do not remove user-facing capability; if a route needs full document/project detail, keep loading it from the existing detail endpoint.

Evidence: `pnpm type-check`; OpenAPI regenerated; focused API route tests on `ship_test_audit` passed for bootstrap/issues/search/visibility. The full benchmark rerun was excluded from Cat 3 proof because rate limiting caused non-2xx responses.

Follow-up (2026-05-22 Wave 2): `BootstrapDocumentPropertiesSchema` in OpenAPI now matches runtime `pickBootstrapDocumentProperties` allowlist in `api/src/constants/bootstrap-document.ts`.

**Decision Gist**: Bootstrap is metadata-first; detail routes keep full data.

### D046: Canonical DocumentTreeItem With Sidebar Adapter

Status: Accepted

Decision: Use one shared `DocumentTreeItem` component with an `inline` default for `/docs` main tree and a `sidebar` variant wired through `SidebarDocumentTreeItem` for app-shell context menus. Keyboard navigation helpers live in `web/src/lib/documentTreeKeyboard.ts`.

Why: The S10 app-shell extraction duplicated ~340 lines of tree row logic. Consolidation prevents paired fixes (e.g. a11y min-height) and matches `docs/document-model-conventions.md`.

Consequences: Sidebar keeps undo-delete semantics; `/docs` main tree keeps inline add/delete callbacks. Delete UX parity between sidebar and main tree remains intentionally deferred.

Evidence: `pnpm type-check`; web tests for PlanQualityBanner and quiet-fetch pass.

**Decision Gist**: One tree component; sidebar binds context via adapter.

### D047: Restore Bedrock Credential Guard After Wave 1 Refactor

Status: Accepted

Decision: Keep `hasUsableBedrockClient()` at the top of `callBedrock` in `api/src/services/ai-analysis.ts` so analyze endpoints never invoke Bedrock when credentials are unavailable, matching D044 and pre-Wave-2 behavior.

Why: Wave 1 Agent A1 removed the guard from `callBedrock` without adding entry guards on `analyzePlan`/`analyzeRetro`; `/api/ai/status` could report unavailable while analyze still attempted invoke.

Consequences: Unit test `api/src/services/__tests__/ai-analysis.test.ts` locks guard behavior; frontend `useAiQuality` status gate remains defense-in-depth.

Evidence: Vitest guard test passes; `isAiAvailable()` and analyze paths share credential cache.

**Decision Gist**: One guard at invoke boundary; D044 preserved.

### D048: JSON And SQL Row Type Boundaries

Status: Accepted

Decision: Web fetches parse JSON only through `web/src/api/read-json.ts` (`readJson`, `apiGetJson`, `quietGetJson`). OpenAPI schema aliases live in `web/src/api/schemas.ts`. API routes type PostgreSQL reads with co-located `*Row` types and `pool.query<Row>()`, using `api/src/utils/query-rows.ts` `requireFirstRow()` where a row must exist.

Why: ~4,400 ESLint `no-unsafe-*` warnings traced to untyped `response.json()` and untyped `pool.query` rows. Central boundaries contain casts; consumers get meaningful types per GFA Cat 1.

Consequences: ESLint unsafe warnings web 324→38, api 4121→1894 (2026-05-22). Production AST `any` remains 1; further API route typing deferred to follow-up passes.

Evidence: `pnpm type-check`; API 521/521; web vitest 174/174.

**Decision Gist**: One JSON parse module; per-route SQL row types.

### D048: Cat 3 Benchmarks Bypass Rate Limits Only In Non-Production

Status: Accepted

Decision: Add an explicit benchmark-only rate-limit bypass that is disabled in production and requires a matching token on both the API process and benchmark client. Use it for Cat 3 benchmark evidence instead of `NODE_ENV=test` or accepting 429-contaminated rows.

Why: Category 3 needs endpoint latency proof, not rate-limiter behavior. The standard 100 rps matrix can trigger 429s and make latency look artificially fast. `NODE_ENV=test` also changes environment conditions, so the cleaner measurement is a documented non-production bypass with identical before/after settings.

Consequences: Benchmark artifacts must record bypass state, base URL, duration, rate, connections, and endpoint set. Any artifact with non-2xx or request failures remains inadmissible for Cat 3 proof. Production rate limiting remains unchanged.

Evidence: Before artifact `my-docs/evidence/artifacts/cat3-before-7d31add-bypass.json` was produced from isolated ref `7d31add` with only the bypass patch applied; after artifact `my-docs/evidence/artifacts/cat3-after-current-bypass-repeat.json` was produced from the current built server. Both used `ship_dev`, built `node dist/index.js`, `http://127.0.0.1:3001`, 15s duration, 10/25/50 concurrency, 100 rps, and the same bypass token. Ledger now marks Category 3 proven.

**Decision Gist**: Measure API latency, not limiter latency.

## Post-GFA Authorization Kernel (2026-05-22)

### D049: Shared Session Validation For HTTP And WebSocket

Status: Accepted

Decision: Extract `validateAuthenticatedSession()` into `api/src/services/session-auth.ts` and use it from `authMiddleware` (session cookie path) and collaboration WebSocket upgrade (`validateWebSocketSession`). The helper enforces absolute/inactivity timeouts **and** live `workspace_memberships` checks, deleting revoked sessions fail-closed.

Why: Discovery log flagged WebSocket paths that reimplemented partial session checks without membership revocation. Duplicated timeout logic drifted from HTTP middleware.

Alternatives considered: Periodic membership polling on open sockets only (more complex); trusting session cookie until timeout (rejected — fails closed requirement).

Consequences: WebSocket upgrade rejects revoked members immediately. HTTP and WS share one timeout/membership policy. DB errors propagate to HTTP 500; WS catches and rejects upgrade.

Evidence: `api/src/services/__tests__/session-auth.test.ts`; API suite 535/535 on `ship_test_audit`.

**Decision Gist**: One session validator for HTTP and realtime.

### D050: Governance Authority Module For Team And Week Mutations

Status: Accepted

Decision: Add `api/src/services/governance-auth.ts` with `requireTeamAllocationAuthority` (workspace admin) and `requireWeekLifecycleAuthority` (supervisor/accountable/admin/sprint owner via person doc). Wire `POST/DELETE /api/team/assign`, `POST /api/weeks/:id/start`, and `POST /api/weeks/:id/carryover`.

Why: Visibility-only checks allowed any member who could see a sprint to start weeks or mutate allocations — bypassing the approval authority model.

Alternatives considered: Inline checks per route (rejected — DRY); full declarative policy engine (deferred).

Consequences: Sprint `owner_id` resolves through person document `user_id`, not raw user UUID in properties.

Evidence: `api/src/services/__tests__/governance-auth.test.ts`; `weeks.test.ts` owner fixtures updated.

**Decision Gist**: Lifecycle and allocation mutations require governance authority, not visibility alone.

### D051: Tier 1 Shared Type Consolidation (`@ship/shared`)

Status: Accepted

Decision: Centralize Tier 1 cross-tier types and UI constants in `@ship/shared`: `InferredProjectStatus`, `ISSUE_STATE_OPTIONS`, `ISSUE_STATE_LABELS`, `SelectableDocumentType`, `ConversionDocumentType`, wire `ApiResponse`/`ApiError`, and domain `BelongsTo` (replacing API-local `BelongsToEntry`). Web/API import these directly; OpenAPI wire names (`BelongsToEntry`, `BelongsToResponse`) stay on the HTTP contract layer.

Why: Duplicate unions and label arrays drifted between API routes, query hooks, sidebars, and list views. Foundational enums belong in one package with existing `document-boundary.test.ts` guardrails for core unions.

Alternatives considered: OpenAPI-generated types as sole web wire source (Tier 2 — deferred); renaming OpenAPI `BelongsToEntry` now (would churn clients — deferred).

Consequences: `pnpm build:shared` required after edits. Remaining intentional local subsets (`PanelDocumentType`, `UnifiedDocumentType`, `CurrentDocumentContext` local type) are UI-scoped, not duplicates of the same name. Tier 2 completed enum + hook wire consolidation (see D052).

Evidence: Multi-agent verification pass 2026-05-22 — `pnpm type-check` green; `document-boundary.test.ts` 4/4; grep shows zero `ApiEnvelope` and zero API-domain `BelongsToEntry`.

**Decision Gist**: Domain types and shared UI label tables live in `@ship/shared`; wire/OpenAPI names may differ intentionally.

### D052: Tier 2 Type Consolidation (shared enum source + OpenAPI wire types)

Status: Accepted

Decision: (1) Move enum **value arrays** to `shared/src/enums/document-enums.ts` as the write-once source; `api/src/schemas/document-boundary.ts` becomes thin `z.enum()` wrappers importing those arrays (supersedes D051 for enum values only — hand-written interfaces like `IssueProperties` stay in shared). (2) Wire web query hooks through `web/src/api/schemas.ts` aliases of `components['schemas']` from generated OpenAPI. (3) Fix OpenAPI/runtime drift for program sprints wrapper, active weeks snake_case, and project issue/week list items before hook migration. (4) Centralize `ISSUE_PRIORITY_OPTIONS` / `ISSUE_PRIORITY_OPTIONS_FULL` in shared for sidebar and context menu.

Why: Tier 1 removed duplicate unions but enum values still lived in boundary + regex tests; hook DTOs duplicated OpenAPI shapes and drifted (camelCase active weeks, flat program sprints array). Compile-time alignment on `openapi:generate` catches wire drift immediately.

Alternatives considered: Generate shared from boundary codegen (rejected — shared cannot import API); keep hand-rolled hook types with partial migration (rejected — plan required spec fixes first).

Consequences: List contexts use `IssueListItem`; detail/mutations use OpenAPI `Issue`. `InferredProjectStatus` is in boundary tests and OpenAPI projects/dashboard/programs schemas. `document-boundary.test.ts` adds exhaustiveness guards for issue state/priority UI options. Optimistic cache updates cast nullable OpenAPI fields where generator omits `| null` on nested refs.

Evidence: 2026-05-22 gates — `pnpm build:shared`, `pnpm type-check`, `document-boundary.test.ts` 6/6, `openapi:check:strict` 193/193, zero `no-unused-vars` ESLint warnings.

**Decision Gist**: Shared owns enum values; OpenAPI owns wire JSON shapes; hooks import from `schemas.ts`.

### D053: Tier 2 verification fixes (sprint mutation + bootstrap cache + labels)

Status: Accepted

Decision: After multi-agent Tier 2 verification, fix four concrete regressions/gaps exposed by stricter typing: (1) inline sprint assignment in `IssuesList` must use bulk issue update API, not single-issue PATCH with `sprint_id`; (2) bootstrap issue cache seed uses `IssueListItem[]`; (3) list priority labels derive from `ISSUE_PRIORITY_LABELS` in shared; (4) `action_items` issue source gets distinct badge styling/label.

Why: Tier 2 correctly split list vs detail issue types and aligned PATCH schema with API — which revealed that inline sprint had been sending an ignored field. Fixing preserves user-visible sprint assignment behavior without weakening boundary schemas.

Alternatives considered: Add `sprint_id` to `updateIssueRequestSchema` (rejected — bulk path already exists and matches bulk toolbar UX); revert hook migration (rejected).

Consequences: Document remaining OpenAPI/runtime gaps (`workspace_sprint_start_date` format, program sprints `status` query) in verification doc rather than blocking Tier 2 merge.

Evidence: `pnpm type-check` green; `document-boundary.test.ts` 6/6; discovery-research-log Tier 2 verification sections.

**Decision Gist**: Verification fixes close real UX bugs exposed by type consolidation; wire drift items stay explicitly deferred with contract-test recommendation.

### D054: Tier 2 follow-up hardening (wire dates, contract tests, cache, nullable OpenAPI, apiClient)

Status: Accepted

Decision: Close Tier 2 verification gaps in one hardening pass: (1) normalize `workspace_sprint_start_date` to OpenAPI `DateSchema` via `formatWireDate`; (2) add `expectOpenApiResponse` contract tests for program sprints, active weeks, and project issue/week lists; (3) remove unimplemented program sprints `status` query from OpenAPI; (4) add `issue-list-cache.ts` so issue mutations update all filtered TanStack list caches; (5) post-process OpenAPI nullable `$ref` patterns before `openapi-typescript` and gate on zero `& unknown` in generated types; (6) add `optimistic-stubs.ts` and migrate issue/program/project hook reads/mutations to `apiClient`; (7) add E2E proof that inline week assignment hits `POST /api/issues/bulk`.

Why: Tier 2 made drift visible; follow-up prevents regression at the wire boundary and restores optimistic UX on filtered issue views without weakening PATCH schemas.

Alternatives considered: Relax OpenAPI to `DateTimeSchema` everywhere (rejected — active weeks/program sprints already document `YYYY-MM-DD`); keep single-cache mutations (rejected — filtered views are primary UX).

Consequences: `pnpm openapi:generate` runs `check-openapi-types.mjs`. Issue list cache keys normalize `undefined` filters to `{}`. Component-level legacy mutations remain on `@/lib/api` until a later pass.

Evidence: `pnpm type-check`; contract tests 4/4; `openapi:check:strict` 193/193; `e2e/issues-inline-sprint.spec.ts` 1/1; discovery-research-log Tier 2 hardening sections.

**Decision Gist**: Wire fidelity + cache coherence + typed client migration are part of the Tier 2 foundation, not optional polish.

### D055: Multi-agent verification fixes on `specs-polish-1` (cache eviction + wire dates)

Status: Accepted

Decision: After parallel security/OpenAPI/hooks/GFA/code-quality reviews of staged Tier 2 hardening, apply targeted correctness fixes: (1) filter-aware eviction in `issue-list-cache.ts` when `belongs_to` changes; (2) unit tests for cache membership; (3) `formatWireDate` rejects non-conforming strings and uses **local** calendar parts (pg DATE arrives as local-midnight `Date`); (4) `POST /weeks` 201 uses `formatWireDate` with fail-closed 500; (5) sprint optimistic stubs use `YYYY-MM-DD`; (6) `createIssueApi` keeps server-default `priority: 'medium'`.

Why: Three independent reviewers flagged the same cache and wire-date gaps; fixing before merge avoids foundational regressions in filtered issue views and week create responses.

Alternatives considered: Rely on `onSettled` invalidation only (rejected — wrong rows flash in filtered tabs); relax OpenAPI to datetime everywhere (deferred — project week lists still use `DateTimeSchema`).

Consequences: Pre-existing auth gaps (PATCH week status bypass, bulk sprint target visibility) remain tracked in discovery log — not introduced by this branch. Submission ledger unchanged.

Evidence: `issue-list-cache.test.ts` 4/4; `format-wire-date.test.ts`; focused API contract suite 52/52; `pnpm type-check`.

**Decision Gist**: Filtered issue cache updates must re-evaluate list membership, not only patch rows in place.

### D056: Second multi-agent verification round on Tier 2 hardening (orchestrator fixes)

Status: Accepted

Decision: Run six parallel reviewers (API wire/contract, React Query cache, OpenAPI/apiClient migration, E2E/integration, GFA source-of-truth compliance, security regression) on the completed Tier 2 hardening pass. Apply orchestrator fixes for confirmed gaps: (1) `formatWireDate` uses local calendar parts for pg DATE midnight values and strips space-separated datetimes; (2) `POST /weeks` create test asserts `YYYY-MM-DD` regex (full `WeekResponseSchema` contract deferred — handler returns a subset); (3) `useBulkUpdateIssues` reconciles server truth on `onSuccess` including partial `failed[]` entries; (4) E2E inline sprint spec asserts issue **leaves** sprint-locked Plan tab and **arrives** in target sprint (prior assertion expected wrong UI state).

Why: Foundational wire/cache/E2E layers need adversarial review beyond first-pass gates; false-positive E2E would have masked product-correct behavior.

Alternatives considered: Full `expectOpenApiResponse` on POST /weeks create (blocked — OpenAPI registers full `Week` schema but handler omits list-only fields); rely on invalidation-only for bulk partial failures (rejected — optimistic wrong state until refetch).

Consequences: Document POST /weeks OpenAPI/handler shape mismatch as open tail. Pre-existing security items (PATCH week status bypass, bulk sprint target visibility) remain tracked, not introduced here. Submission ledger unchanged.

Evidence: API contract suite 60/60; `issue-list-cache.test.ts` 4/4; `e2e/issues-inline-sprint.spec.ts` 1/1 (departure + arrival); `pnpm type-check`; `openapi:check:strict` 193/193.

**Decision Gist**: Verification is not complete until E2E asserts product-correct outcomes, not convenient DOM states.

### D057: Documentation Sync Policy (Phases 3 and 6)

Status: Accepted

Decision: Agent-facing and architecture docs must reflect current repo reality: local dev via `pnpm dev` (local PostgreSQL, not Docker-first); schema changes via numbered migrations only (never edit `api/src/db/schema.sql` for existing tables); Render via `render.yaml` is the primary public/demo deploy path; optional AWS scripts (`deploy.sh`, `deploy-web.sh`) remain documented for Treasury infrastructure.

Why: Doc-sync Phases 3 and 6 found stale paths (pool.ts, Zustand, legacy program_id columns), wrong deploy entrypoints, and missing E2E fallbacks that mislead agents and developers.

Alternatives considered: Rewrite all docs from scratch (rejected — minimum targeted sync); delete AWS docs (rejected — still needed for optional gov path).

Consequences: CLAUDE.md, context-manifest, claude-reference, application-architecture, and deploy guides stay aligned with code on each doc-sync pass. New doc claims require codebase verification first.

Evidence: `render.yaml`; `scripts/dev.sh`; `AGENTS.md`; `api/src/db/client.ts`; `shared/src/enums/document-enums.ts`; doc-sync Phase 3/6 fix list.

**Decision Gist**: Docs describe what the repo is today — `pnpm dev`, migrations-only schema changes, Render primary.

### D058: E2E triage after May 22 full-suite regression (2026-05-23)

Status: Accepted

Decision: Fix three root causes surfaced by the first valid full E2E run after the Playwright sandbox trap: (1) restore backlinks spec helper usage (`createWikiDoc` replaces removed local `createNewDocument` from PR #4 — test-only, documented in spec header); (2) session-timeout ARIA E2E asserts via role/text instead of `#radix-:…` CSS ids (matches `SessionTimeoutModal.test.tsx` approach); (3) repair weekly-plan SQL in `getProjectAllocationGrid` and list filters — cast JSONB ids to `uuid` for node-pg params and qualify ambiguous `properties` columns in JOIN selects.

Why: May 20 baseline was ~862 pass / 1 fail; May 22 valid run was 828 pass / 23 fail. Clusters were not random product regressions: backlinks were a partial refactor, session-timeout selectors were invalid for Radix ids, allocation-grid routes 500'd with `text = uuid` and ambiguous column errors.

Alternatives considered: Skip failing specs (rejected — several are hard test/API bugs); revert PR #4 backlinks refactor entirely (rejected — shared fixtures are correct, four call sites were missed).

Consequences: Document every test assertion change inline with the product/API reason. Remaining full-suite failures (inline-comments highlight, a11y tree selector, flakes) stay tracked separately.

Evidence: `test-results/triage-fixes-batch3` — backlinks + session-timeout + weekly plan/retro query specs green; allocation grid fixes verified in follow-up run `triage-fixes-batch4`.

**Decision Gist**: Test changes need a traceable why — helper restore, selector strategy aligned with unit tests, or API SQL correctness — not silent edits.

### D060: Category 8 security probe as black-box closeout harness (2026-05-23)

Status: Accepted

Decision: Close Category 8 with a repo-aware `pnpm security:probe` harness rather than static notes. The runner discovers local ports, logs in with seeded dev credentials, runs modular probes for auth/session, WebSocket validation, input sanitization, dependency CVEs, and assisted manual review, then writes immutable JSON/Markdown reports plus stable `latest.*` artifacts. The probe suggests ledger updates but never edits the ledger itself.

Why: The Category 8 source brief asks for runnable attack evidence, manual review, and two verified fixes. A single command makes that reproducible for graders and prevents overclaiming old hardening as security-audit proof.

Alternatives considered: static audit writeup only (rejected — not runnable); broad policy-as-code authorization oracle (deferred — powerful but too large for Cat 8); capability-scoped API token redesign (deferred — correct product direction but not required once token boundary probe passed).

Consequences: Security evidence now lives under `my-docs/evidence/security-audit/`. Local mode may create run-tagged records; remote write/stress probing is opt-in. Category 8 ledger truth is generated from probe-backed paths, not memory.

Evidence: `pnpm security:probe -- --run-id cat8-final` — 4/4 surfaces measured, 25/25 probes passed, 0 findings. Before/after proof covers file upload validation/headers and WebSocket malformed/unknown/oversized frame resilience across collaboration and event sockets.

**Decision Gist**: Category 8 proof is a runnable black-box harness plus before/after reports, not a narrative-only audit.

### D062: Security probe v2 — authorization surface and finding registry (2026-05-23)

Status: Accepted

Decision: Extend `pnpm security:probe` with a fifth measured surface (`authorization`), shared fixtures (`lib/fixtures.mjs`), and a fingerprinted `probe-finding-registry.json` so runs report **known-open**, **new**, **resolved**, and **regression** buckets instead of re-listing the same issues as novel every time. Keep Cat 8 historical closeout at `runs/cat8-final/` (4/4 perimeter, 0 findings); v2 runs use new run IDs (e.g. `probe-v2-baseline-unfixed`). Default `failOn` is `high`; use `--fail-on=new` when only unknown findings should break CI.

Why: Perimeter probes passed while a deep authorization review found 34 open business-logic issues. The tool must encode OWASP A01-style checks (governance PATCH, IDOR, WS origin, upload hijack) as live regressions, not rely on separate agent skills.

Alternatives considered: dual `cat8` vs `full` profiles (rejected — one honest tool); auto-closing SS-FIND rows from probe alone (rejected — ledger stays human-confirmed).

Consequences: Full runs against unfixed main report ~10 known-open authorization/input findings. Login rate-limit live burst runs only under `--probe abuse-login-rate-limit` so seeded admin login is not locked out. Control probes (member denied audit logs, etc.) use registry `status: control`.

Evidence: `pnpm security:probe -- --run-id probe-v2-baseline-unfixed` — 5/5 surfaces, 10 findings, triage known-open=10, new=0. Code under `scripts/security-probe/probes/authorization.mjs`, `lib/finding-registry.mjs`, `lib/registry.mjs`.

**Decision Gist**: One probe harness, honest failures, fingerprinted triage — Cat 8 closeout artifact preserved, v2 catches business-logic regressions.

### D063: Security probe CI gate with `--fail-on=new` (2026-05-23)

Status: Accepted

Decision: Add `pnpm security:probe:ci` (migrate, seed, API, full probe) and GitHub Actions workflow `security-probe.yml`. CI fails only on **new** findings or **regressions** (`lib/ci-fail.mjs`), not on registry `open` backlog. Completeness under `--fail-on=new` fails only when surfaces are incomplete or probes **error** (skipped member-only probes do not fail CI). Mark registry entries `fixed` only after probe passes; keep SS-FIND-008 registry `open` until document-scoped file serve exists.

Why: Option F from probe v2 plan — green CI on `main` while honest about backlog, but block unknown vulns and re-breaks of fixed fingerprints.

Alternatives considered: fail on any finding including known-open (rejected — blocks merges until all 34 SS-FIND closed); skip CI entirely (rejected).

Consequences: Multi-agent verification found probe/route drift (week status tested documents only) and API bypasses; follow-up hardening same day. `authorization-file-document-scope` remains a partial check (uploader vs document visibility).

Evidence: `pnpm security:probe:ci` — 5/5 surfaces, 0 findings, 0 new, 0 regression (`runs/security-probe-ci-20260523-190801/`). `pnpm security:probe:test` 9/9; `pnpm type-check` pass.

**Decision Gist**: CI guards new security regressions, not the whole SS-FIND backlog — registry fingerprints are the contract.

### D064: Unified security findings SoT (`security-findings.json`) (2026-05-23)

Status: Accepted

Decision: Replace dual `probe-finding-registry.json` + hand-edited `security-findings-ledger.md` with one authoritative index: **`security-findings.json`** (workflow `status`, `probes[]` bindings with `regression`/`control` roles, append-only `verifications[]`) plus **`security-findings/narratives/*.md`** for long prose. **`security-findings-ledger.md` is generated** (`pnpm security:findings:render`); `pnpm security:findings:check` runs in CI after probe. Workflow status is CLI-first (`pnpm security:findings:set-status`); probe pass appends verifications only — never auto-sets `status: fixed`. Legacy hand-edited ledger archived as `security-findings-ledger.legacy.md`.

Why: Two stores drifted (registry marked fixes while ledger showed 34×open). One index answers first discovered, last verification, still active, and probe linkage without contradicting human workflow.

Alternatives considered: DB-backed findings (deferred); auto-close on probe pass (rejected — SS-FIND-008); invariant DSL (deferred).

Consequences: `probe-finding-registry.json` removed. `finding-registry.mjs` is a thin adapter over the store. Cat 8 `proven` unchanged; submission limit documents that SS-FIND backlog is not all closed.

Evidence: `pnpm security:findings:migrate` → 34 findings; `pnpm security:findings:check` pass; modules under `scripts/security-probe/lib/security-findings-*.mjs`.

**Decision Gist**: One JSON SoT for findings; generated ledger; CLI owns status; probes append history only.

### D065: `shipshape-security` package — CLI + TUI (2026-05-24)

Status: Accepted

Decision: Ship Category 8 as **`@ship/shipshape-security`** with binary **`shipshape-security`**: subcommands `run`, `ci`, `findings`, `baseline`, `compliance`, `tui`. Move probe/findings implementation from `scripts/security-probe/` into `packages/shipshape-security/src/`. Default `run` keeps v2 (5 surfaces); `--cat8-perimeter` preserves 4-surface `cat8-final` parity. Root `pnpm security:*` scripts delegate via `pnpm exec shipshape-security`. Ink TUI supports browse findings, run probe, set status.

Why: Cat 8 brief requires a deliverable runnable tool with single-command grader UX; scattered pnpm script names failed discoverability (D064 SoT was correct; packaging was not).

Alternatives considered: npm publish (deferred); generic probe engine split (deferred); TUI-only without CLI (rejected for CI).

Consequences: `scripts/security-probe/run.mjs` and `scripts/security-findings/cli.mjs` are deprecated shims. CI uses `packages/shipshape-security/scripts/run-ci.sh`. Evidence paths unchanged under `my-docs/evidence/security-audit/`.

Evidence: `pnpm exec shipshape-security --help`; `pnpm --filter @ship/shipshape-security test` 15/15; `pnpm exec shipshape-security findings check`.

**Decision Gist**: One binary for Cat 8 — probe, findings, compliance, and TUI — not a menagerie of pnpm script names.

### D061: Category 5 full E2E warning resolved with route-consistency fixes (2026-05-22)

Status: Accepted

Decision: Treat the Cat 5 E2E warning as resolvable only with a fresh full Playwright run, not by deleting the known caveat. The stale warning was replaced after fixing the current final failures and recording `PLAYWRIGHT_WORKERS=2 E2E_RESULTS_DIR=test-results/cat5-full-green-check pnpm test:e2e:run` at 872 passed / 0 failed.

Why: The old evidence mixed stale failure counts with real current failures. The current failure set was concrete: upload test byte-count drift after stricter local upload validation, program week nested navigation using `/sprints` instead of the actual `weeks` tab route, and broad project-link locators colliding with the document list.

Consequences: Program week timeline selection now stays inside the active Weeks tab route (`/documents/:programId/weeks/:weekId`). Cat 5 ledger truth now claims a green recorded full E2E run with retry artifact logs retained as flake follow-up context, not zero-flake proof.

Evidence: `test-results/cat5-final-failures` 4/4 focused final failures passed; `test-results/cat5-flaky-check` 4/4 retry-flake cases passed; `test-results/cat5-full-green-check/summary.json` records 872 passed / 0 failed; `pnpm type-check`, web 172/172, and API 554/554 passed.

**Decision Gist**: Remove Cat 5’s E2E warning only after a fresh full-suite green run, and keep retry artifacts visible.

### D059: Inline comment cancel + docs tree E2E alignment (2026-05-23)

Status: Accepted

Decision: Fix product cancel path (`CommentMark.unsetComment` mark range uses text length, not leaf `nodeSize`; document-level Escape while `pendingCommentId` is set in `Editor.tsx`) and align a11y tree E2E with `DocumentTreeItem` markup (`data-testid="doc-item"`, case-insensitive tree aria-label). E2E cancel test focuses pending input before Escape — documents timing, not weaker assertion.

Why: Full-suite May 22 failures included chronic inline-comments cancel and a11y tree auto-expand. Root cause for cancel was incomplete mark removal plus Escape not reaching handlers when focus left the editor; tree test used removed `data-tree-item` selector.

Evidence: `CommentMark.test.ts` 2/2; `triage-a11y-tree2` 1/1; inline cancel stable after document Escape handler. Follow-up batch (D058/D059 extension): E2E seed enables `public_feedback_enabled` on Ship Core; combobox a11y scopes to `#properties-portal`; syntax-highlighting asserts `hljs-*` (lowlight); team-mode sort checks per program group; my-week stale-data runs retro before plan (retro auto-seeds planReference blocks when plan exists).

**Decision Gist**: Prefer product fixes backed by unit tests; update E2E selectors when component markup changed, with comments pointing to seed/component source.

### D062: Lazy lowlight subset for editor code blocks (2026-05-23)

Status: Accepted

Decision: Defer highlight.js loading until first code-block use via `web/src/components/editor/lowlight-setup.ts`. Register a curated subset from `lowlight`’s `common` preset (javascript, typescript, json, bash, python, sql, yaml) matching E2E syntax-highlight languages. Wire `Editor.tsx` to load the code-block extension asynchronously on mount.

Why: Eager `createLowlight(common)` at module scope pulled ~378 KB highlight.js into the PropertyRow-named chunk. Lazy init shrinks that chunk without removing syntax highlighting or changing the Cat 2 claim ID (initial-entry/code-splitting path).

Alternatives considered: per-language dynamic `highlight.js/lib/languages/*` imports (rejected — not a direct Vite dep); lazy entire Editor shell (deferred — collab/UX risk).

Consequences: Largest built chunk dropped 837.24 KB → 642.48 KB; total JS/CSS 2396.29 KB → 2369.69 KB vs prior closeout. Entry chunk unchanged within measurement noise. Claim boundary unchanged: still not total −15% vs baseline 2262.65 KB.

Evidence: `pnpm build:web`; `pnpm evidence:run -- --phase cat2-easy-wins --run-id cat2-easy-wins-20260523`; artifact `my-docs/evidence-runs/cat2-easy-wins-20260523/collectors/bundle-stats.json`.

**Decision Gist**: Lazy-load heavy editor deps on first use; measure chunk-level wins without widening Cat 2 claims.

### D063: Cat 4 search scorecard honesty boundary (2026-05-23)

Status: Accepted

Decision: Fill the Category 4 “Search content” scorecard row with measured **3 SQL queries per `/api/search/content` request** from `content_search_distribution`, documenting the client-side (0 queries) → server FTS (3 queries) tradeoff. Do not add derived negative % metrics for search. Leave Load main page, View document, List issues, and Sprint board blank (no harness before/after).

Why: Full-content search is a product upgrade with a real per-request SQL cost. Claiming query-count reduction would be dishonest; documenting the tradeoff satisfies “document what was inefficient.”

Evidence: `test-results/perf/query-count-api-easy-wins-20260523.json`; ledger measurement `cat4-search-content-after`.

**Decision Gist**: Scorecard completeness without overclaiming search as a query-count win.

### D064: Cat 7 axe closeout page expansion + Action Items modal (2026-05-23)

Status: Accepted

Decision: Extend `scripts/a11y-closeout.mjs` with pre-login `/login` and post-login `/issues`. Fix Action Items modal keyboard flow by replacing the header close button with Radix `Dialog.Close` and adding `ActionItemsModal.test.tsx`. Defer Lighthouse rerun.

Why: Expands repeatable axe evidence to pages graders care about without installing Lighthouse. Action Items close control was a known keyboard debt from manual closeout.

Evidence: `pnpm a11y:closeout -- --fail-on-serious` → 0 critical/serious on `/login`, `/docs`, `/issues`, `/projects`, selected `/documents/:id`, `/my-week` in `test-results/a11y-closeout/axe-summary.json`; `pnpm --filter @ship/web exec vitest run src/components/ActionItemsModal.test.tsx`.

**Decision Gist**: Axe path stays the proven Cat 7 branch; expand pages and fix one modal keyboard gap.

### D065: Cat 7 local closeout wrapper + tree keyboard proof (2026-05-24)

Decision: Add `pnpm a11y:closeout:local -- --fail-on-serious` as the preferred local Cat 7 closeout command and strengthen the docs tree keyboard E2E to cover Up/Down, Left/Right, Home, and End.

Why: The source claim was already closed on the axe Critical/Serious path, but reruns depended on an already-running app and local database setup. The wrapper owns Docker PostgreSQL, migrate/seed, dev-server boot, axe execution, and dev-child cleanup. Tree arrow navigation was the only named Cat 7 manual keyboard debt, so the regression now proves it directly.

Evidence: `pnpm a11y:closeout:local -- --fail-on-serious` -> 0 violations on `/login`, `/docs`, `/issues`, `/projects`, selected `/documents/:id`, and `/my-week`; `E2E_RESULTS_DIR=test-results/a11y-tree-keyboard-closeout PLAYWRIGHT_WORKERS=1 pnpm test:e2e:run e2e/accessibility-remediation.spec.ts -g "document tree supports arrow-key focus and expand/collapse"` -> 1 passed / 0 failed.

**Decision Gist**: Make Cat 7 reruns self-setting locally and close the remaining tree keyboard debt with focused proof.

### D065: Cat 6 process lifecycle and targeted boundary hardening (2026-05-23)

Status: Accepted

Decision: Add Cat 6 operational runtime hardening without changing the counted three-fix proof. Centralize API shutdown handling in `api/src/runtime/shutdown.ts`, move signal/fatal process ownership to `api/src/index.ts`, expose `closeDatabasePool()`, and make collaboration setup return a cleanup function that removes the upgrade listener, closes WebSocket servers with a terminate fallback, awaits final Yjs persistence, and flushes pending saves. On the frontend, make `ErrorBoundary` a named reusable primitive, reset the route boundary on navigation, and use recoverable `ResilientSection` wrappers around volatile optional surfaces while keeping the TipTap/Yjs editor core outside a small fallback boundary.

Why: The audit called out missing process-level fatal handlers and partial error-boundary coverage. Those are real operational risks, but they should not be counted as a fourth user-facing Cat 6 fix unless they have the same before/after repro and screenshot burden as the original source requirement.

Consequences: `SIGTERM`/`SIGINT` now attempt bounded graceful shutdown and exit 0 unless a fatal event arrives during shutdown; `unhandledRejection`/`uncaughtException` log fatal context, attempt shutdown, and exit 1. Optional sidebar/AI/backlink render failures can degrade locally without replacing the editor. A test-only boundary route is included only in `VITE_APP_ENV=test_e2e` builds for deterministic Playwright screenshot evidence.

Evidence: `DATABASE_URL=postgresql://ship:ship_dev_password@localhost:5432/ship_test_audit pnpm --filter @ship/api exec vitest run src/runtime/shutdown.test.ts` 7/7; `pnpm --filter @ship/web exec vitest run src/components/ui/ErrorBoundary.test.tsx` 6/6; `E2E_RESULTS_DIR=test-results/category-6-boundary-evidence PLAYWRIGHT_WORKERS=1 pnpm test:e2e:run e2e/error-handling.spec.ts --grep "error boundary"` 1/1; full Cat 6 runtime file 9/9.

**Decision Gist**: Treat process fatal handlers and targeted render boundaries as Cat 6 hardening, not a new counted fix.

### D066: Separate reviewer security evidence bundle (2026-05-24)

Status: Accepted

Decision: Publish reviewer-facing evidence through a generated static bundle at `my-docs/reviewer-evidence-bundle/`, intended for a separate Render Static Site named `ship-shape-reviewer-evidence`. Do not fold the reviewer bundle into `ship-shape-web`, AWS app deploys, or authenticated app routes.

Why: The reviewer dashboard needs live-linkable evidence without coupling proof artifacts to the React SPA, login routing, or app deploy rollback. The static bundle is a publication surface, so it gets a manifest and redaction gate instead of copying raw local reports blindly.

Consequences: `pnpm submission:render` now generates the dashboard, markdown ledger block, and reviewer bundle. `pnpm submission:check` verifies generated dashboard/markdown freshness plus bundle presence/redaction. The Security tab renders latest probe results separately from the known findings backlog so “latest active probe confirmed 0 findings” cannot be read as “all security findings are closed.”

Evidence: `my-docs/reviewer-evidence-bundle/index.html`, `manifest.json`, generated `my-docs/reviewer-dashboard.html` Security tab, and `my-docs/evidence/submission-ledger.json` Cat 8 evidence entry.

**Decision Gist**: Keep reviewer evidence static, isolated, generated, and bounded by explicit non-claims.

### D067: Activation contract for agent-readable docs (2026-05-24)

Status: Accepted

Decision: Add `scripts/doc-sync/check-activation-refs.mjs` and wire it into `pnpm docs:check` / `pnpm docs:check:strict`. The check scans high-activation docs (`AGENTS.md`, `.claude/**`, `.agents/**`, and selected `docs/claude-reference/**`) for repo-local slash command drift, missing `./scripts/*` references, and external absolute local paths. Keep `/e2e-test-runner` as an external optional wrapper with repo-local fallback instead of requiring a repo skill.

Why: The curated doc-sync path check was green while stale agent activation remained outside the gate. The expensive failures are not prose typos; they are agents chasing absent commands or personal workstation paths.

Consequences: AWS/Terraform docs remain as a future/legacy path. Active agent guidance now points absent `/ship-openapi-endpoints`, `/workflows:deploy`, and `/ship-security-compliance` references back to repo-local docs/scripts. Historical FPKI research no longer exposes personal absolute paths.

Evidence: `pnpm docs:check:activation`; `pnpm docs:check:strict`.

**Decision Gist**: Guard the activation surface, not just curated architecture prose.

### D069: Security Console tab + local console server (2026-05-24)

Status: Accepted

Decision: Make the generated reviewer dashboard **Security Console** tab the primary interactive Category 8 surface. Extract render logic to `scripts/submission/security-dashboard/` (deliverable table, probe explorer, SS-FIND drawer, embedded JSON payload). Add `pnpm security:console` — a localhost-only server that serves the dashboard with `consoleApiBase` injected and exposes `POST /api/run` (probe or findings check) plus `POST /api/findings/:id/status` with SSE logs.

Why: The prior Security tab duplicated static tables without the brief-aligned deliverable matrix, narrative drill-down, or runnable workflow. The dashboard HTML stays generated/offline-safe; live runs need Node (`runProbe`, `pnpm audit`, repo reads) and must not run in the browser.

Consequences: Regenerate with `pnpm submission:render` after evidence changes. `findingActiveLabel` / `enrichFindingForDisplay` in `@ship/shipshape-security` is the single source for “active backlog” display. `compliance` reads `cat8-audit-deliverable.json` `table` (not `rows`). Static `file://` dashboard remains read-only; use the console server for Run probe.

Evidence: `scripts/submission/security-dashboard/`, `packages/shipshape-security/src/console/server.mjs`, `pnpm security:console`, regenerated `my-docs/reviewer-dashboard.html`.

**Decision Gist**: Generated dashboard for review; localhost console server for execution.

### D068: Collapse AWS root replay docs into one future-path guide (2026-05-24)

Status: Accepted

Decision: Keep `DEPLOYMENT.md` as the active deployment switchboard: Render is current, AWS/Terraform is future/legacy. Move duplicate root AWS planning/checklist/summary docs into `docs/archive/aws-deployment/`. Keep `terraform/README.md` as the canonical deep AWS/Terraform reference. Move non-implemented FPKI DCR analysis into `docs/research/`.

Why: The AWS path remains valuable optional future infrastructure, but five root docs made it look active and fragmented. Root-level docs should tell agents what is current fast.

Consequences: No AWS knowledge deleted. Active docs now point to one future-path entry point plus one deep reference. Archived docs are retained but no longer compete for first-read attention.

Evidence: `pnpm docs:check:strict`.

**Decision Gist**: Preserve the future path; collapse the noisy root surface.

### D070: Security Console correctness hardening (2026-05-24)

Status: Accepted

Decision: Harden the localhost Security Console server and dashboard client without changing Cat 8 submission claims. Serialize probe/check jobs (409 when busy), replay SSE logs plus terminal `done` for late subscribers, escape finding fields in the drawer, confine narrative/evidence file reads to `my-docs/evidence/security-audit/`, return `activeLabel` from status saves, and sort `lastVerification` by newest `at` (not array tail).

Why: Parallel audit sub-agents found foundational issues: global log hijacking, stuck “running” UI, XSS in drawer `innerHTML`, path traversal on narratives, and stale active-backlog cells after triage updates.

Consequences: `pnpm security:probe:ci` remains the grader gate (not exposed in the console UI). Default probe scope stays 5 surfaces (v2 authorization); perimeter toggle documents 4-surface Cat 8 mode. No ledger row changes — behavior is reviewer/operator safety, not new evidence.

Evidence: `packages/shipshape-security/src/console/server.mjs`, `scripts/submission/security-dashboard/client.mjs`, `payload.mjs`, `lastVerification` test in `packages/shipshape-security/test/security-findings-store.test.mjs`.

**Decision Gist**: One job at a time, safe paths, honest SSE, escaped drawer, newest verification wins.

### D071: Console jobs via subprocess (2026-05-24)

Status: Accepted

Decision: All console probe/check/CI runs spawn child processes through `packages/shipshape-security/src/console/job-runner.mjs` instead of in-process `runProbe` (which calls `process.exit` and killed the server).

Why: Foundational correctness for a long-lived HTTP console.

Evidence: `job-runner.test.mjs`, `server.mjs` delegates to `runConsoleJob`.

**Decision Gist**: Never `process.exit` inside the console server process.

### D072: Console CI mirror + WebSocket logs + hot payload (2026-05-24)

Status: Accepted

Decision: Add `POST /api/run` mode `ci` (streams `run-ci.sh`), `GET /api/payload`, `POST /api/dashboard/regenerate` (render-dashboard only), and WebSocket `/api/run/:id/ws` (replaces SSE in client). Grader path remains `pnpm security:probe:ci`.

Why: Operator UX for preflight CI, faster evidence refresh without full `submission:render`, and stable log streaming.

Evidence: `server.mjs`, `client.mjs`, CI confirmation modal in security tab HTML.

**Decision Gist**: Console mirrors CI; grader command stays canonical.

### D073: Inline narrative edit API (2026-05-24)

Status: Accepted

Decision: `GET/PUT /api/findings/:id/narrative` with path confinement (`narrative-paths.mjs`) and shared `markdown-lite.mjs` for HTML render on save.

Why: Reviewers edit SS-FIND narratives without leaving the drawer; does not change probe pass/fail.

Evidence: `narrative-paths.test.mjs`, drawer edit flow in `client.mjs`.

**Decision Gist**: Safe narrative writes under audit evidence root only.

### D074: Deprecate Ink TUI (2026-05-24)

Status: Accepted

Decision: Remove `src/tui/App.mjs` and ink/react dependencies; `shipshape-security tui` prints migration steps and exits 1.

Why: Security Console is the primary interactive surface (D069); dual UIs drift.

Evidence: `tui.mjs` stub, README.

**Decision Gist**: Dashboard console only for interactive Cat 8 UX.

### D075: Vite console-ui scaffold (2026-05-24)

Status: Accepted

Decision: Add `packages/shipshape-security/console-ui/` (Vite + TS) built to `dist/`; console server serves `/console/*` when built. Embedded `client.mjs` remains the active dashboard integration until a full SPA cutover.

Why: Plan phase 6 — establish build pipeline without rewriting the entire reviewer dashboard as SPA in one step.

Evidence: `console-ui/dist`, `pnpm --filter @ship/shipshape-security build:console-ui`.

**Decision Gist**: Vite package is the migration target; embedded client ships features now.

### D076: Security Console audit hardening (2026-05-24)

Status: Accepted

Decision: Post-epic audit fixes: unified `job-queue.mjs` for probe/check/ci/regenerate (single mutex + serialized chain), `relative()` guard on console-ui static assets, auto-refresh reloads full page after hot payload fetch, WebSocket timeouts, drawer/CI modal focus hygiene, DRY `markdown-lite` + `safeNarrativePath` for dashboard payload build.

Why: Parallel review found regenerate could run parallel to probes, console-ui path prefix bypass, and incomplete hot reload leaving stale probe tables.

Evidence: `job-queue.test.mjs`, `job-stream.test.mjs`, `payload.mjs` imports package path helpers.

**Decision Gist**: One queue for all console jobs; reload beats partial DOM patch for auto-refresh.
