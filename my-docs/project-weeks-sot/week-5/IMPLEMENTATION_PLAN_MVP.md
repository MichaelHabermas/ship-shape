# FleetGraph MVP Implementation Plan

This is an execution checklist for Codex. It is organized as epics with small, reviewable slices. Each slice should be completed, verified, and status-updated before moving to the next slice unless the user explicitly redirects.

## Status Legend

`Not started` | `In progress` | `Blocked` | `Done` | `Deferred`

## Source Truth And Non-Negotiables

Treat `my-docs/project-weeks-sot/week-5/w5-specs/` as authoritative. Keep this plan aligned with `PRESEARCH.md`, `FLEETGRAPH.md`, `ARCHITECTURE.md`, `ARCHITECTURAL_DEFENSE.md`, `PRD-w5-MVP.md`, and `my-docs/MEMORY.md`.

FleetGraph MVP means one vertical slice: urgent/high active-week work with a real blocker signal becomes an action-ready FleetGraph finding, visible in Ship within 5 minutes, with on-demand explain/refine and a human gate.

Do not weaken these constraints:

- SQL candidate selection happens before model reasoning.
- The LLM never decides what to scan.
- Proactive and on-demand modes share one graph core.
- FleetGraph owns diagnosis state only: findings, runs, evidence snapshots, trace metadata, and drafts.
- Ship remains canonical for documents, issues, weeks, ownership, status, priority, associations, and content.
- No autonomous Ship mutation, external delivery, assignment, escalation, document edit, status/priority/week change, due date change, or risk acceptance.
- User-visible claims must be backed by evidence visible to that user.
- Shared traces must use seeded/demo-safe data.
- Do not add a new `document_type`.
- Do not invent `blocked` issue state or `critical` priority.
- Use `document_associations.relationship_type = 'sprint'` for week membership.
- Use `issue_iterations.blockers_encountered` for blocker signals.
- If Ship has no explicit commitment marker, say "urgent/high active-week work," not committed work.
- FleetGraph implementation is not done unless detector, graph, and decision-packet behavior are covered by golden cases, labeled scenarios, and trace/error review.

## Locked Decisions

- MVP proactive surface: active-week banner.
- Worker model: API-process polling every 2 minutes behind `FLEETGRAPH_WORKER_ENABLED=true`.
- Persistence: dedicated `fleetgraph_findings` and `fleetgraph_runs`.
- Tracing: LangGraph + LangSmith unless blocked; equivalent reviewer-shareable trace links are acceptable per advisor clarification.
- Trace target: four traces, exceeding the minimum.
- MVP excludes snooze, global inbox, external delivery, approved Ship mutations, multiple detectors, DB lease, event bus, director rollups, and broad workspace chat.
- Empty worker ticks must spend zero LLM tokens.
- No staging, unstaging, or commits without explicit instruction.

## Specialist Review Already Used

Spec traceability, backend architecture, UX/design, and verification lanes were reviewed and released. Their conclusions are folded into the slices below.

## Epic 0: Preparation And Guardrails

**Status:** Done

**Goal:** Set the rules of engagement before implementation so Codex does not drift, mutate the wrong surfaces, or lose the Week 5 source truth.

### Slice 0.1: Pin The Source Truth

**Status:** Done

**Do:**

- Read the smallest applicable context profile before implementation work.
- Read the Week 5 source docs needed for the current slice.
- State the MVP detector, non-goals, human gate boundary, and source-truth docs before editing code.

**Done Means:**

- Codex can describe the FleetGraph MVP loop without reopening the whole plan.
- The current slice references the source docs it depends on.

**Evidence:**

- Short implementation note in the working response or slice handoff.

**Implementation Note (2026-05-25):** Source truth read for this slice: `docs/context-manifest.md`, `w5-specs/Week-5-GFA-FleetGraph-PRD.txt`, `w5-specs/Advisor-followup-week-5.md`, `PRESEARCH.md`, `FLEETGRAPH.md`, `ARCHITECTURE.md`, `ARCHITECTURAL_DEFENSE.md`, and `my-docs/MEMORY.md`. FleetGraph MVP is the blocked urgent/high active-week issue loop: deterministic SQL candidate selection first, one shared graph for proactive and on-demand paths, FleetGraph-owned findings/runs/drafts/traces only, permission-filtered evidence, visible finding within 5 minutes, and a human gate before any Ship mutation or communication.

### Slice 0.2: Lock Repo Workflow Rules

**Status:** Done

**Do:**

- Confirm no staging, unstaging, or commits will happen without explicit instruction.
- Confirm existing tables are changed through numbered migrations, not `api/src/db/schema.sql`.
- Confirm destructive API tests use `DATABASE_URL=.../ship_test_audit`, never `ship_dev`.

**Done Means:**

- Implementation starts with the correct repo safety boundaries.

**Evidence:**

- No staged files or commits are created during implementation unless explicitly requested.

**Implementation Note (2026-05-25):** Repo workflow rules confirmed before code implementation: do not stage, unstage, or commit without explicit instruction; do not modify `api/src/db/schema.sql` for existing tables; use numbered migrations for FleetGraph persistence; destructive API tests must use `DATABASE_URL=.../ship_test_audit`, never `ship_dev`. Current repo state was clean at slice start; no git index operation was performed for this slice.

