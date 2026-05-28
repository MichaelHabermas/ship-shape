# Decision Log

Durable choices made during the week 5 work. This file exists so we can defend why structural decisions were made, what they do not claim, and what future work must preserve.

## D001 - FleetGraph MVP Source Truth And Boundary

**Date:** 2026-05-25

**Decision:** Treat `my-docs/project-weeks-sot/week-5/w5-specs/` as authoritative, with later explicit user decisions superseding stale execution-doc assumptions. The current MVP vertical slice is visible blocked issues becoming action-ready FleetGraph findings through deterministic SQL before graph reasoning.

**Boundary:** FleetGraph owns diagnosis state only: findings, runs, evidence snapshots, trace metadata, and draft content. Ship remains canonical for documents, issues, weeks, associations, ownership, priority, status, and content. Any Ship mutation or contact with another person requires a human gate.

**Consequence:** Future slices must not add a new document type, invent statuses or priorities outside later explicit decisions, let the LLM choose scan scope, build separate proactive/on-demand graph cores, or surface user-visible claims without visible evidence. D035 supersedes the original "do not invent `blocked` state" wording by making `issue.state = blocked` an explicit Week 5 decision. D047/D049 supersede the original urgent/high active-week blocker eligibility wording.

## D002 - Week 5 Repo Safety Boundary

**Date:** 2026-05-25

**Decision:** Week 5 FleetGraph implementation proceeds without staging, unstaging, or committing unless the human explicitly asks. Existing database tables are changed only through numbered migrations, not edits to `api/src/db/schema.sql`. Destructive API tests run against `ship_test_audit`, not `ship_dev`.

**Consequence:** Future implementation slices can add code, migrations, tests, and docs, but handoff must keep git state transparent and must name any skipped verification honestly.

## D003 - Code File Summary Rule

**Date:** 2026-05-25

**Decision:** For Week 5 implementation, every changed `.ts`, `.tsx`, or `.js` file must be checked for a top-of-file intent summary. If missing, add a truthful 1-2 line comment only when the local file convention allows it; if present, keep it aligned with the file's actual purpose.

**Consequence:** File summaries are for human review only. They must not drive architecture decisions, refactors, or scope expansion, and they must not be added to untouched files just to satisfy the rule superficially.

## D004 - FleetGraph Dependency Scope

**Date:** 2026-05-25

**Decision:** Keep graph and trace dependencies scoped to the API package. FleetGraph uses `@langchain/langgraph` and `langsmith` from `api/package.json`; web and shared packages should not depend on graph runtime libraries.

**Consequence:** Future imports of LangGraph/LangSmith belong under `api/src/fleetgraph/*` behind a narrow local interface. UI and shared code consume FleetGraph through API contracts, not graph internals.

## D005 - FleetGraph Worker Is Explicit Opt-In

**Date:** 2026-05-25

**Decision:** FleetGraph configuration is parsed in `api/src/config/fleetgraph.ts`, but worker startup remains disabled by default. `FLEETGRAPH_WORKER_ENABLED` must be explicitly set to `true` or `1`; the default poll interval is 120,000 ms to match the 2-minute MVP trigger model.

**Consequence:** Local API startup and empty ticks cannot accidentally spend model tokens. Future worker wiring must consume this config instead of reading FleetGraph environment variables ad hoc.

## D006 - FleetGraph Persistence Owns Diagnosis State Only

**Date:** 2026-05-25

**Decision:** FleetGraph durable state starts with exactly two tables: `fleetgraph_findings` and `fleetgraph_runs`. Findings reference Ship issue/week documents in the same workspace and keep FleetGraph-owned status, evidence snapshots, draft content, trace metadata, and human-gate metadata. Runs record proactive/on-demand decisions, quiet exits, errors, and token/cost metadata.

**Consequence:** FleetGraph must not create document types or shadow Ship fields for status, priority, ownership, or week membership. Future helpers should preserve the open-finding dedupe key `blocked-important-issue:{workspace_id}:{issue_id}:{sprint_id}` and write Ship consequences only after a human gate.

## D007 - FleetGraph Persistence Boundary

**Date:** 2026-05-25

**Decision:** FleetGraph persistence helpers live under `api/src/fleetgraph/` and accept a generic query runner. The helpers expose narrow operations for findings and runs: workspace-scoped dedupe lookup, blocked-important-issue create/update, draft refinement, dismiss, resolve, and run recording.

**Consequence:** Worker, graph, and route code should call these helpers instead of writing ad hoc SQL against FleetGraph tables. These helpers may update only FleetGraph-owned tables; Ship mutations stay behind separate human-gated paths.

## D008 - Epic 1 Stops Before Graph Execution

**Date:** 2026-05-25

**Decision:** Epic 1 is complete at the state/config boundary: dependencies, inert env config, FleetGraph-owned tables, and persistence helpers. It does not start the worker, implement detector SQL, call LangGraph, or spend model tokens.

**Consequence:** Epic 2 must begin with deterministic candidate detection and active-week semantics before any graph execution is wired. Any future worker startup must remain behind `FLEETGRAPH_WORKER_ENABLED` and must produce zero-token quiet ticks when SQL finds no candidates.

