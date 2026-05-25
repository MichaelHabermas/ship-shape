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

**Status:** Not started

**Goal:** Create the smallest durable FleetGraph-owned state and isolate graph/tracing dependencies from the rest of Ship.

### Slice 1.1: Add FleetGraph Dependencies

**Status:** Not started

**Do:**

- Add FleetGraph dependencies only to `api/package.json`.
- Keep LangGraph and tracing imports under `api/src/fleetgraph/*`.
- Avoid introducing dependencies outside the graph/tracing need.

**Done Means:**

- Dependency additions are scoped to the API package.
- Existing web/shared packages do not import FleetGraph graph dependencies.

**Evidence:**

- Package diff shows only necessary API dependency changes.

### Slice 1.2: Add Environment Configuration

**Status:** Not started

**Do:**

- Add `FLEETGRAPH_WORKER_ENABLED=false` as the default behavior.
- Add tracing/model configuration only where the API config pattern expects it.
- Keep the worker off unless explicitly enabled.

**Done Means:**

- Local startup does not begin proactive scanning by default.
- Empty worker ticks can be represented without model cost.

**Evidence:**

- Config test, startup smoke, or direct config inspection.

### Slice 1.3: Add FleetGraph Migration

**Status:** Not started

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

### Slice 1.4: Add Persistence Helpers

**Status:** Not started

**Do:**

- Add focused read/write helpers for findings and runs.
- Support proactive create, duplicate/update, quiet exit, explain, refine, dismiss, resolve, and error runs.
- Use the open-finding dedupe key `blocked-important-issue:{workspace_id}:{issue_id}:{sprint_id}`.

**Done Means:**

- The two tables can represent every MVP run/finding state.
- Dismiss and refine update only FleetGraph-owned state.

**Evidence:**

- Targeted API/unit tests or direct helper tests.

## Epic 2: Deterministic Candidate Detection

**Status:** Not started

**Goal:** Prove the proactive detector with cheap, testable SQL before any model reasoning.

### Slice 2.1: Confirm Active-Week Semantics

**Status:** Not started

**Do:**

- Read the existing week routes/query code before implementing detector SQL.
- Confirm active week membership uses `document_associations.relationship_type = 'sprint'`.
- Do not invent a FleetGraph-only active-week concept.

**Done Means:**

- Detector implementation follows existing Ship week semantics.

**Evidence:**

- Code reference in implementation notes or test fixture setup.

### Slice 2.2: Implement Positive Candidate Query

**Status:** Not started

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

### Slice 2.3: Implement Quiet Exits

**Status:** Not started

**Do:**

- Quiet-exit inactive week, no blocker, medium/low priority, done/cancelled, missing fallback owner/assignee, duplicate open finding, and insufficient visible evidence.
- Record quiet exits without model calls when useful for traceability.

**Done Means:**

- Negative controls do not call the LLM.
- Quiet paths are distinguishable enough for debugging and trace review.

**Evidence:**

- Targeted detector tests proving zero model calls.

### Slice 2.4: Implement Dedupe

**Status:** Not started

**Do:**

- Use the exact dedupe key `blocked-important-issue:{workspace_id}:{issue_id}:{sprint_id}`.
- Suppress or update when an open finding already exists.
- Do not create duplicate open findings.

**Done Means:**

- Re-running the detector against the same source does not create duplicate open findings.

**Evidence:**

- Dedupe test or manual two-run proof.

### Slice 2.5: Add Manual Detector Invocation

**Status:** Not started

**Do:**

- Provide a safe internal/manual invocation path for tests and demos.
- Avoid waiting for the two-minute worker loop during validation.

**Done Means:**

- Detector can be invoked manually without enabling the worker.

**Evidence:**

- Test helper, dev/admin path, or local script output.

## Epic 3: FleetGraph Eval Harness

**Status:** Not started

**Goal:** Make FleetGraph measurable before graph behavior is built.

### Slice 3.1: Define Golden Case Format

**Status:** Not started

**Do:**

- Define the case fields: input state or fixture, graph mode, expected decision, required evidence, forbidden claims, and mutation boundary.
- Keep the format easy to extend as graph paths appear.

**Done Means:**

- New cases can be added without inventing structure each time.

**Evidence:**

- Golden case file or documented case schema.

### Slice 3.2: Add Golden Cases

**Status:** Not started

**Do:**

- Add 10-15 high-quality cases.
- Cover proactive create, inactive-week quiet exit, medium/low quiet exit, done/cancelled quiet exit, no-blocker quiet exit, duplicate update/suppress, existing finding explanation, draft refinement, restricted evidence, and human-gated action preparation.

**Done Means:**

- Graph implementation slices can cite the cases they satisfy.

**Evidence:**

- Golden case list committed to the repo or test fixture set.

### Slice 3.3: Add Scenario Labels And Coverage Matrix

**Status:** Not started

**Do:**

- Label cases by mode, graph branch, action class, evidence quality, permission state, and difficulty.
- Maintain a coverage matrix so branch gaps are visible.

**Done Means:**

- Missing graph coverage is visible before implementation proceeds too far.

**Evidence:**

- Coverage matrix in test/docs form.

### Slice 3.4: Add Decision-Packet Rubric

**Status:** Not started

**Do:**

- Score groundedness, recipient fit, uncertainty honesty, draft usefulness, action safety, and human-gate clarity.
- Define pass/fail thresholds before graph work proceeds.

**Done Means:**

- Subjective decision quality is measurable instead of vibes-based.

**Evidence:**

- Rubric file or test-support document with thresholds.

