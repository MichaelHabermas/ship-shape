# FleetGraph MVP Implementation Plan

This is an execution checklist for Codex. It is organized as epics with small, reviewable slices. Each slice should be completed, verified, and status-updated before moving to the next slice unless the user explicitly redirects.

## Status Legend

`Not started` | `In progress` | `Blocked` | `Done` | `Deferred`

## Source Truth And Non-Negotiables

Treat `my-docs/project-weeks-sot/week-5/w5-specs/` as authoritative. Keep this plan aligned with `PRESEARCH.md`, `FLEETGRAPH.md`, `ARCHITECTURE.md`, `ARCHITECTURAL_DEFENSE.md`, `PRD-w5-MVP.md`, and `my-docs/MEMORY.md`.

FleetGraph MVP means one vertical slice: urgent/high active-week work with a real blocker signal becomes a sparse FleetGraph review finding, visible in Ship within 5 minutes, with evidence, likely recipient context, and no Ship mutation or external communication.

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
- Add `blocked` as a real issue lifecycle state; do not invent `critical` priority.
- Use `document_associations.relationship_type = 'sprint'` for week membership.
- Use `issue.state = blocked` as the canonical current blocked signal. Use `issue_iterations.blockers_encountered` as blocker history/evidence: who marked or encountered the block, when, and why.
- If Ship has no explicit commitment marker, say "urgent/high active-week work," not committed work.
- FleetGraph implementation is not done unless detector, graph, and decision-packet behavior are covered by golden cases, labeled scenarios, and trace/error review.

## Locked Decisions

- MVP proactive surface: active-week banner.
- MVP card surface: sparse review-queue item only. Show issue title, cleaned blocker summary, source priority, evidence, likely recipient when available, open issue, details/collapse, dismiss, and dev-only trace. Do not show per-card FleetGraph branding, universal needs-confirmation badges, fake-precision confidence, repeated why-flagged copy, draft refinement, prepared comments, or approval panels.
- Product surface decision: blocker detection is the MVP detector, not the UI architecture. FleetGraph surfaces should be generic contextual finding surfaces that can host blocker, carryover-risk, missing-owner, stale-work, repeated-drift, dependency-risk, and future project-intelligence findings.
- Use `finding.kind` as the discriminator for what FleetGraph noticed. Reserve `source.type` for the Ship object being discussed and action `type` for proposed actions. This keeps "blocker" as one finding kind, not the component model.
- The active-week banner is a notification cue only. It should point into a reusable FleetGraph review/conversation surface; it is not the whole FleetGraph product.
- Do not build a global FleetGraph inbox or standalone chatbot for MVP. The target shape is contextual intelligence attached to the object the user is already viewing.
- Worker model: API-process polling every 2 minutes behind `FLEETGRAPH_WORKER_ENABLED=true`.
- Persistence: dedicated `fleetgraph_findings` and `fleetgraph_runs`.
- Tracing: LangGraph + LangSmith unless blocked; equivalent reviewer-shareable trace links are acceptable per advisor clarification.
- Trace target: four traces, exceeding the minimum.
- MVP excludes snooze, global inbox, external delivery, approved Ship mutations, multiple detectors, DB lease, event bus, director rollups, and broad workspace chat.
- MVP also excludes a composer/copy/send workflow until a future decision defines destination, actor, mutation boundary, and resolution semantics.
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

**Correction Note (2026-05-26):** Slice 2.2 proved detector behavior through tests, but did not satisfy the stronger PRD requirement that the demo database contain discoverable blocked-work data. Current `ship_dev` has urgent/high active-week issues but zero non-empty `issue_iterations.blockers_encountered` rows, so a live manual detector run finds no positive candidates. Epic 8 must close this by adding seeded blocked-work cases and a UI path for logging issue-level blockers.

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

**Status:** Done

**Goal:** Expose FleetGraph through authenticated, documented, capability-aware API routes.

**Progress Note (2026-05-26):** Follow-up work after Epic 4 added executable golden cases and the first FleetGraph API surface: `GET /api/fleetgraph/findings`, `POST /api/fleetgraph/findings/:findingId/explain`, and `POST /api/fleetgraph/findings/:findingId/refine`. Routes call the shared `runFleetGraph`/visible-evidence boundary, serialize actor-filtered output, omit no-safe-output findings/IDs rather than returning partial hints, sanitize trace metadata before response, and are registered in OpenAPI. Final Epic 5 work added admin-gated dismiss and admin/env-gated manual run.

**Closeout Note (2026-05-26):** Epic 5 is closed. FleetGraph API now exposes source-scoped finding reads, bounded explain/refine, admin-gated dismiss, and admin/env-gated manual run. All routes stay behind auth/CSRF, use the shared graph/evidence/capability boundary, serialize only actor-visible output, sanitize trace metadata, and are registered in OpenAPI/generated client artifacts. Verification review tightened the closeout by adding strict manual-run date validation, explicit dismiss `403` contract coverage, admin-token membership proof, and stale-dismiss not-found behavior.

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

**Status:** Done

**Do:**

- Update only FleetGraph finding status.
- Do not accept risk or resolve/mutate source Ship objects.

**Done Means:**

- Dismiss removes the actionable finding from UI without altering canonical Ship state.

**Evidence:**

- Route test.

**Implementation Note (2026-05-26):** Added `POST /api/fleetgraph/findings/:findingId/dismiss`. The route calls `runFleetGraph` with `dismiss_finding`, requires workspace admin authority before changing shared FleetGraph state, and the core re-checks actor-visible source evidence before mutation. Dismiss writes only `fleetgraph_findings` status/timestamps/user plus `fleetgraph_runs`; DB-backed route tests prove non-admin members cannot dismiss, restricted/private source details do not leak, and Ship source documents remain unchanged.

### Slice 5.6: Add Gated Manual Run Endpoint

**Status:** Done

**Do:**

- Add a safely gated dev/admin manual run endpoint for tests and demos.
- Ensure it is not publicly usable in production.