### Slice 0.3: Apply File Summary Rule

**Status:** Done

**Do:**

- For each changed code file, ensure the top of the file has a truthful 1-2 line file intent comment when the local convention allows it.
- Do not add noisy comments to files where the convention clearly avoids them.

**Done Means:**

- Changed code files are understandable at a glance without comment spam.

**Evidence:**

- Final diff review confirms the rule was applied only where appropriate.

**Implementation Note (2026-05-25):** Final diff review for this slice found no changed code files (`.ts`, `.tsx`, `.js`). The rule is active for future slices: when a code file is changed, check the first lines for a truthful 1-2 line file intent comment, update or add one only when local convention allows it, and do not add comments to untouched files.

## Epic 1: FleetGraph State And Configuration

**Status:** Done

**Goal:** Create the smallest durable FleetGraph-owned state and isolate graph/tracing dependencies from the rest of Ship.

**Closeout Note (2026-05-25):** Epic 1 is closed. FleetGraph graph/tracing dependencies are scoped to the API package; worker config is inert by default; migration `042_fleetgraph.sql` creates only `fleetgraph_findings` and `fleetgraph_runs`; DB guards enforce same-workspace issue/sprint references and suppress stale FleetGraph findings without blocking Ship document changes; persistence helpers write only FleetGraph-owned state and derive the locked blocked-work dedupe key. Verification covered docs strict check, type-check, API tests against `ship_test_audit`, build, migration apply/schema inspection, focused config tests, focused persistence tests, DB-backed FleetGraph guard tests, and `git diff --check`.

### Slice 1.1: Add FleetGraph Dependencies

**Status:** Done

**Do:**

- Add FleetGraph dependencies only to `api/package.json`.
- Keep LangGraph and tracing imports under `api/src/fleetgraph/*`.
- Avoid introducing dependencies outside the graph/tracing need.

**Done Means:**

- Dependency additions are scoped to the API package.
- Existing web/shared packages do not import FleetGraph graph dependencies.

**Evidence:**

- Package diff shows only necessary API dependency changes.

**Implementation Note (2026-05-25):** Verified FleetGraph graph/tracing dependencies are scoped to `api/package.json`: `@langchain/langgraph` and `langsmith` are present in the API package and lockfile, with no matching dependency in `web/package.json` or `shared/package.json`. Current repo search found no LangGraph/LangSmith imports outside package metadata, so future graph code can keep imports isolated under `api/src/fleetgraph/*`. No code files were changed in this slice.

### Slice 1.2: Add Environment Configuration

**Status:** Done

**Do:**

- Add `FLEETGRAPH_WORKER_ENABLED=false` as the default behavior.
- Add tracing/model configuration only where the API config pattern expects it.
- Keep the worker off unless explicitly enabled.

**Done Means:**

- Local startup does not begin proactive scanning by default.
- Empty worker ticks can be represented without model cost.

**Evidence:**

- Config test, startup smoke, or direct config inspection.

**Implementation Note (2026-05-25):** Added `api/src/config/fleetgraph.ts` with inert FleetGraph env parsing. `FLEETGRAPH_WORKER_ENABLED` defaults to disabled unless set to `true` or `1`; `FLEETGRAPH_WORKER_INTERVAL_MS` defaults to `120000`; model/tracing settings are parsed but do not start graph work. Updated `api/.env.example` with FleetGraph defaults and added focused config tests.

### Slice 1.3: Add FleetGraph Migration

**Status:** Done

**Do:**

- Add numbered migration `042_fleetgraph.sql`.
- Create only `fleetgraph_findings` and `fleetgraph_runs`.
- Store finding state, evidence snapshots, draft content, trace metadata, run decisions, timing, and token/cost metadata when available.

**Done Means:**

- Fresh and already-migrated local databases can run migrations cleanly.
- No new FleetGraph document type exists.
- No unnecessary extra tables exist.

**Evidence:**

- Migration command output.
- Schema inspection or targeted persistence test.

**Implementation Note (2026-05-25):** Added numbered migration `042_fleetgraph.sql` with only `fleetgraph_findings` and `fleetgraph_runs`. The schema keeps Ship canonical by validating source issue/week references, suppressing stale active findings after source document invalidation, and storing FleetGraph-owned evidence snapshots, draft content, human-gate metadata, trace/run/token/cost/error metadata, and run decisions. Open-finding dedupe is enforced by a partial unique index on `dedupe_key` for open/needs-confirmation/error findings.

### Slice 1.4: Add Persistence Helpers

**Status:** Done

**Do:**

- Add focused read/write helpers for findings and runs.
- Support proactive create, duplicate/update, quiet exit, explain, refine, dismiss, resolve, and error runs.
- Use the open-finding dedupe key `blocked-important-issue:{workspace_id}:{issue_id}:{sprint_id}`.

**Done Means:**

- The two tables can represent every MVP run/finding state.
- Dismiss and refine update only FleetGraph-owned state.

**Evidence:**

- Targeted API/unit tests or direct helper tests.