## D009 - FleetGraph Suppresses, Never Blocks, Ship Source Changes

**Date:** 2026-05-25

**Decision:** FleetGraph DB guards validate new finding/run references, but document lifecycle remains canonical in Ship. If a referenced issue or week is later soft-deleted, moved, or type-mutated, FleetGraph suppresses active findings that depend on the source instead of blocking the Ship document mutation.

**Consequence:** Future FleetGraph constraints may protect FleetGraph-owned rows from invalid writes, but they must not prevent normal Ship document deletes, status changes, ownership changes, week associations, or content edits. Stale FleetGraph diagnosis should be invalidated or recomputed.

## D010 - FleetGraph Reuses Ship Active-Week Semantics

**Date:** 2026-05-25

**Decision:** FleetGraph detector work must use Ship's existing week model. The active week is the current 7-day window derived from `workspaces.sprint_start_date`; active week documents are `documents.document_type = 'sprint'` rows whose `properties.sprint_number` matches that computed window. Issue membership in that week is the existing `document_associations.relationship_type = 'sprint'` association from issue document to week document.

**Consequence:** Detector SQL may join these existing structures, but it must not introduce a FleetGraph-specific active-week table, marker, issue state, priority, or relationship type. Blocker evidence for the MVP detector comes from `issue_iterations.blockers_encountered`.

## D011 - FleetGraph Current Week Uses Shared Date Math

**Date:** 2026-05-25

**Decision:** FleetGraph resolves the current week through `api/src/fleetgraph/current-week.ts`, which reads `workspaces.sprint_start_date` and calls the shared `@ship/shared` sprint-time helper with an explicit current date. Detector code consumes the resolved `currentSprintNumber` instead of duplicating route-local date math.

**Consequence:** Future FleetGraph proactive and on-demand paths should reuse this boundary. If Ship changes week-window calculation, update the shared helper rather than patching FleetGraph SQL independently.

## D012 - FleetGraph Quiet Exits Are Deterministic Run Metadata

**Date:** 2026-05-25

**Decision:** FleetGraph detector quiet exits are classified before graph/model reasoning. Nonzero quiet-exit summaries may be recorded as `fleetgraph_runs` rows with zero model calls and zero model cost, but they must not create findings or mutate Ship source records.

**Consequence:** Negative detector paths remain reviewable without token spend. Duplicate open finding is only classified in slice 2.3; actual duplicate suppression/update behavior belongs to slice 2.4.

## D013 - FleetGraph Dedupe Is An Explicit Detector Decision

**Date:** 2026-05-25

**Decision:** FleetGraph candidate reruns resolve through the locked dedupe key `blocked-important-issue:{workspace_id}:{issue_id}:{sprint_id}` before graph create behavior. If no active finding exists, the detector plans `create_finding`; if an open/needs-confirmation/error finding exists, it plans `update_finding` with the existing finding id.

**Consequence:** The graph/worker should consume the detector decision instead of blindly creating findings. The persistence upsert and partial unique index remain a final guard, not the only dedupe mechanism.

## D014 - Manual Detector Invocation Is Read-Only

**Date:** 2026-05-25

**Decision:** FleetGraph manual detector validation runs through `pnpm fleetgraph:detector -- --workspace-id <uuid>`. It summarizes candidates, dedupe decisions, and quiet exits, but does not enable the worker, create findings, record runs, call a model, or mutate Ship source records.

**Consequence:** Demo and validation runs can happen without waiting for the two-minute worker loop and without spending tokens. Future manual commands that write FleetGraph state must be separate and explicit.

## D015 - Manual Detector Dates And No-Write Contract

**Date:** 2026-05-25

**Decision:** Manual detector `--workspace-id` input must be a UUID, and `--today` input is strict `YYYY-MM-DD` UTC calendar input; invalid dates like `2026-02-31` are rejected instead of relying on JavaScript date normalization. The manual summary reports both `mutatesShip: false` and `mutatesFleetGraph: false`.

**Consequence:** Manual validation cannot silently scan the wrong active week and cannot be mistaken for a worker/graph path that records FleetGraph run state. Worker code can still call quiet-exit run recording explicitly when it needs a zero-token ledger row.

## D016 - Detector Consumers Use Decision Batches

**Date:** 2026-05-25

**Decision:** FleetGraph graph/worker/manual consumers should use `detectBlockedImportantIssueDecisions`, which returns only dedupe decisions. Each decision carries the candidate it applies to. Raw candidate selection and dedupe planning remain private detector-module implementation details.

**Consequence:** Future graph integration has one safer boundary to consume and cannot accidentally receive raw positive candidates without their dedupe decision.

## D017 - FleetGraph Eval Pack Is The Graph Contract

**Date:** 2026-05-26

**Decision:** FleetGraph graph behavior should be implemented against the local eval pack in `api/src/fleetgraph/eval/`. The pack defines golden cases, scenario labels, coverage requirements, a decision-packet rubric, model/trace boundaries, and trace review taxonomy before LangGraph nodes are wired.