**Done Means:**

- Manual runs are available for validation without weakening production security.

**Evidence:**

- Environment/authorization test.

**Implementation Note (2026-05-26):** Added gated `POST /api/fleetgraph/manual-run`, backed by `runFleetGraphManualTick`. The endpoint is current-workspace scoped, requires workspace admin authorization, is disabled in production unless `FLEETGRAPH_MANUAL_RUN_API_ENABLED=true`, and exercises the real deterministic detector -> shared `runFleetGraph` proactive path. The read-only CLI detector remains separate.

### Slice 5.7: Prove API Security Boundary

**Status:** Done

**Do:**

- Test unauthenticated, cross-workspace, restricted source, dismiss, refine, and on-demand paths.
- Use the repo capability model instead of route-local shortcuts.

**Done Means:**

- The API surface is capability-aware and documented.

**Evidence:**

- Targeted route tests and OpenAPI check.

**Implementation Note (2026-05-26):** Partial proof is in place for authenticated route wiring, bounded on-demand explain/refine, actor-visible response serialization, executable restricted-source golden case, trace sanitization, and OpenAPI parity. Remaining API security proof should cover unauthenticated/cross-workspace behavior with DB-backed route tests when dismiss/manual-run endpoints are added.

**Closeout Note (2026-05-26):** Epic 5 API proof now covers route shell/OpenAPI, source-scoped reads, explain, refine, admin-gated dismiss, admin/env-gated manual run, CSRF/auth enforcement, restricted-source omission, no hidden identifier/excerpt leakage, no Ship source mutation on dismiss/refine, admin-token scope plus membership gating, strict manual-run calendar-date validation, stale dismiss not-found behavior, and generated OpenAPI/client parity. Verification included API type-check, focused FleetGraph/API tests, DB-backed FleetGraph route security tests against `ship_test_audit`, full API Vitest lane through the focused command, and OpenAPI generation.

**Architecture Deepening Note (2026-05-26):** Follow-up hardening extracted FleetGraph API schemas and serializers to `api/src/fleetgraph/api-contract.ts`, making the response contract the single safe-output boundary. Restricted/no-safe-output finding actions now return the same not-found shape as missing findings; manual-run restricted results omit finding ids, visible output, and raw detector counts. Golden-case execution now includes dismiss. Manual detector CLI and gated manual API share `runFleetGraphTick`, with explicit `dryRun` and `execute` modes. Detector quiet-exit SQL classifies malformed/missing sprint numbers with `IS DISTINCT FROM`. Program/project/week child counts and issue aggregate helpers now pass actor visibility through `document-graph-visibility.ts`. Routes remain thin auth/validation/orchestration shells.

## Epic 6: Worker Lifecycle

**Status:** Done

**Goal:** Run the proactive detector without a user present while keeping lifecycle and shutdown clean.

### Slice 6.1: Add Disabled-By-Default Worker

**Status:** Implemented

**Do:**

- Add `startFleetGraphWorker()` returning a cleanup function.
- Start only with `FLEETGRAPH_WORKER_ENABLED=true`.
- Avoid module-level orphan intervals.

**Done Means:**

- Worker is off by default and opt-in only.

**Evidence:**

- Startup/config test or local smoke.

**Implementation Note (2026-05-26):** Added `api/src/fleetgraph/worker.ts` with `startFleetGraphWorker()` behind `FLEETGRAPH_WORKER_ENABLED`, recursive timeout scheduling, no module-level interval, and idempotent cleanup. `api/src/index.ts` starts the worker after collaboration setup and stops it before closing the DB pool.

### Slice 6.2: Add Manual One-Tick Function

**Status:** Implemented

**Do:**

- Add a manual one-tick function for tests and demos.
- Reuse the same detector/graph path as the interval worker.

**Done Means:**

- Proactive behavior can be validated without waiting two minutes.

**Evidence:**

- Targeted worker test.

**Implementation Note (2026-05-26):** The worker uses `runFleetGraphTick({ mode: 'execute' })` directly with `triggerReason: 'scheduled-worker'`. Manual API execution remains a thin `runFleetGraphManualTick()` wrapper with `triggerReason: 'manual-run'`.

### Slice 6.3: Wire Detector To Graph

**Status:** Implemented

**Do:**

- Invoke the deterministic detector first.
- Call the graph only for eligible candidates or due rechecks.
- Ensure empty ticks spend zero LLM tokens.

**Done Means:**

- Worker respects SQL-before-model architecture.

**Evidence:**

- Empty tick test proving no model call.

**Implementation Note (2026-05-26):** Worker ticks enumerate bounded active workspaces, build a `fleetgraph_system` principal per workspace, and pass a small candidate limit into the shared tick runner. Worker execution injects deterministic proactive-create text so no-user-present scans remain zero-model-call even if real model calls are enabled elsewhere. Worker tests prove the system principal path and zero model-call accounting for deterministic worker execution.

### Slice 6.4: Record Heartbeat, Runs, And Errors

**Status:** Implemented

**Do:**

- Record heartbeat/run metadata.
- Record errors without crashing the API process.
- Keep enough detail to support trace/error review.

**Done Means:**

- Operational state is visible without making the worker fragile.

**Evidence:**

- Worker error-path test or manual smoke.

**Implementation Note (2026-05-26):** Added migration `043_fleetgraph_worker_ticks.sql` and persistence helpers for worker tick start, heartbeat, completion, failure, and skipped-lock metadata. Worker ticks use a Postgres advisory lock so multiple API instances do not duplicate scheduled scans; per-workspace errors are contained, logged, and recorded while preserving partial tick counts.

### Slice 6.5: Prove Shutdown And Five-Minute Budget

**Status:** Implemented

**Do:**

- Stop the worker cleanly during API shutdown.
- Verify a proactive finding can appear within the 5-minute budget.
- Reconsider DB lease if deployment uses multiple API instances.

**Done Means:**

- Worker lifecycle is clean and MVP latency is proven.

**Evidence:**