**Implementation Note (2026-05-25):** Added `api/src/fleetgraph/persistence.ts` with focused helpers for the locked blocked-work dedupe key, scoped open-finding lookup, blocked-important-issue finding create/update, draft refinement, dismiss, resolve, and run recording. Helpers accept a generic query runner, write only `fleetgraph_findings` / `fleetgraph_runs`, and keep Ship source records untouched. Added focused unit tests plus DB-backed FleetGraph guard tests.

## Epic 2: Deterministic Candidate Detection

**Status:** Done

**Goal:** Prove the proactive detector with cheap, testable SQL before any model reasoning.

**Closeout Note (2026-05-25):** Epic 2 is closed. FleetGraph now has deterministic detector semantics before any graph/model reasoning: active-week resolution reuses Ship's `workspaces.sprint_start_date` + `properties.sprint_number` model, positive candidates come from SQL over real Ship issue/week/iteration tables, quiet exits are classified and can be recorded with zero model calls/cost when the worker/graph invokes the recorder, open findings dedupe through the locked `blocked-important-issue:{workspace_id}:{issue_id}:{sprint_id}` key, and a read-only manual command (`pnpm fleetgraph:detector -- --workspace-id <uuid>`) avoids waiting for the two-minute worker loop. Verification covered docs strict check, type-check, build, diff hygiene, focused FleetGraph tests, DB-backed positive/negative detector controls, DB-backed quiet-exit classification, DB-backed dedupe proof, DB-backed manual no-write proof, manual command smoke against a migrated disposable DB, and the full API suite.

### Slice 2.1: Confirm Active-Week Semantics

**Status:** Done

**Do:**

- Read the existing week routes/query code before implementing detector SQL.
- Confirm active week membership uses `document_associations.relationship_type = 'sprint'`.
- Do not invent a FleetGraph-only active-week concept.

**Done Means:**

- Detector implementation follows existing Ship week semantics.

**Evidence:**

- Code reference in implementation notes or test fixture setup.

**Implementation Note (2026-05-25):** Confirmed Ship active-week semantics (`workspaces.sprint_start_date`, `document_associations.relationship_type = 'sprint'`, `issue_iterations.blockers_encountered`). See `api/src/routes/weeks/sprints.ts` and `api/src/fleetgraph/current-week.ts`.

### Slice 2.2: Implement Positive Candidate Query

**Status:** Done

**Do:**

- Select only issue documents.
- Require priority `urgent` or `high`.
- Exclude state `done` and `cancelled`.
- Require fallback ownership/assignee if no stronger commitment marker exists.
- Require active-week membership via `relationship_type = 'sprint'`.
- Require latest relevant `issue_iterations.blockers_encountered` text to be non-empty.

**Done Means:**

- A qualifying candidate is found deterministically from database state.

**Evidence:**

- Targeted detector test or manual invocation with seeded data.

**Implementation Note (2026-05-25):** `api/src/fleetgraph/current-week.ts` + positive candidate SQL in `api/src/fleetgraph/detector.ts` (urgent/high, active week, latest blocker text, dedupe key on each row).

### Slice 2.3: Implement Quiet Exits

**Status:** Done

**Do:**

- Quiet-exit inactive week, no blocker, medium/low priority, done/cancelled, missing fallback owner/assignee, duplicate open finding, and insufficient visible evidence.
- Record quiet exits without model calls when useful for traceability.

**Done Means:**

- Negative controls do not call the LLM.
- Quiet paths are distinguishable enough for debugging and trace review.

**Evidence:**

- Targeted detector tests proving zero model calls.

**Implementation Note (2026-05-25):** Quiet-exit SQL + `recordBlockedImportantIssueQuietExitRun` in `api/src/fleetgraph/detector.ts` (zero model calls/cost, no Ship mutations).

### Slice 2.4: Implement Dedupe

**Status:** Done

**Do:**

- Use the exact dedupe key `blocked-important-issue:{workspace_id}:{issue_id}:{sprint_id}`.
- Suppress or update when an open finding already exists.
- Do not create duplicate open findings.

**Done Means:**

- Re-running the detector against the same source does not create duplicate open findings.

**Evidence:**

- Dedupe test or manual two-run proof.

**Implementation Note (2026-05-25):** `detectBlockedImportantIssueDecisions` returns `create_finding` / `update_finding` decisions with locked dedupe key; DB partial unique index is the final guard.

### Slice 2.5: Add Manual Detector Invocation

**Status:** Done

**Do:**

- Provide a safe internal/manual invocation path for tests and demos.
- Avoid waiting for the two-minute worker loop during validation.

**Done Means:**

- Detector can be invoked manually without enabling the worker.

**Evidence:**

- Test helper, dev/admin path, or local script output.

**Implementation Note (2026-05-25):** `pnpm fleetgraph:detector -- --workspace-id <uuid> [--today YYYY-MM-DD] [--limit N]` via `api/src/scripts/fleetgraph-detector.ts` and `api/src/fleetgraph/manual-detector.ts` (read-only; no worker, findings, runs, or model).

## Epic 3: FleetGraph Eval Harness

**Status:** Done

**Goal:** Make FleetGraph measurable before graph behavior is built.

**Closeout Note (2026-05-26):** Epic 3 is closed. Graph contract lives in `api/src/fleetgraph/eval/` (see slice notes below). Verification: focused eval Vitest and root type-check.