**Consequence:** Epic 4 should satisfy the eval pack instead of inventing graph behavior ad hoc. New graph branches should add or update golden cases and coverage first, especially when changing user-visible claims, permission filtering, human gates, model-call boundaries, shared trace data, or mutation boundaries.

## D018 - FleetGraph Core Is Decision-Oriented, Not Chat-Oriented

**Date:** 2026-05-26

**Decision:** Epic 4 adds one shared API-local `runFleetGraph(input)` boundary for proactive and on-demand FleetGraph work. Inputs are typed triggers and bounded source objects, not arbitrary workspace chat. Outputs are decision packets, visible output, evidence, run/finding inputs, and safe trace/token/cost/error metadata.

**Consequence:** Future worker and API route code should call `runFleetGraph` instead of building separate worker and route graphs. Unknown or broad chat prompts should degrade to bounded unsupported/no-safe-output behavior rather than becoming a general workspace assistant.

## D019 - Proactive Findings Persist Least-Privileged-Safe Evidence

**Date:** 2026-05-26

**Decision:** Proactive create/update output persists evidence and drafts that are safe for authorized source-issue viewers, and on-demand explain/refine re-check current principal visibility before returning user-visible output. Hidden source issues produce no-safe-output rather than partial hints.

**Consequence:** FleetGraph must not rely on workspace-only SQL for user-visible claims. Stored finding evidence, summaries, drafts, recipient rationale, and trace metadata must not contain hidden document titles, hidden IDs, private excerpts, contact details, raw prompts, raw completions, session tokens, or API tokens.

## D020 - FleetGraph Model Calls Are Hybrid And Explicitly Opt-In

**Date:** 2026-05-26

**Decision:** Epic 4 permits real model calls only for proactive create, and only when explicitly enabled with `FLEETGRAPH_REAL_MODEL_ENABLED=true` plus model/API-key configuration. Update, quiet, explain, refine, dismiss/resolve, and error paths remain deterministic and record zero model calls.

**Consequence:** Local tests and default worker/API wiring cannot accidentally spend tokens. If future slices enable real model traces, they must preserve the trace redaction contract and record token/cost metadata when available.

## D021 - FleetGraph Golden Cases Execute Against The Shared Core

**Date:** 2026-05-26

**Decision:** Representative FleetGraph golden cases now execute against `runFleetGraph` with mocked persistence/model behavior. The initial executable set covers proactive create, duplicate update, quiet no-blocker, explain existing finding, and restricted-source no-safe-output.

**Consequence:** Future graph changes should extend executable golden cases before expanding user-visible behavior. Restricted-source on-demand explain must return a quiet/no-safe-output decision, not a normal explanation with partial hidden hints.

## D022 - FleetGraph API Surface Preserves The Decision Boundary

**Date:** 2026-05-26

**Decision:** The first FleetGraph API routes expose source-scoped finding reads plus bounded explain/refine actions. Routes call `visibleOutputForFinding` and `runFleetGraph`; they do not import LangGraph/model internals and do not accept arbitrary workspace chat.

**Consequence:** Future UI/API work should keep FleetGraph prompts anchored to a finding/source context. Unknown broad prompts should remain unsupported or no-safe-output until a specific use case is designed and covered by executable golden cases.

## D023 - FleetGraph Trace Metadata Is Sanitized At API Boundaries

**Date:** 2026-05-26

**Decision:** Trace metadata is sanitized before API responses and when converted to JSON for run records. The sanitizer is allowlist-based: only `mode`, `decision`, `nodePath`, `traceId`, `traceUrl`, and `failureCategory` are emitted. Unknown, nested, prompt/completion-shaped, token-shaped, contact, and historical stray fields are dropped rather than making read routes fail.

**Consequence:** FleetGraph trace metadata remains reviewer-safe and resilient to bad old rows. If trace payloads grow, add named allowlist fields plus concrete leak-shape tests before exposing them through API or reviewer surfaces.

## D024 - Restricted FleetGraph Output Is No-Details And No-Mutation

**Date:** 2026-05-26

**Decision:** When actor-filtered FleetGraph evidence returns `noSafeOutput`, public routes must not serialize finding IDs, source issue/week IDs, dedupe keys, or trace details tied to the hidden source. Restricted refine requests record a quiet exit and do not update `fleetgraph_findings.draft_content`.

**Consequence:** Hidden-source FleetGraph state cannot be enumerated through sprint-scoped list calls, explain responses, or refine responses. Future API/UI work must preserve this all-or-nothing privacy boundary instead of returning partial placeholders that leak hidden document existence.

## D025 - FleetGraph Manual Run And Dismiss Are Admin-Gated

**Date:** 2026-05-26

**Decision:** FleetGraph dismiss is a shared state-changing action and requires workspace admin authority before `runFleetGraph` mutates finding status. The manual run API is also workspace-admin-only, current-workspace scoped, and disabled in production unless `FLEETGRAPH_MANUAL_RUN_API_ENABLED=true`.