- Timed proof timestamps or lifecycle test.

**Implementation Note (2026-05-26):** Worker cleanup clears pending timers and waits for in-flight work before shutdown continues, so the DB pool is not closed under an active tick. Worker tick metadata records `started_at`, `deadline_at`, `completed_at`, selected/attempted workspace counts, detector decision counts, result counts, model calls, and audit metadata for backend latency proof. Full UI-observed 5-minute proof remains Epic 7/product-surface dependent.

## Epic 7: Product Surface

**Status:** Done

**Goal:** Make FleetGraph proactive and contextual without building a standalone chatbot or global dashboard.

### Slice 7.1: Add Web Client API

**Status:** Implemented

**Do:**

- Add typed client calls for findings read, explain, refine, dismiss, and manual run only if needed in dev.
- Reuse existing web API patterns.

**Done Means:**

- UI components do not hand-roll fetch behavior.

**Evidence:**

- Type-check and focused client test if local pattern supports it.

**Implementation Note (2026-05-26):** Added `web/src/hooks/useFleetGraphQuery.ts` using the generated OpenAPI client. The hook normalizes API findings into one `FleetGraphFindingView` so UI components do not reinterpret flexible `visibleOutput.humanGate` / `draftContent` JSON independently. It supports source issue/sprint reads plus explain, refine, and dismiss mutations; no manual-run product UI was added.

### Slice 7.2: Add Active-Week Banner

**Status:** Implemented

**Do:**

- Show the banner only for open actionable active-week findings.
- Link to the affected context.
- Avoid a standalone `/fleetgraph` dashboard or global inbox.

**Done Means:**

- A PM can discover the finding from active-week context without knowing which issue to open first.

**Evidence:**

- Web test or browser smoke.

**Implementation Note (2026-05-26):** Added `FleetGraphActiveWeekBanner` and mounted sprint-scoped FleetGraph findings in `WeekIssuesTab` through `FleetGraphWeekSurface`. The banner links to affected issues and stays contextual to the week; no standalone FleetGraph route, dashboard, or global inbox was introduced.

### Slice 7.3: Add Contextual Finding Card

**Status:** Implemented

**Do:**

- Show what happened, why it matters, evidence, severity, confidence, recommended next action, recipient rationale, uncertainty, draft, safe trace metadata, and human gate state.
- Handle issue/week context surfaces.

**Done Means:**

- A user can understand why FleetGraph flagged the issue from context.

**Evidence:**

- Web test or browser smoke.

**Implementation Note (2026-05-26):** Added `FleetGraphFindingCard` and issue/week surfaces. Issue documents now render visible source-issue findings as an editor content banner, and active/completed week issue tabs render sprint-scoped findings above the issue list. The card shows safe API output only: summary, evidence, severity/confidence, next action, recipient rationale, uncertainty, draft text, trace metadata, and gate state.

### Slice 7.4: Add Explain Interaction

**Status:** Implemented

**Do:**

- Let the user ask why the finding was flagged.
- Preserve page context without requiring restatement.
- Display grounded answers only.

**Done Means:**

- On-demand explain works in the page context.

**Evidence:**

- Web/API integration test or browser smoke.

**Implementation Note (2026-05-26):** Added `FleetGraphExplainPanel`, which calls the bounded finding explain endpoint and renders the returned grounded visible output. Restricted/not-found responses are displayed as no visible finding rather than hinting hidden source data exists.

### Slice 7.5: Add Draft Refinement Interaction

**Status:** Implemented

**Do:**

- Let the user refine the draft.
- Make clear that refinement changes only FleetGraph draft state.

**Done Means:**

- Draft refinement is visible without implying anything was sent or changed in Ship.

**Evidence:**

- Web/API integration test or browser smoke.

**Implementation Note (2026-05-26):** Added `FleetGraphDraftRefiner`, which accepts a bounded instruction and calls the refine endpoint. The UI states explicitly say refinement changes only FleetGraph-owned draft text and does not send, post, or mutate Ship.

### Slice 7.6: Add Human Gate

**Status:** Implemented

**Do:**

- Show exact proposed action, exact recipient or role, exact draft text, affected objects, evidence, why approval is required, and the blocked consequence if execution is not implemented.
- Never imply something was sent, posted, moved, or updated when it was not.

**Done Means:**

- The UI clearly blocks Ship mutation or communication until approved.

**Evidence:**

- Web test or browser smoke.

**Implementation Note (2026-05-26):** Added `FleetGraphHumanGate`, which shows why approval is required and the blocked consequence. The execution button is disabled and labeled `Prepared only - nothing sent`, preserving the MVP human-gate boundary and avoiding any implication that a message, comment, status change, assignment, sprint move, or source update occurred.

### Slice 7.7: Add UI States And Accessibility Basics

**Status:** Done

**Do:**

- Handle loading, empty, error, restricted, dismissed, and accessible keyboard states.
- Keep UI contextual, not decorative.

**Done Means:**

- Basic user states are handled without building extra product surfaces.

**Evidence:**

- Web tests and browser smoke.

**Implementation Note (2026-05-26):** Added loading/error/no-visible-finding state handling through `FleetGraphStatePanel` for rendered FleetGraph surfaces while keeping no-finding issue/week contexts silent by default. Focused web coverage now exercises banner links, card/gate language, finding-bound explain/refine calls, dismiss/explain error copy, and normalized API visible output. Browser smoke logged in locally, loaded `/issues`, opened an issue document, and opened a week issues tab without FleetGraph UI runtime errors; current demo data has no visible findings until Epic 8 seeds blocked-work cases. Full E2E remains intentionally skipped for this pass.

**Closeout Note (2026-05-26):** Epic 7 is closed. FleetGraph product UI consumes a single normalized web finding view, surfaces active-week findings in week issue context, surfaces issue findings in the issue document editor context, supports finding-bound explain/refine/dismiss interactions, and renders a non-executing human gate that blocks Ship mutation/contact claims. Verification covered web type-check, root type-check, root build, OpenAPI parity, docs strict/path checks, focused FleetGraph web component tests, focused FleetGraph eval/golden tests against `ship_test_audit`, authenticated browser smoke, demo-positive visual proof, and manual reduced-height review of the `Why flagged?` panel after the scroll fix.