### Slice 3.1: Define Golden Case Format

**Status:** Done

**Do:**

- Define the case fields: input state or fixture, graph mode, expected decision, required evidence, forbidden claims, and mutation boundary.
- Keep the format easy to extend as graph paths appear.

**Done Means:**

- New cases can be added without inventing structure each time.

**Evidence:**

- Golden case file or documented case schema.

**Implementation Note (2026-05-26):** Added `api/src/fleetgraph/eval/types.ts` with the golden-case contract: mode, input state, expected decision, required evidence, forbidden claims, mutation/model/trace boundaries, labels, and rubric expectations. Decisions align to existing FleetGraph run decisions.

### Slice 3.2: Add Golden Cases

**Status:** Done

**Do:**

- Add 10-15 high-quality cases.
- Cover proactive create, inactive-week quiet exit, medium/low quiet exit, done/cancelled quiet exit, no-blocker quiet exit, duplicate update/suppress, existing finding explanation, draft refinement, restricted evidence, and human-gated action preparation.

**Done Means:**

- Graph implementation slices can cite the cases they satisfy.

**Evidence:**

- Golden case list committed to the repo or test fixture set.

**Implementation Note (2026-05-26):** Added 15 cases in `api/src/fleetgraph/eval/golden-cases.ts`, covering proactive create/update/resolve, inactive-week, medium/low, done/cancelled, no-blocker, existing-finding explain, draft refinement, restricted neighbor/source/recipient evidence, human-gated action preparation, dismiss, and context-fetch error behavior.

### Slice 3.3: Add Scenario Labels And Coverage Matrix

**Status:** Done

**Do:**

- Label cases by mode, graph branch, action class, evidence quality, permission state, and difficulty.
- Maintain a coverage matrix so branch gaps are visible.

**Done Means:**

- Missing graph coverage is visible before implementation proceeds too far.

**Evidence:**

- Coverage matrix in test/docs form.

**Implementation Note (2026-05-26):** Added labels by mode, branch, action class, evidence quality, permission state, and difficulty, plus `api/src/fleetgraph/eval/coverage.ts` with required MVP branch coverage and case IDs. Eval tests now enforce mode/branch label consistency.

### Slice 3.4: Add Decision-Packet Rubric

**Status:** Done

**Do:**

- Score groundedness, recipient fit, uncertainty honesty, draft usefulness, action safety, and human-gate clarity.
- Define pass/fail thresholds before graph work proceeds.

**Done Means:**

- Subjective decision quality is measurable instead of vibes-based.

**Evidence:**

- Rubric file or test-support document with thresholds.

**Implementation Note (2026-05-26):** Added `api/src/fleetgraph/eval/rubric.ts` with deterministic 0-4 thresholds for groundedness, recipient fit, uncertainty honesty, draft usefulness, action safety, and human-gate clarity. Groundedness, action safety, and human-gate clarity are required at the highest threshold for human-gated decisions.

### Slice 3.5: Add Trace Review Taxonomy

**Status:** Done

**Do:**

- Use first-failure categories: detector, scope resolution, evidence filtering, recipient selection, reasoning, draft quality, UI/gate, trace safety, and trace/cost metadata.

**Done Means:**

- Trace failures can be classified consistently during review.

**Evidence:**

- Taxonomy documented beside the eval pack.

**Implementation Note (2026-05-26):** Added `api/src/fleetgraph/eval/trace-taxonomy.ts` with first-failure categories for detector, scope resolution, evidence filtering, recipient selection, reasoning, draft quality, UI/gate, trace safety, and trace/cost metadata.

## Epic 4: Shared FleetGraph Core

**Status:** Done

**Goal:** Implement one shared graph core with distinct proactive and on-demand paths.

**Closeout Note (2026-05-26):** Epic 4 is closed. `api/src/fleetgraph/core.ts` now exposes the shared `runFleetGraph` boundary for proactive and on-demand triggers, with bounded evidence assembly in `evidence.ts`, reviewer-safe trace metadata in `trace.ts`, and an opt-in proactive-create model adapter in `model.ts`. The core consumes detector decisions, persists only FleetGraph findings/runs/drafts/status/trace metadata through persistence helpers, re-filters on-demand evidence for the current principal, and records zero model calls for quiet/explain/refine/update paths. Verification: root type-check, build, docs strict/path checks, focused FleetGraph unit/eval tests, full FleetGraph test lane against `ship_test_audit`, and read-only detector smoke against local `ship_dev` workspace `d39a32f2-297c-40c2-b43b-efa6296c9571`.

### Slice 4.1: Add Narrow Graph Interface

**Status:** Done

**Do:**

- Add a local interface such as `runFleetGraph(input)`.
- Keep routes and worker code unaware of LangGraph internals.
- Normalize proactive and on-demand triggers at the graph boundary.

**Done Means:**

- API routes and worker can call one stable interface.

**Evidence:**

- Type-level API or focused unit test.

**Implementation Note (2026-05-26):** Added `api/src/fleetgraph/types.ts` and `api/src/fleetgraph/core.ts` with `runFleetGraph(input)`, typed trigger/result contracts, decision packets, evidence items, trace/token/cost metadata, and an injectable persistence port. LangGraph/model internals remain behind this FleetGraph core boundary.

