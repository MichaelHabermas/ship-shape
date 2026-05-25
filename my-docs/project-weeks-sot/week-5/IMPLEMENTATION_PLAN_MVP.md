# FleetGraph MVP Implementation Plan

This plan is organized by execution slices, not sentence-level checkboxes. Each slice has a clear purpose, a finish line, and the evidence needed to call it done. Use the status line under each slice to track progress.

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
- If Ship has no explicit commitment marker, say “urgent/high active-week work,” not committed work.
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

**Status:** Not started

**Goal:** Set the rules of engagement before implementation so the team does not drift, mutate the wrong surfaces, or lose the Week 5 source truth.

**Work Slice:** Read and pin the source docs, select the correct context profile before each implementation area, and make the human-review/file-summary rule explicit for future code edits. This slice also protects the repo workflow: do not edit `api/src/db/schema.sql` for existing tables, use numbered migrations, do not stage or commit, and use `ship_test_audit` for destructive API tests.

**Done Means:**

- The implementer can state the MVP detector, non-goals, human gate boundary, and source-truth docs without reopening the whole plan.
- Future code edits follow the top-of-file summary rule: every changed code file has a truthful 1-2 line file intent comment.
- No code, dependency, migration, staging, or commit work has happened before plan acceptance.

**Notes:** Start from the smallest working vertical slice: persistence plus deterministic detector, then eval pack, graph, API, worker, UI, demo data, and verification. Do not start with chat.

## Epic 1: Dependencies, Config, And Persistence

**Status:** Not started

**Goal:** Create the smallest durable FleetGraph-owned state and isolate graph/tracing dependencies from the rest of Ship.

**Work Slice:** Add FleetGraph dependencies only to `api/package.json`, and keep LangGraph/tracing imports under `api/src/fleetgraph/*`. Add numbered migration `042_fleetgraph.sql` with only the required MVP tables: `fleetgraph_findings` and `fleetgraph_runs`. These tables store finding state, evidence snapshots, draft content, trace metadata, run decisions, timing, and token/cost metadata when available.

**Core Shape:**

- `fleetgraph_findings` represents open/dismissed/resolved findings.
- `fleetgraph_runs` records proactive, on-demand, duplicate/update, quiet-exit, explain, refine, and error runs.
- Open finding dedupe key is exactly `blocked-important-issue:{workspace_id}:{issue_id}:{sprint_id}`.
- Worker config defaults off through `FLEETGRAPH_WORKER_ENABLED=false`.

**Done Means:**

- Migrations run cleanly on fresh and already-migrated local databases.
- The two tables can represent proactive create, on-demand explain, on-demand refine, duplicate/update, quiet exit, dismiss, and resolve.
- No FleetGraph document type or unnecessary extra tables exist.
- Empty worker ticks can be recorded without model cost.

**Notes:** The persistence layer is not the product. The product is the action-ready finding. Do not create more schema because it feels tidy.

## Epic 2: Deterministic Candidate Detection

**Status:** Not started

**Goal:** Prove the proactive detector with cheap, testable SQL before any model reasoning.

**Work Slice:** Build the blocked-important-issue detector as a bounded module. It returns candidates and quiet exits; it does not call the LLM. The detector must use existing Ship week semantics, `document_associations` for sprint/week membership, and `issue_iterations.blockers_encountered` for the blocker signal.

**Candidate Rule:** A candidate qualifies only when the source is an issue document, priority is `urgent` or `high`, state is not `done` or `cancelled`, fallback ownership/assignee exists if no stronger commitment marker exists, the issue belongs to the active week via `relationship_type = 'sprint'`, the latest relevant blocker text is non-empty, and no open finding exists for the dedupe key.

**Quiet Paths:** Inactive week, no blocker, medium/low priority, done/cancelled, missing fallback owner/assignee, duplicate open finding, and insufficient visible evidence all exit without model calls.

**Done Means:**

- A qualifying candidate is found deterministically from database state.
- Negative controls quiet-exit without LLM calls.
- Duplicate open findings are not created.
- The detector can be invoked manually for demo/test without waiting two minutes.

**Notes:** If active-week semantics are unclear, stop and read the week routes. Do not invent a separate FleetGraph concept of active week.

## Epic 3: FleetGraph Eval Pack

**Status:** Not started

**Goal:** Make FleetGraph measurable before graph behavior is built.

**Work Slice:** Create the evaluation spine for the graph: golden cases, labeled scenario coverage, decision-packet rubric, and first-failure trace taxonomy. This is not a product surface. It is the harness that keeps graph work honest.