**Consequence:** Any source-visible member may read/explain/refine within the existing bounded rules, but only admins can remove shared actionable findings or trigger the validation/demo detector-to-graph path. The read-only manual detector CLI remains separate from the stateful manual run API.

## D026 - FleetGraph Admin APIs Fail Closed On Scope, Membership, And Invalid Dates

**Date:** 2026-05-26

**Decision:** FleetGraph admin APIs accept `admin:workspace` API-token scope only when the token principal also resolves to workspace-admin membership. Manual-run `today` input is strict real `YYYY-MM-DD`; impossible dates are rejected instead of normalized. Dismiss status updates that affect no active row return not-found/error through the shared graph run path.

**Consequence:** Bearer tokens cannot bypass workspace membership, manual-run validation cannot silently scan the wrong day, and stale/repeated dismiss attempts cannot produce false success telemetry.

## D027 - FleetGraph API Contract Owns Safe Serialization

**Date:** 2026-05-26

**Decision:** FleetGraph route response schemas and serializers live in `api/src/fleetgraph/api-contract.ts`. Routes remain auth, validation, and orchestration shells. The contract boundary owns visible finding serialization, manual-run result serialization, trace allowlisting, no-safe-output omission, and not-found shaping.

**Consequence:** API privacy behavior is tested at one boundary instead of being duplicated across routes. Restricted/no-safe-output finding actions must be indistinguishable from missing findings and must not serialize finding ids, source ids, dedupe keys, or restricted visible output.

## D028 - FleetGraph Tick Runner Unifies Manual Paths

**Date:** 2026-05-26

**Decision:** Manual detector CLI and gated manual API now share `runFleetGraphTick`. `dryRun` mode performs detector/quiet/dedupe planning only and reports no Ship or FleetGraph mutation. `execute` mode sends detector decisions through the shared `runFleetGraph` path and writes only FleetGraph findings/runs.

**Consequence:** The manual API is not a second FleetGraph implementation. Demo/validation execution stays aligned with future worker behavior, while the CLI remains the no-write inspection tool. Manual-run API responses report only safe serialized detector result counts, so restricted/no-safe-output decisions do not leak raw hidden-source counts.

## D029 - Golden Cases Include Dismiss As Executable Contract

**Date:** 2026-05-26

**Decision:** The dismiss golden case is now executed against `runFleetGraph`, proving status-only FleetGraph writes, no create/upsert path, zero model calls, and run recording through the shared core.

**Consequence:** Future changes to dismissal must preserve W5 source truth: no Ship mutation, no model reasoning, no hidden-source mutation, and no user-visible claim that risk was accepted or source conditions were resolved.

## D030 - Document Graph Counts Are Actor-Visible Counts

**Date:** 2026-05-26

**Decision:** Program/project/week child counts and issue estimate aggregates must pass the same actor visibility predicate as child rows. Program/project/week routes use `document-graph-visibility.ts` helper SQL instead of raw association counts for visible summaries.

**Consequence:** Visible parents no longer reveal hidden child issue/week/project counts, state distributions, or aggregate estimates. Future graph summaries should add helper functions rather than inlining unfiltered `COUNT(*)` snippets.

## D031 - FleetGraph Worker Uses System Attribution And Advisory Locking

**Date:** 2026-05-26

**Decision:** Scheduled FleetGraph execution uses a narrow `fleetgraph_system` principal per workspace, not a borrowed human session. The API-process worker is opt-in, uses recursive deadline-based scheduling, records worker tick metadata in `fleetgraph_worker_ticks`, and takes a Postgres advisory lock before scanning workspaces.

**Consequence:** Proactive FleetGraph can run without a user present while preserving the existing rule that recipient-visible output must be filtered before display. Multi-instance API deployments avoid duplicate scheduled scans without introducing a queue. Worker tick rows provide backend latency proof, but UI-observed surfacing remains an Epic 7 proof requirement.

## D032 - FleetGraph Worker Stays Deterministic At The Model Boundary

**Date:** 2026-05-26

**Decision:** The no-user-present FleetGraph worker injects the deterministic proactive-create text generator into `runFleetGraphTick`, even when real proactive-create model calls are enabled for other paths.

**Consequence:** Worker scans cannot accidentally send blocker/evidence text to an external model because an environment flag was enabled for manual or future interactive flows. A future explicit worker-model policy can replace this, but it must update the no-user-present privacy proof, token accounting, and golden cases together.

## D033 - Dedicated FleetGraph Worker Is The Post-MVP Reliability Path

**Date:** 2026-05-26

**Decision:** Keep the API-process polling worker as the Epic 6 MVP, but record a dedicated FleetGraph worker process with durable `fleetgraph_jobs` as the preferred 10x path once API horizontal scaling, stricter SLA proof, or operational reliability pressure appears.

**Consequence:** The next reliability step is not more timers inside API replicas. It is a separate worker that claims durable jobs, records queue/execution latency separately, supports retry/backoff/dead-letter cleanup, and becomes the landing zone for future event triggers. This adds deployment and lease-state complexity, so it stays deferred until the MVP worker proves the product loop.

## D034 - FleetGraph Product Surface Stays Contextual And Non-Executing

**Date:** 2026-05-26