### Slice 4.2: Resolve Scope And Fetch Context

**Status:** Done

**Do:**

- Start from a bounded source object.
- Fetch only the context needed to decide whether the finding is actionable.
- Do not turn the graph into a broad workspace assistant.

**Done Means:**

- Graph inputs produce bounded evidence bundles.

**Evidence:**

- Golden cases exercising scope resolution.

**Implementation Note (2026-05-26):** Added bounded context assembly for detector candidates and existing findings. Epic 4 scope is issue/sprint/finding only; there is no broad workspace assistant, conversation memory, new document type, or graph-owned source-of-truth state.

### Slice 4.3: Filter Visible Evidence

**Status:** Done

**Do:**

- Filter evidence to claims visible to the current user.
- Return restricted/no-safe-output behavior when needed.
- Never expose raw prompts or hidden evidence.

**Done Means:**

- User-visible claims are backed by evidence visible to that user.

**Evidence:**

- Restricted evidence golden case and authorization test.

**Implementation Note (2026-05-26):** Added `filterEvidenceForActor`, which reuses the existing capability/document-access path through `authorize()` for source issue and sprint reads. Hidden source issues produce no-safe-output with restricted evidence and no hidden excerpt/ID/title leakage. Proactive stored evidence stays least-privileged-safe for authorized source-issue viewers.

### Slice 4.4: Implement Proactive Create Path

**Status:** Done

**Do:**

- Convert a qualifying detector candidate into a decision packet.
- Persist the FleetGraph finding and run metadata.
- Include evidence, summary, severity, confidence, recommended next human action class, draft message, recipient/role rationale, uncertainty notes, trace metadata, and human gate state.

**Done Means:**

- A qualifying candidate becomes an action-ready finding.

**Evidence:**

- Golden case pass and persisted finding inspection.

**Implementation Note (2026-05-26):** `runFleetGraph` converts `create_finding` detector decisions into human-gated decision packets with severity, confidence, summary, recommended action, draft unblock message, recipient role rationale, uncertainty notes, safe trace metadata, and run metadata. Real proactive-create model calls are opt-in via `FLEETGRAPH_REAL_MODEL_ENABLED=true` plus model/API-key config; local tests use deterministic zero-token output.

### Slice 4.5: Implement Update/Suppress And Quiet Paths

**Status:** Done

**Do:**

- Support duplicate/update, suppress, resolved/quiet, and error paths.
- Persist run decisions without creating inappropriate findings.

**Done Means:**

- Non-create proactive paths are explicit and testable.

**Evidence:**

- Golden cases for duplicate/update and quiet exit.

**Implementation Note (2026-05-26):** `runFleetGraph` supports duplicate `update_finding`, quiet exits, status-only dismiss/resolve, suppress helper support, and error runs. Non-create paths record explicit run decisions and do not create duplicate open findings or mutate Ship source tables.

### Slice 4.6: Implement Explain Existing Finding

**Status:** Done

**Do:**

- Answer why a finding was flagged from existing finding state and visible evidence.
- Do not require the user to restate page context.

**Done Means:**

- On-demand explain produces grounded output for an existing finding.

**Evidence:**

- Golden case and trace for "why was this flagged?"

**Implementation Note (2026-05-26):** On-demand explain reads existing FleetGraph finding state, re-filters stored evidence for the current principal when provided, returns no-safe-output for restricted source issues, and records an `explain` run with zero model calls.

### Slice 4.7: Implement Draft Refinement

**Status:** Done

**Do:**

- Refine only FleetGraph-owned draft content.
- Preserve the human gate.
- Do not mutate source issue/week/project/program data.

**Done Means:**

- Draft refinement changes the FleetGraph draft and nothing canonical in Ship.

**Evidence:**

- Golden case and persistence test.

**Implementation Note (2026-05-26):** Draft refinement updates only `fleetgraph_findings.draft_content`, keeps `human_gate.required = true`, and records a `refine_draft` run. If the actor cannot read the source issue, refine records a restricted quiet exit and does not update draft content. No Ship issue, sprint, association, comment, ownership, status, or priority fields are written.

### Slice 4.8: Capture Trace Metadata

**Status:** Done

**Do:**

- Capture trace links or equivalent reviewer-shareable trace identifiers.
- Capture token/cost metadata when available.
- Make proactive and on-demand traces visibly different.

**Done Means:**

- Trace evidence can support reviewer inspection and failure classification.

**Evidence:**

- Trace metadata visible in run records.

**Implementation Note (2026-05-26):** Added reviewer-safe trace metadata helpers that persist mode, decision, node path, optional trace ID/URL, and optional failure category. Proactive create/update, quiet exit, explain, refine, dismiss/resolve, and error paths have distinct node paths. API trace serialization is allowlist-based and omits raw prompts/completions, hidden evidence, tokens, nested payloads, and contact details.

## Epic 5: API Surface And OpenAPI

**Status:** In progress

**Goal:** Expose FleetGraph through authenticated, documented, capability-aware API routes.