**Golden Cases:** Define 10-15 high-quality cases covering proactive create, inactive-week quiet exit, medium/low quiet exit, done/cancelled quiet exit, no-blocker quiet exit, duplicate update/suppress, existing finding explanation, draft refinement, restricted evidence, and human-gated action preparation. Each case names input state or fixture, graph mode, expected decision, required evidence, forbidden claims, and mutation boundary.

**Scenario Labels:** Label cases by mode, graph branch, action class, evidence quality, permission state, and difficulty. Maintain a coverage matrix so branch gaps are visible.

**Decision-Packet Rubric:** Score groundedness, recipient fit, uncertainty honesty, draft usefulness, action safety, and human-gate clarity. Define pass/fail thresholds before graph work proceeds.

**Trace Review Taxonomy:** First-failure categories are detector, scope resolution, evidence filtering, recipient selection, reasoning, draft quality, UI/gate, and trace/cost metadata.

**Done Means:**

- Golden cases exist before graph implementation.
- Labeled coverage matrix exists.
- Decision-packet rubric exists with pass/fail thresholds.
- Trace review taxonomy exists.
- Implementation slices can cite which eval cases they satisfy.

**Notes:** Four traces are submission evidence, not eval coverage. Ten good cases beat fifty vague ones.

## Epic 4: FleetGraph Core Graph

**Status:** Not started

**Goal:** Implement one shared graph core with distinct proactive and on-demand paths.

**Work Slice:** Build the shared graph behind a narrow local interface such as `runFleetGraph(input)`. Routes and worker code should not know LangGraph internals. The graph normalizes triggers, resolves scope, fetches bounded context, filters visible evidence, reasons about drift, decides the action path, persists FleetGraph-owned state, and produces the output.

**Graph Paths:** The graph must branch across proactive vs on-demand, eligible vs resolved/quiet, create vs update/suppress, explain existing finding, refine draft, prepare human-gated action, and visible vs restricted/no-safe-output evidence.

**Decision Packet:** Each finding should include evidence, summary, severity, confidence, recommended next human action class, draft message, proposed recipient/role rationale, uncertainty notes, trace metadata, and human gate state.

**Done Means:**

- Epic 3 golden cases can exercise create, update/suppress, quiet exit, explain, refine draft, and needs-confirmation decisions.
- Proactive and on-demand traces take visibly different paths.
- Graph does not write Ship canonical document fields.
- Routes and worker call a small graph interface, not LangGraph primitives.

**Notes:** Do not let the graph become a generic workspace assistant. It starts from a bounded source object and expands only as needed.

## Epic 5: API Routes And OpenAPI

**Status:** Not started

**Goal:** Expose FleetGraph through authenticated, documented, capability-aware API routes.

**Work Slice:** Add `/api/fleetgraph` routes behind auth/CSRF and register them with OpenAPI. The MVP route set is findings read by context, on-demand explain/refine, dismiss, draft refinement, and a safely gated dev/admin manual run endpoint.

**Route Boundary:** Finding reads require source issue and active week visibility. On-demand requests authorize the current context document before graph context fetch. Dismiss only updates FleetGraph finding status. Refine only updates FleetGraph-owned draft content. Manual run must not be publicly usable in production.

**Done Means:**

- Unauthenticated and cross-workspace requests fail.
- A user without source issue/week access cannot read finding details.
- Dismiss and refine do not mutate source issue/week.
- OpenAPI coverage remains complete.
- Response types are explicit enough for web consumption.

**Notes:** This is a security-sensitive surface. Use the repo capability model instead of route-local shortcuts. Do not expose raw prompts/completions.

## Epic 6: Worker Lifecycle

**Status:** Not started

**Goal:** Run the proactive detector without a user present while keeping lifecycle and shutdown clean.

**Work Slice:** Add a worker module with `startFleetGraphWorker()` returning a cleanup function. It starts only with `FLEETGRAPH_WORKER_ENABLED=true`, polls every 2 minutes, records heartbeat/run metadata, invokes the deterministic detector, calls the graph only for eligible candidates or due rechecks, records errors without crashing the API process, and stops cleanly during shutdown.

**Operational Boundary:** No module-level orphan intervals. Empty ticks do not call the model. A manual one-tick function exists for tests and demos. DB uniqueness handles MVP dedupe. DB lease is deferred unless deployment uses multiple API instances.

**Done Means:**

- Worker is off by default.
- Worker starts only with explicit env flag.
- Worker stops cleanly during shutdown.
- Manual tick works without waiting two minutes.
- A proactive finding can appear within the 5-minute budget.