**Decision:** Epic 7 surfaces FleetGraph only inside the current Ship context: issue documents and active/completed week issue tabs. The web client normalizes API responses into one `FleetGraphFindingView`, then renders active-week banners and finding cards from that view. The API visible-output contract is explicit-allowlist only: severity, confidence, recommended-action label/text/summary, server-owned recipient rationale copy, uncertainty notes, evidence, draft content, human-gate metadata, and relative trace links only.

**Consequence:** The UI must not grow a standalone FleetGraph dashboard, global inbox, or broad chatbot without a new spec decision. Explain/refine routes and draft/human-gate data remain backend/API affordances, but they are not part of the MVP product surface unless a future spec adds a real execution or copy workflow. The UI must not imply anything was sent, posted, assigned, moved, updated, accepted, or escalated until a future confirmed execution API exists. Recipient identities, arbitrary persisted action JSON, unsafe trace URLs, and hidden graph internals stay out of visible output unless a future authorization decision explicitly makes them safe.

## D035 - Blocked Is A First-Class Issue State

**Date:** 2026-05-26

**Decision:** Promote blockedness into Ship's issue lifecycle model. `issue.state = blocked` is the canonical current signal that an issue cannot move forward. `issue_iterations.blockers_encountered` remains blocker history/evidence: who encountered or recorded the block, when it happened, and why.

**Consequence:** Future FleetGraph detector work should use `state = blocked` as the source of truth for currently blocked work. `blockers_encountered` supplies explanation and audit history, but must not be the only signal that an issue is blocked. A blocked issue with no blocker text is still blocked and should remain detectable as missing evidence, but the issue UI does not need a separate missing-reason warning because the blocker input placeholder is enough. Existing blocker-history rows should not be blindly backfilled into `state = blocked` without a deliberate migration decision, because old blocker text can be stale.

## D036 - FleetGraph Demo Evidence Is Idempotent And Local-Trace Honest

**Date:** 2026-05-26

**Decision:** Epic 8 reviewer readiness uses `pnpm demo:seed` / `pnpm fleetgraph:demo` as the repeatable local/demo setup path. The command attaches the canonical reviewer to the loaded app workspace when it exists, falls back to a named demo workspace when it does not, refuses non-local databases by default, prints stable reviewer URLs plus detector summaries, and can run `--capture-traces` to execute seeded graph paths and print local trace metadata. The canonical reviewer login is stable across seeded databases: `fleetgraph.reviewer@ship.local` / `admin123`.

**Consequence:** Demo validation no longer depends on manual SQL or private workspace data. External trace URLs are recorded only when a real tracing backend provides them; local runs document safe persisted trace metadata instead of fabricated links.

## D037 - Issue Bulk Mutations Preserve Single-Item Invariants

**Date:** 2026-05-26

**Decision:** Bulk issue mutation responses must return refreshed associations for updated rows, and bulk week assignment must enforce the same positive-estimate requirement as single issue update on a per-item basis. Single and bulk delete are standardized on soft delete, while system-generated accountability issues remain undeletable in both paths.

**Consequence:** Clients can trust bulk responses without refetching to recover project/week membership, failed unestimated sprint assignments do not silently create planning associations, and delete semantics stay consistent with restore/history expectations. Later cleanup candidates are documented rather than removed in this pass: legacy sprint iterations, headless document commands, issue API primitives without product UI, and one-off migration scripts.

## D038 - FleetGraph MVP Card Is A Sparse Review Queue Item

**Date:** 2026-05-27

**Decision:** The MVP card is not a writing assistant, approval panel, or execution surface. It is a sparse review-queue item for visible blocked issues: issue title, cleaned blocker summary, source priority when useful, evidence, likely recipient when available, and source navigation. Per-card `FleetGraph` branding, universal `Needs confirmation` status, fake-precision confidence, repeated "why flagged" explanation, draft refinement, prepared comments, and human-gate approval panels are removed from the default product surface.

**Consequence:** MVP value is the filtered queue: "these blocked issues deserve review," not "FleetGraph can talk to people" or "FleetGraph approves actions." Post-MVP work may add a real composer, copy action, approval/send flow, dismiss, or richer state labels only with a new product decision that defines destination, actor, mutation boundary, and resolution semantics. Until then, no code should depend on the removed card badges or writing controls being present. D047/D049 supersede any remaining urgent/high active-week wording.

## D039 - FleetGraph Schema Must Stay In Fresh Bootstrap

**Date:** 2026-05-27

**Decision:** `api/src/db/schema.sql` must include the FleetGraph schema introduced by migrations `042_fleetgraph.sql` and `043_fleetgraph_worker_ticks.sql`: `fleetgraph_findings`, `fleetgraph_runs`, `fleetgraph_worker_ticks`, their indexes, and the FleetGraph reference/suppression triggers.

**Consequence:** E2E isolated databases load `schema.sql` and then mark migrations as applied; they do not replay FleetGraph migrations. If `schema.sql` drifts behind numbered migrations, Playwright can pass user-visible assertions while API logs contain FleetGraph 500s such as missing relation errors. FleetGraph verification must inspect smoke logs for backend errors, not only Playwright pass counts.