**Progress Note (2026-05-26):** Follow-up work after Epic 4 added executable golden cases and the first FleetGraph API surface: `GET /api/fleetgraph/findings`, `POST /api/fleetgraph/findings/:findingId/explain`, and `POST /api/fleetgraph/findings/:findingId/refine`. Routes call the shared `runFleetGraph`/visible-evidence boundary, serialize actor-filtered output, omit no-safe-output findings/IDs rather than returning partial hints, sanitize trace metadata before response, and are registered in OpenAPI. Dismiss and gated manual run endpoints remain not started.

### Slice 5.1: Add Route Shell And OpenAPI Registration

**Status:** Done

**Do:**

- Add `/api/fleetgraph` routes behind auth/CSRF.
- Register routes with OpenAPI.
- Use explicit request/response types for web consumption.

**Done Means:**

- OpenAPI coverage remains complete.

**Evidence:**

- `pnpm openapi:check` or targeted OpenAPI test.

**Implementation Note (2026-05-26):** Added `api/src/routes/fleetgraph.ts`, mounted it at `/api/fleetgraph`, imported it into OpenAPI side-effect registration, regenerated `api/openapi.json`, `api/openapi.yaml`, and `web/src/api/generated/ship-openapi.d.ts`. `pnpm openapi:check:strict` reports 197 runtime routes / 197 OpenAPI routes.

### Slice 5.2: Add Findings Read Route

**Status:** Done

**Do:**

- Read findings by active-week/source context.
- Require source issue and active week visibility.
- Prevent cross-workspace access.

**Done Means:**

- Authorized users can read accessible findings.
- Unauthorized/cross-workspace users cannot.

**Evidence:**

- Route auth/visibility tests.

**Implementation Note (2026-05-26):** Added `GET /api/fleetgraph/findings?sourceIssueId=...|sourceSprintId=...`, which lists active findings by source and serializes visible output through `visibleOutputForFinding` for the current principal. No-safe-output findings are omitted from list responses so hidden source issue IDs and dedupe keys are not enumerable. Route tests cover actor-filtered output shape and restricted-source omission.

### Slice 5.3: Add Explain Route

**Status:** Done

**Do:**

- Authorize the current context document before graph context fetch.
- Call the shared graph interface.
- Return grounded explain output without raw prompts/completions.

**Done Means:**

- A user can ask why the finding was flagged from context.

**Evidence:**

- Route test and golden case alignment.

**Implementation Note (2026-05-26):** Added `POST /api/fleetgraph/findings/:findingId/explain`, which calls `runFleetGraph` with an on-demand `explain_finding` trigger and returns sanitized trace metadata plus visible output. Restricted-source explain returns quiet/no-safe-output without serializing the finding object or hidden source identifiers. Executable golden cases now prove visible explain and restricted-source quiet/no-safe-output behavior.

### Slice 5.4: Add Refine Route

**Status:** Done

**Do:**

- Authorize current context.
- Call the shared graph interface.
- Update only FleetGraph-owned draft content.

**Done Means:**

- Refine never mutates source issue/week documents.

**Evidence:**

- Route test proving source document fields are unchanged.

**Implementation Note (2026-05-26):** Added `POST /api/fleetgraph/findings/:findingId/refine`, which accepts only a bounded draft-refinement instruction and calls `runFleetGraph` with `refine_draft`. Restricted-source refine exits quietly without updating draft state or returning finding identifiers. Route tests prove the API remains decision-oriented rather than arbitrary workspace chat; core tests prove visible refine only updates FleetGraph draft state.

### Slice 5.5: Add Dismiss Route

**Status:** In progress

**Do:**

- Update only FleetGraph finding status.
- Do not accept risk or resolve/mutate source Ship objects.

**Done Means:**

- Dismiss removes the actionable finding from UI without altering canonical Ship state.

**Evidence:**

- Route test.

### Slice 5.6: Add Gated Manual Run Endpoint

**Status:** Not started

**Do:**

- Add a safely gated dev/admin manual run endpoint for tests and demos.
- Ensure it is not publicly usable in production.

**Done Means:**

- Manual runs are available for validation without weakening production security.

**Evidence:**

- Environment/authorization test.

### Slice 5.7: Prove API Security Boundary

**Status:** Not started

**Do:**

- Test unauthenticated, cross-workspace, restricted source, dismiss, refine, and on-demand paths.
- Use the repo capability model instead of route-local shortcuts.

**Done Means:**

- The API surface is capability-aware and documented.

**Evidence:**

- Targeted route tests and OpenAPI check.

**Implementation Note (2026-05-26):** Partial proof is in place for authenticated route wiring, bounded on-demand explain/refine, actor-visible response serialization, executable restricted-source golden case, trace sanitization, and OpenAPI parity. Remaining API security proof should cover unauthenticated/cross-workspace behavior with DB-backed route tests when dismiss/manual-run endpoints are added.

## Epic 6: Worker Lifecycle

**Status:** Not started

**Goal:** Run the proactive detector without a user present while keeping lifecycle and shutdown clean.

### Slice 6.1: Add Disabled-By-Default Worker

**Status:** Not started

**Do:**

- Add `startFleetGraphWorker()` returning a cleanup function.
- Start only with `FLEETGRAPH_WORKER_ENABLED=true`.
- Avoid module-level orphan intervals.

**Done Means:**

- Worker is off by default and opt-in only.

**Evidence:**

- Startup/config test or local smoke.