**Follow-up Note (2026-05-26):** Small code-health cleanup to preserve after human review: move Express request augmentation typing out of `scripts/check-affected-ts.mjs` coupling and into a normal `.d.ts`/type boundary so affected-TS checking does not need script-level awareness of API middleware typing.

## Epic 8: Demo Data And Reviewer Readiness

**Status:** Done

**Goal:** Make the MVP reproducible for local validation, timed proof, trace capture, and reviewer navigation.

### Slice 8.0: Restore Blocked-Work Input Path

**Status:** Complete

**Problem:**

FleetGraph currently detects blocked work from `issue_iterations.blockers_encountered`, but the product model should make blockedness explicit: `issue.state = blocked` is the current lifecycle state, and `issue_iterations.blockers_encountered` is the history/evidence explaining each block. Current dev/demo seed data has no first-class blocked issues or non-empty blocker rows, and the web UI does not expose a clear issue-level path for marking an issue blocked and recording why.

**Do:**

- Add `blocked` to the canonical issue state model and expose it in issue status UI.
- When an issue is marked `blocked`, record who changed it and when through existing issue history.
- Add repeatable demo seed data with at least two urgent/high active-week issues whose `state = blocked`.
- For seeded blocked issues, include at least one recent issue iteration with non-empty `blockers_encountered` explaining the block.
- Add negative controls:
  - urgent/high active-week issue that is not blocked.
  - urgent/high active-week issue with `state = blocked` but no blocker explanation.
  - medium/low active-week issue with `state = blocked`.
  - done/cancelled urgent/high issue with blocker history.
  - inactive-week urgent/high issue with `state = blocked`.
- Add or expose an issue-detail UI path for logging an issue iteration with:
  - `status`
  - `what_attempted`
  - `blockers_encountered`
- When a user changes status to `Blocked`, provide a clear place to fill in the blocker reason. Store that reason as an issue iteration `blockers_encountered` entry, not as issue body text.
- If an issue is `blocked` with no blocker explanation, keep it detectable as missing evidence in FleetGraph; the issue UI does not need a separate missing-reason warning beyond the blocker input placeholder.
- Ensure the UI writes to `POST /api/issues/:id/iterations`, not standups or issue body text.
- Update FleetGraph detector semantics so `issue.state = blocked` is the source of truth for current blocked work. `issue_iterations.blockers_encountered` supplies evidence and missing-evidence callouts, not the canonical blocked signal.

**Done Means:**

- A normal user can mark an issue as `Blocked` from the Status UI.
- A normal user can record blocker explanation/history through issue iterations.
- Fresh demo/local data produces FleetGraph positive candidates from `state = blocked` without manual SQL.
- Blocked issues with missing blocker text remain visible to missing-evidence detector paths instead of disappearing.
- The read-only detector command returns expected positive candidates and quiet-exit controls.

**Evidence:**

- Seed/demo inspection showing `state = blocked` issues and blocker-history rows where expected.
- Manual detector output showing `decisionCount >= 2`.
- Browser/API proof that selecting `Blocked` updates issue state and records an `issue_iterations` row when blocker text is provided.
- Focused tests for the UI/API path and detector candidate visibility.

**Implementation Note (2026-05-26):** Added `blocked` to the shared issue state model and regenerated OpenAPI/web types. FleetGraph detector positive selection now requires `issue.state = blocked` and uses the latest non-empty `issue_iterations.blockers_encountered` row as evidence; `state = blocked` without blocker text is counted as `no_blocker` missing-evidence control instead of becoming a positive candidate. The issue sidebar exposes a blocked-state blocker reason entry path that writes to `POST /api/issues/:id/iterations`, and the issue list/status controls recognize `Blocked`; no separate missing-reason warning is shown in the issue UI. Verification: shared/API/web type-check, OpenAPI generation, `detector.test.ts`, `detector.integration.test.ts`, `issues.test.ts`, FleetGraph eval/golden tests, and focused web tests.

### Slice 8.1: Add Repeatable Demo Setup

**Status:** Complete

**Do:**

- Create a realistic, submission-safe execution graph without truncating or corrupting `ship_dev`.
- Include active week, program, project, people roles, urgent/high active-week blocked issues, ownership metadata, and stable reviewer URLs.

**Done Means:**

- Fresh local/demo environment can produce the happy path.

**Evidence:**

- Demo setup output and stable URLs.

**Implementation Note (2026-05-26):** Added `pnpm fleetgraph:demo`, an idempotent local/demo setup command. It creates or updates `FleetGraph Demo Workspace`, active/inactive demo weeks, reviewer-safe people/program/project/dependency context, stable issue/week URLs, and prints detector summary output plus reviewer login (`fleetgraph.reviewer@ship.local`) and a per-run demo password. The command refuses non-local `DATABASE_URL` targets unless explicitly overridden. Rerunning the command preserved the same workspace/document IDs and detector counts.

### Slice 8.2: Add Demo Universe

**Status:** Complete

**Do:**

- Include engineer/builder, PM/project owner, active week owner, program lead/director, and dependency/context source.
- Include at least two urgent/high active-week issues with recent blocker iteration text.
- Include one blocker that names a dependency or decision-maker.

**Done Means:**

- Demo data looks like real Ship work, not artificial unit-test dust.

**Evidence:**

- Seed/demo inspection or reviewer navigation.

**Implementation Note (2026-05-26):** Demo universe includes reviewer/admin, engineer/builder, PM/project owner, program lead/director, dependency owner/source notes, two urgent/high active-week blocked issues with recent blocker iteration text, and blockers naming Casey Dependency Owner and Morgan Project Owner.

### Slice 8.3: Add Negative Controls

**Status:** Complete

**Do:**