## D040 - FleetGraph Core Uses A Real LangGraph Runtime With Sanitized External Traces

**Date:** 2026-05-27

**Decision:** `runFleetGraph` now executes a compiled `@langchain/langgraph` `StateGraph` for proactive and on-demand triggers instead of a switch-only dispatcher. Deterministic SQL still chooses candidates before the graph, and FleetGraph persistence remains limited to findings, runs, drafts, statuses, evidence snapshots, and trace metadata.

**Consequence:** Proactive create/update/quiet and on-demand explain/refine/dismiss/resolve/error paths share one runtime with explicit conditional routing. Future graph branches should be added as graph nodes/edges and golden cases, not parallel route/worker logic.

## D041 - FleetGraph Reviewer Traces Are Explicit And Sanitized

**Date:** 2026-05-27

**Decision:** FleetGraph reviewer evidence uses explicit LangSmith trace capture with safe root runs and node-path child spans. The shared LangGraph runtime keeps graph state minimal and sanitized; raw inputs, DB clients, persistence ports, principals, prompts, completions, and evidence payloads stay outside LangGraph state and explicit trace inputs.

**Consequence:** Persisted trace metadata remains allowlisted to mode, decision, node path, trace ID/URL, and failure category. Shared reviewer trace links must come from seeded/demo-safe inputs, and trace capture must not send raw prompts, completions, hidden evidence, DB clients, principals, cookies, tokens, or circular runtime state. Do not protect trace safety by mutating process-wide LangSmith env flags around async graph runs.

## D042 - Public Render FleetGraph Routes Are Verified Behind Auth

**Date:** 2026-05-27

**Decision:** Epic 10 verification treats API health and web health as insufficient. Public closeout requires the deployed API to prove FleetGraph route presence by returning auth/CSRF behavior from FleetGraph endpoints instead of Express `Cannot GET`. After the migrator fix deployed, Render API deploy `dep-d8b5o519rddc73a36gag` for commit `67586bf9da42fe6027a38c8decd4325fe7f80980` reached `live`; public API/web health returned HTTP 200; `GET /api/fleetgraph/findings?sourceIssueId=...` returned HTTP 401 `No session found`; and `POST /api/fleetgraph/manual-run` returned CSRF protection.

**Consequence:** The stale "Cannot GET" blocker is retired. Public MVP verification can now rely on the route family being deployed behind normal auth/CSRF gates. Future public checks should verify behavior-level route presence, not just `/health`. Reviewer-safe seeded object access and any worker/manual-trigger proof still need current authenticated review evidence.

## D043 - FleetGraph Agent Interface Is Contextual Finding Infrastructure

**Date:** 2026-05-27

**Decision:** Epic 11 promotes the FleetGraph UI from blocker-card placement to a reusable contextual panel contract for issue, sprint/week, project, and future program contexts. The API response now exposes `finding.kind` as a detector discriminator; MVP findings use `kind = blocker` without adding a new persistence column. After product review, the visible card surface is a sparse unblock prompt, not fake chat or an audit packet: it shows the blocker, ask, why now, recipient, short message, "not done" safety state, and uncertainty only when useful.

**Consequence:** Future detector families should land as new finding kinds in the same contextual panel instead of creating a standalone FleetGraph inbox, global chatbot, or blocker-only UI fork. The product UI must not expose low-utility "why/what next/rewrite" controls, evidence prose, gate enums, prepared-comment bloat, or external trace links unless a specific reviewer surface needs them. It must not imply Ship mutation, external sending, escalation, or risk acceptance.

## D044 - First Useful FleetGraph Chat Path Is Change Summary

**Date:** 2026-05-27

**Decision:** The next on-demand feature should be "What changed since I last looked?", not generic chat or draft rewriting. It must compare current visible state against a real anchor: first the last FleetGraph finding/run for the source object, later a per-user last-viewed timestamp or activity cursor. D045 records the implemented narrowed version.

**Consequence:** Do not fake "since last looked" without an anchor. New graph behavior needs golden cases for blocked transition, blocker evidence changed, no meaningful change, restricted evidence, and a distinct on-demand trace path. D049 retires this as a PM-facing UI affordance until a new product decision approves it.

## D045 - FleetGraph What Changed Is Delta-Only

**Date:** 2026-05-27

**Decision:** `What changed?` is implemented as a delta-only on-demand path, not a chat surface. It records `summarize_changes`, compares the current visible finding against the previous proactive FleetGraph run for the same finding, and returns only necessary rows: now, changed, cleared, next, unknown, and not done.

**Consequence:** No anchor means no fake "since last looked" claim. No useful delta means `No meaningful change`. The normal UI must not show evidence prose, trace links, internal run metadata, or explanatory paragraphs for this path. The feature writes only `fleetgraph_runs` and must not mutate Ship or contact anyone. D049 retires this as a PM-facing UI affordance until a new product decision approves it.

## D046 - Existing Databases Skip Bootstrap Schema During Migrations

**Date:** 2026-05-27