### Slice 6.2: Add Manual One-Tick Function

**Status:** Not started

**Do:**

- Add a manual one-tick function for tests and demos.
- Reuse the same detector/graph path as the interval worker.

**Done Means:**

- Proactive behavior can be validated without waiting two minutes.

**Evidence:**

- Targeted worker test.

### Slice 6.3: Wire Detector To Graph

**Status:** Not started

**Do:**

- Invoke the deterministic detector first.
- Call the graph only for eligible candidates or due rechecks.
- Ensure empty ticks spend zero LLM tokens.

**Done Means:**

- Worker respects SQL-before-model architecture.

**Evidence:**

- Empty tick test proving no model call.

### Slice 6.4: Record Heartbeat, Runs, And Errors

**Status:** Not started

**Do:**

- Record heartbeat/run metadata.
- Record errors without crashing the API process.
- Keep enough detail to support trace/error review.

**Done Means:**

- Operational state is visible without making the worker fragile.

**Evidence:**

- Worker error-path test or manual smoke.

### Slice 6.5: Prove Shutdown And Five-Minute Budget

**Status:** Not started

**Do:**

- Stop the worker cleanly during API shutdown.
- Verify a proactive finding can appear within the 5-minute budget.
- Reconsider DB lease if deployment uses multiple API instances.

**Done Means:**

- Worker lifecycle is clean and MVP latency is proven.

**Evidence:**

- Timed proof timestamps or lifecycle test.

## Epic 7: Product Surface

**Status:** Not started

**Goal:** Make FleetGraph proactive and contextual without building a standalone chatbot or global dashboard.

### Slice 7.1: Add Web Client API

**Status:** Not started

**Do:**

- Add typed client calls for findings read, explain, refine, dismiss, and manual run only if needed in dev.
- Reuse existing web API patterns.

**Done Means:**

- UI components do not hand-roll fetch behavior.

**Evidence:**

- Type-check and focused client test if local pattern supports it.

### Slice 7.2: Add Active-Week Banner

**Status:** Not started

**Do:**

- Show the banner only for open actionable active-week findings.
- Link to the affected context.
- Avoid a standalone `/fleetgraph` dashboard or global inbox.

**Done Means:**

- A PM can discover the finding from active-week context without knowing which issue to open first.

**Evidence:**

- Web test or browser smoke.

### Slice 7.3: Add Contextual Finding Card

**Status:** Not started

**Do:**

- Show what happened, why it matters, evidence, severity, confidence, recommended next action, recipient rationale, uncertainty, draft, safe trace metadata, and human gate state.
- Handle issue/week context surfaces.

**Done Means:**

- A user can understand why FleetGraph flagged the issue from context.

**Evidence:**

- Web test or browser smoke.

### Slice 7.4: Add Explain Interaction

**Status:** Not started

**Do:**

- Let the user ask why the finding was flagged.
- Preserve page context without requiring restatement.
- Display grounded answers only.

**Done Means:**

- On-demand explain works in the page context.

**Evidence:**

- Web/API integration test or browser smoke.

### Slice 7.5: Add Draft Refinement Interaction

**Status:** Not started

**Do:**

- Let the user refine the draft.
- Make clear that refinement changes only FleetGraph draft state.

**Done Means:**

- Draft refinement is visible without implying anything was sent or changed in Ship.

**Evidence:**

- Web/API integration test or browser smoke.

### Slice 7.6: Add Human Gate

**Status:** Not started

**Do:**

- Show exact proposed action, exact recipient or role, exact draft text, affected objects, evidence, why approval is required, and the blocked consequence if execution is not implemented.
- Never imply something was sent, posted, moved, or updated when it was not.

**Done Means:**

- The UI clearly blocks Ship mutation or communication until approved.

**Evidence:**

- Web test or browser smoke.

### Slice 7.7: Add UI States And Accessibility Basics

**Status:** Not started

**Do:**

- Handle loading, empty, error, restricted, dismissed, and accessible keyboard states.
- Keep UI contextual, not decorative.

**Done Means:**

- Basic user states are handled without building extra product surfaces.

**Evidence:**

- Web tests and browser smoke.

## Epic 8: Demo Data And Reviewer Readiness

**Status:** Not started

**Goal:** Make the MVP reproducible for local validation, timed proof, trace capture, and reviewer navigation.

### Slice 8.1: Add Repeatable Demo Setup

**Status:** Not started

**Do:**

- Create a realistic, submission-safe execution graph without truncating or corrupting `ship_dev`.
- Include active week, program, project, people roles, urgent/high active-week blocked issues, ownership metadata, and stable reviewer URLs.

**Done Means:**

- Fresh local/demo environment can produce the happy path.

**Evidence:**

- Demo setup output and stable URLs.

### Slice 8.2: Add Demo Universe

**Status:** Not started

**Do:**

- Include engineer/builder, PM/project owner, active week owner, program lead/director, and dependency/context source.
- Include at least two urgent/high active-week issues with recent blocker iteration text.
- Include one blocker that names a dependency or decision-maker.

**Done Means:**

- Demo data looks like real Ship work, not artificial unit-test dust.

**Evidence:**

- Seed/demo inspection or reviewer navigation.

### Slice 8.3: Add Negative Controls