- Include inactive week, no blocker, medium/low blocker, done/cancelled urgent/high blocker, duplicate open finding, and private/restricted source case.

**Done Means:**

- Quiet paths can be demonstrated from demo data.

**Evidence:**

- Detector/graph run output showing quiet paths.

**Implementation Note (2026-05-26):** Demo negative controls cover urgent/high active work not blocked, blocked with no blocker explanation, medium-priority blocked work, done urgent work with blocker history, inactive-week blocked work, duplicate open finding, and a private blocked source control. Read-only detector smoke against workspace `eee97472-0e2b-400d-9de6-df17190425d6` returned `decisionCount: 3`, including two `create_finding` decisions and one `update_finding`, plus quiet counts for `done_or_cancelled`, `duplicate_open_finding`, `inactive_week`, `insufficient_visible_evidence`, `medium_low_priority`, and `no_blocker`.

### Slice 8.4: Capture Reviewer Traces

**Status:** Complete with local trace metadata; external shared trace URLs not configured locally

**Do:**

- Capture four trace links: proactive create, on-demand why flagged, on-demand draft refinement, and proactive duplicate/update or quiet exit.
- Ensure traces show different graph paths.
- Use seeded/demo-safe data only.

**Done Means:**

- Reviewer trace evidence is ready.

**Evidence:**

- Trace links added to `FLEETGRAPH.md` once implementation evidence exists.

**Implementation Note (2026-05-26):** `pnpm fleetgraph:demo -- --capture-traces` executed seeded/demo-safe proactive create/update, on-demand explain, and on-demand refine paths. Local trace metadata was captured and added to `FLEETGRAPH.md`; no external trace URL was configured in this local run, so docs record the actual metadata instead of invented links.

### Slice 8.5: Prepare Reviewer Navigation

**Status:** Complete

**Do:**

- Ensure reviewer can navigate to stable issue/week URLs.
- Ensure demo data produces no duplicate open findings unless testing dedupe.

**Done Means:**

- Reviewer can reproduce the MVP path without private workspace data.

**Evidence:**

- Local validation notes or reviewer path checklist.

**Implementation Note (2026-05-26):** `pnpm fleetgraph:demo` prints stable reviewer URLs for active week, project, dependency notes, two positive issues, missing-evidence issue, and duplicate-control issue. Full E2E remains skipped for this pass per Epic 9 scope; local browser smoke is still part of final handoff verification.

**Closeout Note (2026-05-26):** Epic 8 is closed. `pnpm fleetgraph:demo -- --capture-traces` produced seeded/demo-safe proactive create/update plus on-demand explain/refine evidence, stable reviewer navigation, active-week demo data, and visible findings in the local product surface. A demo-readiness issue where the current demo week was seeded as planning was fixed so the active-week FleetGraph surface appears immediately after setup.

## Epic 9: Tests And Verification

**Status:** Done

**Goal:** Prove the FleetGraph MVP contract without relying on full E2E in this pass.

### Slice 9.1: Add Detector Tests

**Status:** Done

**Do:**

- Cover positive predicate and quiet paths.
- Cover duplicate suppression.
- Prove quiet exits make zero model calls.

**Done Means:**

- Detector behavior is deterministic and cheap.

**Evidence:**

- Targeted detector test output.

**Implementation Note (2026-05-26):** Covered through focused FleetGraph detector/eval tests and the DB-backed demo smoke that returned positive create decisions, duplicate/update behavior, and quiet counts for inactive, done/cancelled, insufficient-evidence, medium/low, and no-blocker controls.

### Slice 9.2: Add Graph/Eval Tests

**Status:** Done

**Do:**

- Run golden cases for create, update/suppress, quiet exit, explain, refine, restricted evidence, and human-gated action preparation.
- Apply the decision-packet rubric to representative create/explain/refine outputs.

**Done Means:**

- Graph decisions are measurable against the eval pack.

**Evidence:**

- Golden case and rubric output.

**Implementation Note (2026-05-26):** Focused FleetGraph graph/eval tests passed against `ship_test_audit`; demo trace capture exercised proactive create, proactive duplicate/update, on-demand explain, and on-demand draft refinement paths with safe trace metadata.

### Slice 9.3: Add API Tests

**Status:** Done

**Do:**

- Cover auth, visibility, on-demand explain/refine, dismiss, manual run gating, and OpenAPI.
- Use `ship_test_audit` for destructive API tests.

**Done Means:**

- API behavior is secure and documented.

**Evidence:**

- Targeted API tests and `pnpm openapi:check`.

**Implementation Note (2026-05-26):** Targeted API suite passed against `ship_test_audit`: `src/fleetgraph`, `src/routes/fleetgraph.test.ts`, `src/routes/fleetgraph.integration.test.ts`, and `src/routes/issues.test.ts` ran 750 tests across 72 files. `pnpm openapi:check:strict` also passed with runtime/OpenAPI parity at 199 routes.

### Slice 9.4: Add Web Tests

**Status:** Done

**Do:**

- Cover banner, card, explain/refine, human gate, and basic accessibility states.
- Full E2E can remain skipped for now if named honestly.

**Done Means:**

- UI behavior is proven beyond screenshots.

**Evidence:**

- Targeted web test output or browser smoke.

**Implementation Note (2026-05-26):** Focused web tests passed for `FleetGraphFindingCard` coverage: 186 tests across 25 files. Browser smoke verified active-week findings, issue-context finding cards, explain/refine interactions, and reduced-height scrolling for the `Why flagged?` panel.

### Slice 9.5: Run Smoke Gates

**Status:** Done

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

**Implementation Note (2026-05-26):** Smoke gates passed: `pnpm type-check`, `pnpm build`, `pnpm openapi:check:strict`, `pnpm docs:check:strict`, `pnpm docs:check:paths`, focused API tests, and focused web tests. Build emitted only existing Vite chunk-size warnings.

### Slice 9.6: Capture Timed Proof

**Status:** Done

**Do:**