**Decision:** `api/src/db/migrate.ts` now creates/checks `schema_migrations` first and applies `schema.sql` only when the public schema has no existing application tables. Existing databases run numbered migrations without replaying bootstrap DDL.

**Consequence:** `schema.sql` remains the fresh-database bootstrap source, while numbered migrations remain the evolution path. Render deploys no longer fail before migrations because bootstrap indexes assume columns that older existing tables gain through migrations.

## D047 - Blocked State Is Notification Eligibility

**Date:** 2026-05-28

**Decision:** For the current FleetGraph notification slice, source issue `state = blocked` is the eligibility signal. Current week, urgent/high priority, existing blocker text, assignee/week owner, and ranking are not hard gates. Use existing Ship fields and associations first; do not add FleetGraph-specific document properties, finding categories, or notification types unless a later product decision proves they are necessary.

**Consequence:** Blocked issues should surface even when low/medium priority, outside the current week, unowned, or missing a latest `issue_iterations.blockers_encountered` entry. Missing blocker text is shown as missing source data, not as a reason to suppress the notification. The current persistence model still requires a week/sprint source association for findings; surfacing blocked issues with no week association is a separate product/schema decision.

## D048 - Notification Labels Stay Presentational Until Proven

**Date:** 2026-05-28

**Decision:** The notification UI should separate the attention label from the source title. For blocked issue notifications, render a `Blocked` chip and keep the issue title raw instead of baking `Blocked -` into the title string. Future useful labels to evaluate are `Stale`, `At risk`, and `Needs owner`, but those are product directions, not implemented notification taxonomy yet.

**Consequence:** Do not add persisted notification categories or new document properties just to support labels. Derive labels from existing source state first. `At risk` needs a clear later definition before implementation, likely using existing signals such as not-done state, priority, week timing, and dependencies.

## D049 - Burn Down Unapproved FleetGraph Product Surface

**Date:** 2026-05-28

**Decision:** The current approved FleetGraph product surface is the left-rail notification list plus contextual chat explanation for a selected finding. Unapproved prompt/action affordances such as `What changed?`, `What needs attention?`, and `Draft message` should not appear in the UI until they earn a real product decision. Old detector quiet reasons for active-week, no-blocker, priority, or missing-owner suppression are retired.

**Consequence:** `summarize_changes` and `refine_draft` may remain internal implementation spare parts, but they are not user-facing requirements. Docs, evals, and tests should describe blocked issue state as the MVP eligibility signal and should not reintroduce old hard gates by treating current week, urgent/high priority, owner, or blocker text as suppression reasons.

## D050 - Separate Product UI From Reviewer Proof

**Date:** 2026-05-28

**Decision:** FleetGraph user-facing UI must optimize for what helps the user understand and act. Reviewer proof is a separate evidence surface: logs, persisted runs, traces, test cases, screenshots, and docs can prove current context, selected source context, graph branching, human gates, real data, and latency without exposing that scaffolding in the product UI.

**Consequence:** Do not add labels, chips, metadata rows, debug fields, trace links, or architecture proof copy to the UI unless they improve the user's decision in the moment. If a requirement exists mainly to satisfy the Week 5 reviewer, prove it through instrumentation and evidence artifacts instead of crowding the notification/chat experience.

## D051 - Current Chat Context Uses A Ring Marker

**Date:** 2026-05-28

**Decision:** In the contextual chat header, the current page/source chip uses a small empty green ring marker instead of the text `Current`, a filled dot, or a target icon. This keeps the current context visible while preserving horizontal space for source/context labels.

**Consequence:** Do not reintroduce verbose `Current -` labels in the chip header. Extra context chips remain removable and source-switchable; the current context chip is the fixed anchor for the page the user is on.

## D052 - FleetGraph Evals Split Reviewer Gates From Product Quality Metrics

**Date:** 2026-05-28

**Decision:** Keep reviewer-oriented golden cases as finish-line proof for Week 5 requirements: graph branch coverage, proactive/on-demand paths, human gates, no Ship mutation/contact, restricted evidence safety, persistence, and trace hygiene. Add product-surface evals beside them to score user-facing copy quality over time.

**Consequence:** Do not remove reviewer evals just because their evidence is not product UI. Product-surface evals are trend metrics for actionability, groundedness, specificity, brevity, uncertainty honesty, and UI/proof separation; they complement reviewer gates instead of replacing them.

## D053 - FleetGraph Core Stays An Orchestrator

**Date:** 2026-05-28

**Decision:** `api/src/fleetgraph/core.ts` remains the shared LangGraph runtime and decision orchestration boundary, but deterministic helper logic now lives under `api/src/fleetgraph/runtime/`: `audience.ts` for recipient selection, `drafts.ts` for deterministic draft rewrites, `outputs.ts` for visible output and change summaries, `run-recording.ts` for persisted run/result serialization, and `json.ts` for shared JSON guards.

**Consequence:** Future FleetGraph behavior should add graph nodes/decision handlers in `core.ts` only when orchestration changes. Product copy transforms, audience choice, output mapping, and persistence serialization should stay in `runtime/` unless moving them back clearly reduces complexity.