**Notes:** If multiple deployed API instances are active, DB lease is no longer polish; it is correctness work.

## Epic 7: UI: Active-Week Banner, Context Card, Chat, Human Gate

**Status:** Not started

**Goal:** Make FleetGraph proactive and contextual without building a standalone chatbot or global dashboard.

**Work Slice:** Add the active-week banner as the MVP discovery surface, plus contextual finding cards on affected issue/week surfaces, embedded chat/refine in current page context, and a human gate that clearly blocks Ship mutation or communication until approved.

**User Experience:** The banner appears only for open actionable active-week findings and links to the affected context. The card explains what happened, why it matters, evidence, severity, confidence, recommended next action, recipient rationale, uncertainty, draft, trace metadata when safe, and human gate state. Chat can answer “why was this flagged?” and refine the draft without requiring the user to restate the page context.

**Human Gate:** The gate shows exact proposed action, exact recipient or role, exact draft text, affected objects, evidence, why approval is required, and the blocked consequence if execution is not implemented. It must never imply something was sent, posted, moved, or updated when it was not.

**Done Means:**

- A PM can discover the finding from active-week context without knowing which issue to open first.
- A user can open issue/week context and understand why FleetGraph flagged it.
- A user can ask why it was flagged and refine the draft.
- No Ship mutation or external communication happens without explicit, honest human approval.
- Loading, empty, error, restricted, dismissed, and accessible keyboard states are handled.

**Notes:** No standalone `/fleetgraph` chatbot, no global inbox, no generic assistant dashboard, no decorative AI panel, no snooze in MVP.

## Epic 8: Demo Data And Reviewer Readiness

**Status:** Not started

**Goal:** Make the MVP reproducible for local validation, timed proof, trace capture, and reviewer navigation.

**Work Slice:** Add a repeatable demo setup or validation path that creates a realistic, submission-safe execution graph without truncating or corrupting `ship_dev`. It should include an active week, program, project, people roles, urgent/high active-week blocked issues, ownership metadata, stable reviewer URLs, and negative controls.

**Demo Universe:** Include engineer/builder, PM/project owner, active week owner, program lead/director, dependency/context source, at least two urgent/high active-week issues with recent blocker iteration text, and one blocker that names a dependency or decision-maker.

**Negative Controls:** Include inactive week, no blocker, medium/low blocker, done/cancelled urgent/high blocker, duplicate open finding, and private/restricted source case.

**Done Means:**

- Fresh local/demo environment can produce happy path and quiet path.
- Reviewer can navigate to stable issue/week URLs.
- Demo data produces no duplicate open findings unless testing dedupe.
- Trace capture does not expose private organic workspace data.

**Notes:** Demo readiness is not polish. The spec requires real Ship data and trace links against defined states.

## Epic 9: Tests And Verification

**Status:** Not started

**Goal:** Prove the FleetGraph MVP contract without relying on full E2E in this pass.

**Work Slice:** Use focused API/unit/web tests, the Epic 3 eval pack, local smoke, and timed proof. Full E2E can remain skipped for now, but the MVP cannot hand off on screenshots alone.

**Coverage Areas:** Detector predicate and quiet paths; graph decisions aligned to golden cases; route auth, visibility, on-demand, refine, dismiss, and OpenAPI; web banner, card, chat/refine, human gate, and basic accessibility states.

**Smoke Gates:** Run `pnpm type-check`, `pnpm build`, `pnpm openapi:check`, `pnpm docs:check`, `pnpm docs:check:paths`, and targeted API/web tests. API tests that can be destructive must use `ship_test_audit`.

**Timed Proof:** Record blocker write timestamp, worker tick/run timestamp, graph decision timestamp, finding persisted timestamp, and UI/API visibility timestamp. Finding must be visible within 5 minutes.

**Trace Evidence:** Add four trace links to `FLEETGRAPH.md`: proactive create, on-demand why flagged, on-demand draft refinement, and proactive duplicate/update or quiet exit. The traces must show different graph paths, not the same pipeline with different metadata.

**Done Means:**

- MVP happy path passes locally.
- Negative controls are proven.
- Golden cases and labeled coverage matrix are current.
- Decision-packet rubric has been applied to representative create/explain/refine outputs.
- Trace evidence is ready for reviewer.
- Any skipped verification is named honestly with the reason.

**Notes:** Targeted tests do not replace rubric scoring for subjective decision-packet quality. Timed proof and submitted traces feed the trace review taxonomy.

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