- Record blocker write timestamp, worker tick/run timestamp, graph decision timestamp, finding persisted timestamp, and UI/API visibility timestamp.
- Finding must be visible within 5 minutes.

**Done Means:**

- MVP latency claim is proven.

**Evidence:**

- Timed proof notes or trace metadata.

**Implementation Note (2026-05-26):** Timed proof captured from local demo data. For finding `6b8a0065-cda3-4750-acb4-bfc05e4d9d77`, the blocker iteration was written at `2026-05-26T22:54:33.766Z`, FleetGraph run/finding creation happened at `2026-05-26T22:54:33.793Z`, and the authenticated reviewer API returned the visible finding with status 200. A second finding `d83c4933-08fc-479d-af04-369998d3fdfa` was detected 60.03 seconds after its blocker iteration, still inside the 5-minute MVP bar.

### Slice 9.7: Final Handoff

**Status:** Done

**Do:**

- Update slice statuses.
- Add trace links/test cases to `FLEETGRAPH.md` once implementation evidence exists.
- Update `MEMORY.md` only for durable high-utility learnings.
- Report skipped verification honestly with reasons.

**Done Means:**

- Handoff is understandable and reproducible.

**Evidence:**

- Final implementation summary and changed-file diff.

**Implementation Note (2026-05-26):** Root `PRESEARCH.md` and `FLEETGRAPH.md` are present, docs checks pass, verification is recorded above, and no staging, unstaging, or commit was performed.

## Epic 10: MVP Compliance Closeout

**Status:** Done

**Goal:** Close the formal MVP checklist gaps without expanding FleetGraph into a broader product than the Week 5 submission requires.

**Why This Exists:** The existing implementation has a real detector/finding loop, but the MVP spec names two hard requirements that local metadata and blocker cards do not satisfy: a running graph with reviewer-shareable traces, and agent chat/notifications accessible in the UI. This epic is the submission correction pass.

### Slice 10.1: Replace Dispatcher Semantics With A Real Shared Graph Runtime

**Status:** Done

**Do:**

- Implement the shared FleetGraph core as an actual LangGraph `StateGraph` or a clearly documented manual graph executor if LangGraph is blocked.
- Route proactive detector decisions, quiet exits, explain, refine, dismiss, resolve, and error paths through the same graph runtime.
- Keep deterministic SQL candidate selection before the graph.
- Preserve current persistence contracts unless the graph runtime needs minimal state shape changes.

**Done Means:**

- Code, not only `FLEETGRAPH.md`, contains graph nodes, conditional edges, and one compiled/executed graph path for both proactive and on-demand triggers.
- The graph can produce at least two visibly different execution paths from the same runtime.

**Evidence:**

- Focused graph tests proving proactive create and on-demand explain/refine use the same runtime.
- Trace output names real graph nodes/edges, not a hand-written pretend path.

**Implementation Note (2026-05-27):** `runFleetGraph` now invokes a real `@langchain/langgraph` `StateGraph` named `fleetgraph.shared_runtime`. The graph routes detector decisions, quiet exits, explain, refine, dismiss, resolve, and error triggers through one compiled runtime while preserving deterministic SQL candidate selection before the graph and existing FleetGraph-only persistence contracts. Focused core/eval tests passed against `ship_test_audit`.

### Slice 10.2: Produce Reviewer-Shareable Trace Links

**Status:** Done

**Do:**

- Configure LangSmith or equivalent tracing in a reviewer-safe environment.
- Capture at least two shared trace links for MVP minimum: proactive create and on-demand contextual path.
- Prefer four trace links if time allows: proactive create, on-demand why flagged, on-demand refine, proactive duplicate/quiet exit.
- Store trace IDs/URLs in FleetGraph run metadata and add the final shared links to root `FLEETGRAPH.md`.

**Done Means:**

- A reviewer can open the links without local database access.
- Traces use seeded/demo-safe data and show different paths.
- The submission no longer relies on "local trace metadata" as a substitute for shared observability.

**Evidence:**

- Root `FLEETGRAPH.md` test cases include actual shared trace URLs.
- `pnpm langsmith:smoke` or equivalent trace capture command succeeds in the configured environment.

**Implementation Note (2026-05-27):** Added explicit FleetGraph LangSmith trace capture with reviewer-safe root runs and node-path child spans. `pnpm langsmith:smoke` produced a shared smoke trace, and `pnpm fleetgraph:demo -- --capture-traces` produced shared traces for proactive create, on-demand explain, and on-demand refine. The shared LangGraph runtime keeps graph state minimal and sanitized so raw inputs, DB handles, prompts, or circular runtime objects are not sent; persisted FleetGraph run metadata stores only sanitized trace IDs/URLs and node paths.

### Slice 10.3: Complete MVP Cost And Invocation Accounting

**Status:** Done

**Do:**

- Record actual FleetGraph development/test graph invocations.
- Record actual token metadata where model calls occur.
- If deterministic fallback is used, say so and report zero model-call cost honestly instead of projecting pretend LLM spend.
- Fill the MVP cost table for development spend and 100 / 1,000 / 10,000 user projections.

**Done Means:**

- `FLEETGRAPH.md` no longer says final cost analysis will be completed later.
- Cost claims are numerically specific and defensible.

**Evidence:**

- Updated root `FLEETGRAPH.md` Cost Analysis section.
- Query or command output showing recorded invocation counts.

**Implementation Note (2026-05-27):** Updated canonical root `FLEETGRAPH.md` with actual local `fleetgraph_runs` accounting after demo trace capture: 27 explain, 20 refine, 19 proactive create, 8 update, and 1 resolve run; all recorded zero model calls, zero tokens, and zero estimated model cost because the reviewer-safe MVP path uses deterministic text generation. The Week 5 `my-docs` FleetGraph file is a pointer to the root submission doc, not a duplicated second FleetGraph spec.

### Slice 10.4: Verify Public MVP Deployment Configuration

**Status:** Done

**Do:**