## D054 - Context Chat Is A Bounded Graph Capsule

**Date:** 2026-05-28

**Decision:** The approved 10x on-demand path is a Context Capsule, not generic chat. Typed prompts enter the same FleetGraph runtime as `context_chat`, resolve the active notification/finding/page context, and support only bounded intents: `why_flagged`, `next_step`, and `summarize_changes`.

**Consequence:** `/api/fleetgraph/chat` records `fleetgraph_runs` with distinct graph paths and zero model calls for the current deterministic slice. It must not create findings, mutate Ship state, send messages, or answer broad workspace questions without an attached source context. Unsupported prompts quietly explain the supported commands.

## D055 - FleetGraph Folders Follow Reasons To Change

**Date:** 2026-05-28

**Decision:** FleetGraph uses subfolders only where the boundary is worth the indirection: `runtime/` for helper logic behind `runFleetGraph`, `detection/` for read-only candidate/current-week/manual detector preview logic, and `execution/` for worker ticks, scheduled execution, and manual admin execution.

**Consequence:** Do not folderize every top-level FleetGraph file by default. `core.ts`, `persistence.ts`, `evidence.ts`, `api-contract.ts`, `types.ts`, trace/model files, tests, and evals can stay top-level until they become real clusters with a separate reason to change.

## D056 - FleetGraph Attention Signals Reuse Findings

**Date:** 2026-05-28

**Decision:** Expand notifications from blocked-only to `Blocked`, `Stale`, and `At risk` without a schema migration. Keep `fleetgraph_findings.kind` and the legacy wire `kind` as `'blocker'` for compatibility, and put the real product signal in dedupe prefixes, run/finding metadata, and API `signalType`.

**Consequence:** One source issue/week should have at most one active attention signal in the product loop, with precedence `blocked > at_risk > stale`. `Stale` means active non-blocked work (`in_progress`/`in_review`) with no issue iteration for 180+ days; one-week inactivity is sprint follow-up, not stale. `At risk` means current-week high/urgent non-blocked work with a concrete risk reason: missing assignee or being within 3 days of sprint end. If a source becomes private or otherwise invisible, suppress the FleetGraph finding rather than marking the Ship work resolved.

## D057 - FleetGraph Live Events Stay FleetGraph-Owned

**Date:** 2026-05-28

**Decision:** Use a FleetGraph-only durable attention event queue, not a generic Ship domain-event rail, for the first live attention loop. Issue mutations enqueue `fleetgraph_attention_events` after successful Ship writes, and the FleetGraph worker claims those events before its scheduled repair scan. Add only per-user read state for notifications; keep dismissal as existing finding state.

**Consequence:** FleetGraph can recheck changed sources quickly and measure event latency without blocking source mutations or creating a broad platform bus. Enqueue failures must be logged/observable but must not fail canonical Ship writes. The scheduled worker scan remains the repair loop for missed or failed events.

## D058 - FleetGraph Attention Queue Has Durable Guardrails

**Date:** 2026-05-28

**Decision:** Harden `fleetgraph_attention_events` as durable FleetGraph state. Queue rows must reference active issue/sprint source documents in the same workspace, processing leases can be reclaimed, retryable worker errors return events to `pending` with bounded backoff, and read-state writes are gated through the same actor-visible evidence path as notification reads.

**Consequence:** FleetGraph freshness is no longer dependent on a single best-effort worker attempt or workspace-only read writes. Terminal event failure is reserved for max-attempt exhaustion; hidden/restricted findings return `markedRead: 0` instead of creating read state or becoming an existence oracle.

## D059 - Attention Scans Must Not Starve Lower-Priority Signals

**Date:** 2026-05-28

**Decision:** Proactive FleetGraph workspace scans should use the issue-attention context reader's normal breadth before signal policy is applied. Do not add a smaller default pre-policy limit that can hide valid `Stale` work behind unrelated urgent/high rows.

**Consequence:** Diagnostic/manual runs may still pass an explicit limit, and targeted event checks stay source-scoped. The repair scan remains broad enough to find lower-priority but legitimately stale work.

## D060 - FleetGraph E2E Uses A Test-Only Worker Trigger

**Date:** 2026-05-28

**Decision:** Playwright proof for the final FleetGraph loop uses an admin-gated `NODE_ENV=test` endpoint that runs one worker pass for the current workspace. This avoids waiting for production worker intervals or the notification poller while still exercising the durable event -> worker -> finding path.

**Consequence:** The endpoint must stay hidden outside test mode, must not bypass auth/admin checks, and must not become product or reviewer UI. Production freshness remains the normal worker plus repair scan.

## D061 - FleetGraph Test Worker Scope Must Include Event Claims

**Date:** 2026-05-28

**Decision:** Explicit FleetGraph worker workspace scope applies to both durable attention-event claiming and scheduled repair scans. Notification read rows also validate that their workspace matches the referenced finding workspace.

**Consequence:** Deterministic E2E worker triggers cannot process another workspace's pending attention events, and read-state persistence cannot silently drift from the finding workspace if future code bypasses the current helper.