### Slice 3.5: Add Trace Review Taxonomy

**Status:** Not started

**Do:**

- Use first-failure categories: detector, scope resolution, evidence filtering, recipient selection, reasoning, draft quality, UI/gate, and trace/cost metadata.

**Done Means:**

- Trace failures can be classified consistently during review.

**Evidence:**

- Taxonomy documented beside the eval pack.

## Epic 4: Shared FleetGraph Core

**Status:** Not started

**Goal:** Implement one shared graph core with distinct proactive and on-demand paths.

### Slice 4.1: Add Narrow Graph Interface

**Status:** Not started

**Do:**

- Add a local interface such as `runFleetGraph(input)`.
- Keep routes and worker code unaware of LangGraph internals.
- Normalize proactive and on-demand triggers at the graph boundary.

**Done Means:**

- API routes and worker can call one stable interface.

**Evidence:**

- Type-level API or focused unit test.

### Slice 4.2: Resolve Scope And Fetch Context

**Status:** Not started

**Do:**

- Start from a bounded source object.
- Fetch only the context needed to decide whether the finding is actionable.
- Do not turn the graph into a broad workspace assistant.

**Done Means:**

- Graph inputs produce bounded evidence bundles.

**Evidence:**

- Golden cases exercising scope resolution.

### Slice 4.3: Filter Visible Evidence

**Status:** Not started

**Do:**

- Filter evidence to claims visible to the current user.
- Return restricted/no-safe-output behavior when needed.
- Never expose raw prompts or hidden evidence.

**Done Means:**

- User-visible claims are backed by evidence visible to that user.

**Evidence:**

- Restricted evidence golden case and authorization test.

### Slice 4.4: Implement Proactive Create Path

**Status:** Not started

**Do:**

- Convert a qualifying detector candidate into a decision packet.
- Persist the FleetGraph finding and run metadata.
- Include evidence, summary, severity, confidence, recommended next human action class, draft message, recipient/role rationale, uncertainty notes, trace metadata, and human gate state.

**Done Means:**

- A qualifying candidate becomes an action-ready finding.

**Evidence:**

- Golden case pass and persisted finding inspection.

### Slice 4.5: Implement Update/Suppress And Quiet Paths

**Status:** Not started

**Do:**

- Support duplicate/update, suppress, resolved/quiet, and error paths.
- Persist run decisions without creating inappropriate findings.

**Done Means:**

- Non-create proactive paths are explicit and testable.

**Evidence:**

- Golden cases for duplicate/update and quiet exit.

### Slice 4.6: Implement Explain Existing Finding

**Status:** Not started

**Do:**

- Answer why a finding was flagged from existing finding state and visible evidence.
- Do not require the user to restate page context.

**Done Means:**

- On-demand explain produces grounded output for an existing finding.

**Evidence:**

- Golden case and trace for "why was this flagged?"

### Slice 4.7: Implement Draft Refinement

**Status:** Not started

**Do:**

- Refine only FleetGraph-owned draft content.
- Preserve the human gate.
- Do not mutate source issue/week/project/program data.

**Done Means:**

- Draft refinement changes the FleetGraph draft and nothing canonical in Ship.

**Evidence:**

- Golden case and persistence test.

### Slice 4.8: Capture Trace Metadata

**Status:** Not started

**Do:**

- Capture trace links or equivalent reviewer-shareable trace identifiers.
- Capture token/cost metadata when available.
- Make proactive and on-demand traces visibly different.

**Done Means:**

- Trace evidence can support reviewer inspection and failure classification.

**Evidence:**

- Trace metadata visible in run records.

## Epic 5: API Surface And OpenAPI

**Status:** Not started

**Goal:** Expose FleetGraph through authenticated, documented, capability-aware API routes.

### Slice 5.1: Add Route Shell And OpenAPI Registration

**Status:** Not started

**Do:**

- Add `/api/fleetgraph` routes behind auth/CSRF.
- Register routes with OpenAPI.
- Use explicit request/response types for web consumption.

**Done Means:**

- OpenAPI coverage remains complete.

**Evidence:**

- `pnpm openapi:check` or targeted OpenAPI test.

### Slice 5.2: Add Findings Read Route

**Status:** Not started

**Do:**

- Read findings by active-week/source context.
- Require source issue and active week visibility.
- Prevent cross-workspace access.

**Done Means:**

- Authorized users can read accessible findings.
- Unauthorized/cross-workspace users cannot.

**Evidence:**

- Route auth/visibility tests.

### Slice 5.3: Add Explain Route

**Status:** Not started

**Do:**

- Authorize the current context document before graph context fetch.
- Call the shared graph interface.
- Return grounded explain output without raw prompts/completions.

**Done Means:**

- A user can ask why the finding was flagged from context.

**Evidence:**

- Route test and golden case alignment.

### Slice 5.4: Add Refine Route

**Status:** Not started

**Do:**

- Authorize current context.
- Call the shared graph interface.
- Update only FleetGraph-owned draft content.

**Done Means:**

- Refine never mutates source issue/week documents.

**Evidence:**

- Route test proving source document fields are unchanged.

### Slice 5.5: Add Dismiss Route

**Status:** Not started

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

Before human handoff, `IMPLEMENTATION_PLAN_MVP.md` should show the current slice statuses, `FLEETGRAPH.md` should contain trace links/test cases once implementation evidence exists, `MEMORY.md` should be updated only for durable high-utility learnings, no code file should violate the summary-comment rule, no unrelated code should be changed, no staging/unstaging/commit should happen without explicit instruction, and verification should be reported honestly.