**Status:** Not started

**Do:**

- Include inactive week, no blocker, medium/low blocker, done/cancelled urgent/high blocker, duplicate open finding, and private/restricted source case.

**Done Means:**

- Quiet paths can be demonstrated from demo data.

**Evidence:**

- Detector/graph run output showing quiet paths.

### Slice 8.4: Capture Reviewer Traces

**Status:** Not started

**Do:**

- Capture four trace links: proactive create, on-demand why flagged, on-demand draft refinement, and proactive duplicate/update or quiet exit.
- Ensure traces show different graph paths.
- Use seeded/demo-safe data only.

**Done Means:**

- Reviewer trace evidence is ready.

**Evidence:**

- Trace links added to `FLEETGRAPH.md` once implementation evidence exists.

### Slice 8.5: Prepare Reviewer Navigation

**Status:** Not started

**Do:**

- Ensure reviewer can navigate to stable issue/week URLs.
- Ensure demo data produces no duplicate open findings unless testing dedupe.

**Done Means:**

- Reviewer can reproduce the MVP path without private workspace data.

**Evidence:**

- Local validation notes or reviewer path checklist.

## Epic 9: Tests And Verification

**Status:** Not started

**Goal:** Prove the FleetGraph MVP contract without relying on full E2E in this pass.

### Slice 9.1: Add Detector Tests

**Status:** Not started

**Do:**

- Cover positive predicate and quiet paths.
- Cover duplicate suppression.
- Prove quiet exits make zero model calls.

**Done Means:**

- Detector behavior is deterministic and cheap.

**Evidence:**

- Targeted detector test output.

### Slice 9.2: Add Graph/Eval Tests

**Status:** Not started

**Do:**

- Run golden cases for create, update/suppress, quiet exit, explain, refine, restricted evidence, and human-gated action preparation.
- Apply the decision-packet rubric to representative create/explain/refine outputs.

**Done Means:**

- Graph decisions are measurable against the eval pack.

**Evidence:**

- Golden case and rubric output.

### Slice 9.3: Add API Tests

**Status:** Not started

**Do:**

- Cover auth, visibility, on-demand explain/refine, dismiss, manual run gating, and OpenAPI.
- Use `ship_test_audit` for destructive API tests.

**Done Means:**

- API behavior is secure and documented.

**Evidence:**

- Targeted API tests and `pnpm openapi:check`.

### Slice 9.4: Add Web Tests

**Status:** Not started

**Do:**

- Cover banner, card, explain/refine, human gate, and basic accessibility states.
- Full E2E can remain skipped for now if named honestly.

**Done Means:**

- UI behavior is proven beyond screenshots.

**Evidence:**

- Targeted web test output or browser smoke.

### Slice 9.5: Run Smoke Gates

**Status:** Not started

**Do:**

- Run `pnpm type-check`.
- Run `pnpm build`.
- Run `pnpm openapi:check`.
- Run `pnpm docs:check`.
- Run `pnpm docs:check:paths`.
- Run targeted API/web tests.

**Done Means:**

- Standard local gates pass or failures are named honestly.

**Evidence:**

- Command outputs summarized in handoff.

### Slice 9.6: Capture Timed Proof

**Status:** Not started

**Do:**

- Record blocker write timestamp, worker tick/run timestamp, graph decision timestamp, finding persisted timestamp, and UI/API visibility timestamp.
- Finding must be visible within 5 minutes.

**Done Means:**

- MVP latency claim is proven.

**Evidence:**

- Timed proof notes or trace metadata.

### Slice 9.7: Final Handoff

**Status:** Not started

**Do:**

- Update slice statuses.
- Add trace links/test cases to `FLEETGRAPH.md` once implementation evidence exists.
- Update `MEMORY.md` only for durable high-utility learnings.
- Report skipped verification honestly with reasons.

**Done Means:**

- Handoff is understandable and reproducible.

**Evidence:**

- Final implementation summary and changed-file diff.

## Approved 10x Ideas

- Deterministic detector before LLM: required by spec, cuts cost/noise, makes traces meaningful.
- Active-week banner as proactive surface: satisfies discoverability without creating a global inbox.
- Trace-first implementation: required for grading and prevents last-minute fake observability.
- FleetGraph Eval Pack before graph implementation: turns graph behavior from vibes into measurable golden cases, coverage, rubrics, and trace review.

## Deferred Ideas

- Hybrid event + polling trigger model: better long-term latency/cost, too much event plumbing for MVP.
- Project risk ledger with more detectors: correct product direction after blocked-work loop works.
- Agent-native project drift substrate where every document mutation emits typed graph facts: powerful, too big for Week 5 MVP.

## Final Handoff Standard

Before human handoff, `IMPLEMENTATION_PLAN_MVP.md` should show the current slice statuses, root submission deliverables (`PRESEARCH.md` and `FLEETGRAPH.md`) should be present or deliberately synced from `my-docs/project-weeks-sot/week-5/`, `FLEETGRAPH.md` should contain trace links/test cases once implementation evidence exists, `MEMORY.md` should be updated only for durable high-utility learnings, no code file should violate the summary-comment rule, no unrelated code should be changed, no staging/unstaging/commit should happen without explicit instruction, and verification should be reported honestly.