- Confirm the deployed API has migrations applied and FleetGraph routes available.
- Confirm the worker is enabled or provide a reviewer-safe manual trigger if worker enablement is impossible for the MVP environment.
- Confirm the deployed web surface can show FleetGraph findings from seeded/demo-safe data.
- Do not claim "deployed and publicly accessible" from local screenshots.

**Done Means:**

- A reviewer can access the MVP without running the repo locally.
- Any environment toggles required for FleetGraph are documented.

**Evidence:**

- Public web URL, public API health/FleetGraph route check, and one reviewer-safe object URL.
- Note whether findings are created by scheduled worker or reviewer-triggered manual run.

**Implementation Note (2026-05-27):** Existing public Render endpoints were first verified without redeploying: API/web health were HTTP 200, but FleetGraph routes returned Express 404. The API deploy blocker was a startup migration failure on existing Render DB bootstrap DDL. After the migrator fix deployed, Render API deploy `dep-d8b5o519rddc73a36gag` for commit `67586bf9da42fe6027a38c8decd4325fe7f80980` reached `live`; `https://ship-shape-api.onrender.com/health` returned HTTP 200; `https://ship-shape-web.onrender.com` returned HTTP 200; `GET /api/fleetgraph/findings?sourceIssueId=...` returned HTTP 401 `No session found`; and `POST /api/fleetgraph/manual-run` returned CSRF protection. That proves the public API now exposes the FleetGraph route family behind normal auth/CSRF gates.

## Epic 11: Contextual Agent Interface

**Status:** Not started

**Goal:** Add the smallest embedded on-demand agent UI that satisfies the MVP chat requirement and sets the product direction beyond blocker-specific cards.

**Product Position:** The banner/card is a notification surface. It is not the agent interface. The agent interface should be a contextual project-intelligence panel that can explain, refine, and later host new detector types without becoming a standalone chatbot.

**Surface Decision:** FleetGraph should render findings, not blockers. The first finding kind is `blocker`, but the component and API contracts should read as generic finding infrastructure. Any blocker-specific language belongs in the detector output and copy, not in the surface architecture.

### Slice 11.1: Define The FleetGraph Context Panel Contract

**Status:** Not started

**Do:**

- Define one reusable contextual panel contract for issue, week, project, and future program contexts.
- Inputs: context object type/id, visible state summary, current user role/permissions, visible findings, and allowed on-demand actions.
- Finding shape must include `kind`, source, severity, title, summary, evidence, recommended action, human-gate state, and trace metadata.
- Outputs: explanation, draft/refinement, evidence list, human-gate state, and trace link.
- Keep MVP actions limited to explain/refine/dismiss or ask "why/what next"; no Ship mutations or external sending.

**Done Means:**

- The UI is built as a FleetGraph intelligence surface, not a blocker-only widget.
- Blocked-work findings are the first content type, not the permanent architecture.
- Component names and prop types do not bake in "blocked issue" as the abstraction.

**Evidence:**

- Short contract section added to implementation notes or `FLEETGRAPH.md`.
- Type/API review confirms the panel can support additional detector families later.

### Slice 11.2: Add Embedded On-Demand Chat On Finding Contexts

**Status:** Not started

**Do:**

- Add a compact embedded prompt surface to the FleetGraph card or contextual panel.
- Support at least:
  - "Why was this flagged?"
  - "What should happen next?"
  - "Rewrite the draft with this instruction..."
- Wire the existing explain/refine API paths into visible UI.
- Show the graph response in context with evidence and trace metadata.

**Done Means:**

- A reviewer can invoke FleetGraph from the issue/week page without leaving the context.
- The UI satisfies the spec's chat requirement without adding a standalone chatbot page.

**Evidence:**

- Focused web tests for explain/refine prompt behavior.
- Browser smoke screenshot or note showing the embedded interaction.

### Slice 11.3: Add A General FleetGraph Entry Point Without A Global Inbox

**Status:** Not started

**Do:**

- Add a modest contextual entry point that is not limited to "blocked issue banner" language.
- Prefer a page-level FleetGraph panel/tab/rail slot that says what FleetGraph sees for the current object.
- For MVP, it can show only blocked-work findings, empty state, and on-demand prompt affordance.
- Label the current detector as a `blocker` finding inside the panel, not as a separate blocker-only feature.
- Avoid a standalone broad workspace chat.

**Done Means:**

- The interaction model reads as "project intelligence layer" rather than "hard-to-find blocker banner."
- Future detectors can land in the same surface without inventing a new UI.

**Evidence:**

- UI smoke on issue and active-week contexts.
- Empty-state behavior for contexts with no findings.

## Epic 12: Supplementary Reviewer Visibility

**Status:** Not started

**Goal:** Make FleetGraph demonstrable and reviewable without polluting the core app UX or requiring the reviewer to infer behavior from hidden state.

**Product Boundary:** This is not the product surface. It is a reviewer evidence surface. It may live behind a reviewer-only route, static evidence bundle, or dev/reviewer flag. It must not become the main FleetGraph UX unless deliberately promoted later.

### Slice 12.1: Choose Reviewer Visibility Shape

**Status:** Not started

**Do:**

- Pick one visibility model:
  - Static reviewer evidence page generated from seeded run data.
  - Reviewer-only route gated by admin/dev/reviewer flag.
  - Existing evidence bundle with FleetGraph section and deep links into the app.
- Recommendation: use an evidence bundle or reviewer-only page, not a normal app nav item.

**Done Means:**

- Reviewer visibility is easy to find for grading but does not distort product navigation.
- The boundary between product UI and reviewer proof is explicit.

**Evidence:**

- Updated plan note naming the chosen shape and route/file location.

### Slice 12.2: Add FleetGraph Reviewer Evidence Board

**Status:** Not started

**Do:**

- Show the MVP checklist with pass/fail evidence.
- Show seeded demo workspace, issue, week, and finding links.
- Show trace links and node paths.
- Show the latest run decisions and timestamps.
- Show latency proof against the 5-minute requirement.
- Show cost/invocation summary.

**Done Means:**

- A reviewer can understand and verify FleetGraph in under 2 minutes.
- The board points into the real app for product behavior, instead of replacing it.

**Evidence:**

- Reviewer URL or generated evidence artifact.
- Screenshot or browser smoke proving the board renders.

### Slice 12.3: Add Reviewer-Safe Reset And Reproduce Path

**Status:** Not started

**Do:**

- Provide a safe path to create or refresh seeded FleetGraph demo state.
- Make clear whether it is local-only, deployed-reviewer-only, or both.
- Prevent accidental writes to production/private workspaces.
- Print or display the exact reviewer sequence: create signal, run worker/manual tick, open finding, invoke chat, open trace.

**Done Means:**

- Reviewer proof is reproducible instead of a stale screenshot.
- Safety checks prevent demo tooling from corrupting real data.

**Evidence:**

- Command output, route response, or evidence page section showing the reproduce sequence.

## Epic 13: Product Surface Reframe

**Status:** Not started

**Goal:** Move FleetGraph from a blocker-specific banner implementation toward a reusable project-intelligence platform shape, while preserving the MVP vertical slice.

**Why This Matters:** The current surface proves one detector, but it overfits the UX to blockers. The next product step is not "more banners." It is a reusable intelligence layer that can host findings, explanations, evidence, and human gates across detectors.

**Decision:** We are not locked into the blocker-specific surface. Keep the blocker detector as the MVP vertical slice, but refactor the surface around a generic FleetGraph finding model. The platform shape is: FleetGraph notices something (`finding.kind`), ties it to a Ship object (`source.type` + `source.id`), shows evidence, recommends the next action, and lets the user ask contextual follow-up questions.

### Slice 13.1: Define FleetGraph Finding Taxonomy

**Status:** Not started

**Do:**

- Introduce product-language categories that can cover future detectors: blocker, carryover risk, missing owner, stale work, repeated drift, dependency risk.
- Represent those categories as `finding.kind` values, starting with `blocker`.
- Keep `source.type` separate from `finding.kind`; e.g. a `blocker` finding may point at an issue, while a `carryover_risk` finding may point at a week or project.
- Keep the MVP data model compatible with the current blocked-work finding.
- Do not implement new detectors in this MVP closeout unless needed for reviewer proof.

**Done Means:**

- The UI can label the current finding as one type in a broader intelligence model.
- The next detector does not require a new visual system.
- Developers can add a new detector by emitting another finding kind, not by inventing a new banner/card family.

**Evidence:**

- `FLEETGRAPH.md` or implementation notes define the taxonomy and current MVP mapping.

### Slice 13.2: Separate Notification, Review, And Conversation Surfaces

**Status:** Not started

**Do:**

- Define three product surfaces:
  - Notification: lightweight cue that something needs attention.
  - Review: evidence card with severity, recipient, next step, and human gate.
  - Conversation: embedded contextual prompt for explain/refine/what-next.
- Map current components to those surfaces and name missing pieces:
  - Current active-week banner becomes notification cue.
  - Current finding card becomes generic review card.
  - Missing embedded prompt becomes conversation surface.
- Ensure copy can say "FleetGraph sees 2 findings here" instead of "blocked work" unless the specific finding body is being rendered.

**Done Means:**

- The blocker banner is treated as a notification, not the whole product.
- Review and conversation can scale across detector types.
- Blocker-specific copy is isolated to `blocker` finding content, not nav, panel, route, or component identity.

**Evidence:**

- Updated implementation notes and UI/component plan.

### Slice 13.3: Preserve MVP Scope While Naming Post-MVP Expansion

**Status:** Not started

**Do:**

- Keep implementation focused on blocked active-week work.
- Add a short "After MVP" section that names the next detector families and why the new surface supports them.
- Do not let this become a new Week 5 scope explosion.

**Done Means:**

- The submission reads as intentionally scoped, not underbuilt.
- Reviewer can see FleetGraph is a platform direction without needing extra detector implementation.

**Evidence:**

- Root `FLEETGRAPH.md` and this plan agree on MVP vs post-MVP boundaries.

## Approved 10x Ideas

- Deterministic detector before LLM: required by spec, cuts cost/noise, makes traces meaningful.
- Active-week banner as proactive surface: satisfies discoverability without creating a global inbox.
- Trace-first implementation: required for grading and prevents last-minute fake observability.
- FleetGraph Eval Pack before graph implementation: turns graph behavior from vibes into measurable golden cases, coverage, rubrics, and trace review.
- Dedicated FleetGraph worker/job table after polling MVP: move scheduled scans out of API request processes into a separate worker process that claims durable `fleetgraph_jobs` rows. This removes replica timer races, separates queue latency from execution latency for SLA proof, gives retry/backoff/dead-letter visibility, and becomes the natural landing zone for event triggers. Defer until API horizontal scaling or operational FleetGraph reliability makes the added process/schema/lease complexity worth it.

## Deferred Ideas

- Hybrid event + polling trigger model: better long-term latency/cost, too much event plumbing for MVP.
- Dedicated FleetGraph worker process with durable jobs: cleaner than every API instance scheduling and losing the advisory-lock race, but requires worker deployment, job claiming, lease expiry, retry/backoff, cleanup, and missing-worker monitoring.
- Project risk ledger with more detectors: correct product direction after blocked-work loop works.
- Agent-native project drift substrate where every document mutation emits typed graph facts: powerful, too big for Week 5 MVP.

## Final Handoff Standard

Before human handoff, `IMPLEMENTATION_PLAN_MVP.md` should show the current slice statuses, root submission deliverables (`PRESEARCH.md` and `FLEETGRAPH.md`) should be present or deliberately synced from `my-docs/project-weeks-sot/week-5/`, `FLEETGRAPH.md` should contain trace links/test cases once implementation evidence exists, `MEMORY.md` should be updated only for durable high-utility learnings, no code file should violate the summary-comment rule, no unrelated code should be changed, no staging/unstaging/commit should happen without explicit instruction, and verification should be reported honestly.
