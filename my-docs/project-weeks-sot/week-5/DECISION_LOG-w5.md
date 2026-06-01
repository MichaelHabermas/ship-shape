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

## D020 - FleetGraph Proactive Create Model Is Opt-In

**Date:** 2026-05-26

**Decision:** Proactive blocked-create copy may call the model only when `FLEETGRAPH_REAL_MODEL_ENABLED=true`, `FLEETGRAPH_MODEL`, and `OPENAI_API_KEY` are configured. Detector policy, worker ticks, explain/refine/dismiss/resolve graph paths, and structured finding output stay deterministic and record zero model calls unless a separate decision adds model use there.

**Consequence:** Local tests and default worker wiring do not spend tokens on detection. Proactive model traces must preserve the trace redaction contract and record token/cost metadata when available. PM context chat is governed by D095, not this decision.

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

**Decision:** Epic 8 reviewer readiness uses `pnpm demo:seed` / `pnpm fleetgraph:demo` as the repeatable local/demo setup path. The command attaches the canonical reviewer to the loaded app workspace when it exists, falls back to a named demo workspace when it does not, refuses non-local databases by default, prints stable reviewer URLs plus detector summaries, and can run `--capture-traces` to execute seeded graph paths and print local trace metadata. The local canonical reviewer email is `fleetgraph.reviewer@ship.local`; deployed passwords are not published.

**Consequence:** Demo validation no longer depends on manual SQL or private workspace data. External trace URLs are recorded only when a real tracing backend provides them; local runs document safe persisted trace metadata instead of fabricated links.

**2026-05-29 supersession:** This remains a local/demo convenience only. Deployed Render builds must not run `fleetgraph-demo`, non-local demo seeding requires an explicit `FLEETGRAPH_DEMO_PASSWORD`, final proof uses Render/Postgres evidence instead of publishing a static reviewer password, and the old deployed `admin123` reviewer password was disabled.

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

## D062 - FleetGraph Tracing Is Provider-Neutral And Best-Effort

**Date:** 2026-05-28

**Decision:** FleetGraph external tracing now uses one provider-neutral facade that can emit the same sanitized run/node/model-call evidence to LangSmith and Langfuse. The graph receives one primary trace identity, preferring a provider with a shareable URL available before graph execution, while demo/smoke evidence can report all configured provider URLs.

**Consequence:** Observability providers are evidence sinks, not execution control flow. Provider node setup/update/finalization failures are recorded as provider failures and must not skip, rerun, or fail the FleetGraph business node. Root traces always include explicit token/cost summaries, using `none` when no model or cost data exists; real model calls still emit provider-native LLM/generation children for vendor token/cost columns. Short-lived trace smoke/demo paths explicitly shut down tracing so Langfuse/OpenTelemetry exports are flushed before process exit. Future providers should plug into the facade contract or split into provider modules when the file grows, rather than leaking vendor SDKs into `core.ts`, routes, web, or shared packages.

## D063 - FleetGraph Observability Trial Is Local-First

**Date:** 2026-05-28

**Decision:** Add `pnpm fleetgraph:observe` as the local dual-provider trial for Langfuse and LangSmith. It runs bounded demo/smoke traces, posts deterministic provider-native scores best-effort, and writes JSON/Markdown comparison reports under `my-docs/evals/fleetgraph-observability/`.

**Consequence:** The trial can spend real model tokens only when the command is explicitly invoked, stays out of CI/production automation for v1, and treats the local report as canonical when provider score APIs behave differently. Failed-score traces, provider-friction traces, and real-cost traces are appended to the generated edge-case dataset for future replay. Future CI gates should reuse the same score names instead of inventing new evaluation vocabulary.

## D064 - FleetGraph Observability Dashboard Has Provider History

**Date:** 2026-05-28

**Decision:** Extend the observability trial from per-run reports to a cumulative provider-history snapshot. `pnpm fleetgraph:observe:sync` pulls recent FleetGraph traces/runs from Langfuse and LangSmith, writes `provider-history.json`, and the dashboard generator publishes both the local dashboard and a deployed static artifact under `web/public/fleetgraph-observability/`.

**Consequence:** Reviewer-facing observability now shows forced demo runs, cumulative local reports, and synced provider history in one place. Provider API failures must show as dashboard data, not erase the local report history. The static deployed dashboard intentionally uses a generated snapshot so provider secrets stay server-side/local and never ship to the browser.

## D065 - FleetGraph Final Proof Is A Static Evidence Packet

**Date:** 2026-05-28

**Decision:** Build the reviewer dashboard as generated evidence from `pnpm fleetgraph:proof`, not as product UI. The proof packet lives under `my-docs/evidence/fleetgraph-proof/`, runs existing FleetGraph tests/evals, and renders `latest.html`, `latest.json`, `latest.md`, plus timestamped copies.

**Consequence:** The dashboard can be dense and reviewer-specific without polluting the left rail or chat. FleetGraph behavior remains owned by `api/src/fleetgraph/*`; proof scripts observe, gate, and package the behavior rather than reimplementing detection, actor filtering, dedupe, or chat semantics. The proof model distinguishes golden-case-defined paths from executable proof coverage, and the strict check fails blocked packets unless explicitly run in inspection mode.

## D066 - OWASP Cat 8 Governance And Write Gates

**Date:** 2026-05-29

**Decision:** Close OWASP plan items 1–4 (authorization, bcrypt rounds, CSP) without adding Trivy/dependency scanning in this slice. Governance fields (`GOVERNANCE_PROPERTY_KEYS`, including `submitted_at`) are blocked on generic document create/PATCH for all principals, including workspace admin. The governed path is `POST /api/documents/:id/commands` with `set_governance` after capability `action: 'governance'`; `updateDocumentMutation` must not reject or strip governance keys when `capability.action === 'governance'`. Program and project mutating routes use write/create capability guards, not read guards. Password hashing standardizes on `PASSWORD_BCRYPT_ROUNDS = 12`. Admin credentials UI uses external JS; Helmet CSP removes `script-src 'unsafe-inline'`.

**Consequence:** Mass-assignment probes should pass with zero findings on `input-governance-mass-assignment`. API tokens need explicit write/governance scopes for program/project/document mutations they were implicitly allowed before. `submitted_at` is set server-side on first weekly plan/retro content save (`stampWeeklyAccountabilitySubmittedAt`); clients cannot inject it via properties. OWASP code changes should land in a security-focused commit/PR separate from FleetGraph product slices; FleetGraph and timestamped probe run folders were unstaged from the security index on 2026-05-29 per D066.

## D067 - OpenAPI Contract Includes Admin Credentials App Script

**Date:** 2026-05-29

**Decision:** Register `GET /admin/credentials/app.js` in the OpenAPI registry and regenerate `api/openapi.json` / `web/src/api/generated/ship-openapi.d.ts` whenever security routes change. `pnpm openapi:check:strict` must stay at zero missing/stale routes.

**Consequence:** CSP externalization of the super-admin credentials UI remains contract-visible; route drift fails CI-style checks locally via `openapi:check:strict`.

## D068 - Service-Layer Write Guards For Projects And Programs

**Date:** 2026-05-29

**Decision:** Add [`mutation-capability-guard.ts`](../../api/src/services/mutation-capability-guard.ts) and require `Principal` + `guardDocumentMutation` / `guardDocumentCreate` at the start of project/program write services and `programs.ts` mutating handlers. Writes load rows by `id + workspace_id + document_type` after capability passes; reads/lists keep `VISIBILITY_FILTER_SQL`.

**Consequence:** API tokens with `documents:read` cannot mutate via service even if a route guard regresses. Issue mutations share the same guard module. Week lifecycle (`governance-auth`) and team allocation remain separate slices.

## D069 - Galaxy-Brain Auth Follow-Ups (Bulk Issues, Programs Service, Week Lifecycle)

**Date:** 2026-05-29

**Decision:** (1) Bulk issue mutations run per-id `guardIssueMutation` with `bulkIssueWriteGuardSpec`: `restore` sets `includeArchived` + `includeDeleted`; `update`/`delete` set `includeArchived`; bulk `delete` sets `enforce: 'creator_or_admin'`. (2) Extract `programs-service.ts` + `schemas/programs.ts`; mutating `programs.ts` routes delegate to the service (guards inside service). (3) `requireWeekLifecycleAuthority` takes `Principal`, loads sprint by id without `VISIBILITY_FILTER_SQL`, then `guardDocumentMutation` write before role checks (`start_week` / `carryover`).

**Consequence:** Bulk restore can target archived/deleted issues when the principal can write them. Non-creator members cannot bulk-delete others' issues. Program merge/create/update/delete stay capability-correct if route guards regress. Week lifecycle no longer conflates "invisible in list" with "cannot start week." Tests: `issue-bulk-mutation-guard.test.ts`, extended `governance-auth.test.ts`; service guards covered by existing `projects-mutation-guard` / token-scope suites.

## D070 - Post-Review Hardening For Service-Layer Guards

**Date:** 2026-05-29

**Decision:** After parallel correctness review: bulk all-guard-fail returns **403** when every failure is `Forbidden` / `token_scope_denied` (parity with single DELETE). Bulk sprint/project assignment uses `requireReferenceableDocument` (no silent association clear). `mergePrograms` runs final SELECT on transaction `client` before `COMMIT`; guards use same `client`; route skips `ROLLBACK` on pre-transaction validation failures. `requireWeekLifecycleAuthority` surfaces guard `body.error` verbatim. `authorizeDocumentMutation` forwards `includeDeleted` and `expectedType`.

**Consequence:** Fixes SS-FIND-007-class bulk reference visibility gap and merge post-commit orphan risk without unifying the full auth stack (double route+service guards remain intentional defense-in-depth).

## D071 - Galaxy-Brain Auth Consolidation (High Utility)

**Date:** 2026-05-29

**Decision:** (1) Shared `legacyMutationErrorMessage` in `legacy-mutation-error.ts`; `document-mutations` uses `guardDocumentMutation` with legacy wire errors. (2) `guardDocumentMutationsBatch` + `getReadableDocumentsBatch` for bulk issue guards. (3) Service-only write guards on program/project mutating routes (UUID param check at route). (4) Single/bulk issue delete parity via `includeArchived` on `requireIssueWrite`. (5) Bulk state updates use `getTimestampUpdates` + `incomplete_children` per issue. (6) SS-FIND-003: remove `status` from week PATCH schema; lifecycle via `POST /start`. (7) `takeSprintSnapshot` filters issues with `VISIBILITY_FILTER_SQL`. (8) Merge preview uses write guards like merge execute (no read/visibility mismatch).

**Consequence:** One fewer auth error dialect in HTTP responses; bulk guards scale better; week status cannot be patched around lifecycle; snapshots match visible issue lists.

## D072 - FleetGraph Chat Behavior Golden Cases

**Date:** 2026-05-29

**Decision:** Treat FleetGraph chat quality as a behavior contract, not a function-output snapshot. Add `api/src/fleetgraph/eval/chat-behavior.ts` as the replayable corpus for real chat problems: greetings must stay conversational, summaries must be grounded in visible context, simplification must be materially shorter, sparse context must not invent facts, and follow-ups may use bounded recent history. `/api/fleetgraph/chat` accepts optional capped `history` entries so new requests can be distinguished from rewrite requests.

**Consequence:** Every future chat regression should become a named golden case before or with the fix. CI uses rubric evals with mocked `@langchain/openai` on the real `generateContextChatText` path. Chat history is bounded request context, not a new persistence surface or a broad workspace assistant.

## D073 - FleetGraph Final Proof Requires Deployed All-Signal Evidence

**Date:** 2026-05-29

**Decision:** Week 5 final FleetGraph proof now treats deployed worker evidence as mandatory for final claims. Render enables `FLEETGRAPH_WORKER_ENABLED=true`; final proof must show recent worker ticks plus deployed findings/runs for `blocked`, `stale`, and `at_risk`. The proof packet must fail closed when deployed API/web/DB evidence is missing, and skipped attention-loop steps are not acceptable final-submission proof.

**Consequence:** D005 remains true for local/default safety, but final deployed Render is an explicit exception with reviewer proof obligations. Local E2E test hooks prove deterministic event handling only; they cannot be described as deployed no-user-present proof. Future final-submission docs must map every claimed use case to either deployed evidence, public trace evidence, or executable golden cases without implying that health checks alone prove FleetGraph availability.

## D074 - FleetGraph Proof Packet Owns Cost, Trace, And Public Evidence

**Date:** 2026-05-29

**Decision:** Make `pnpm fleetgraph:proof` the authoritative Week 5 evidence packet for cost and traces. It reads `fleetgraph_runs` token/cost/trace metadata, reports graph invocation count, model call count, input/output/total tokens, deterministic versus real-model run counts, estimated FleetGraph runtime cost, and 100/1,000/10,000-user projections. It publishes `latest.html/json/md` both under `my-docs/evidence/fleetgraph-proof/` and `web/public/fleetgraph-observability/proof/`.

**Consequence:** Placeholder trace claims are no longer acceptable. Missing public trace links for blocked, stale, at-risk, or on-demand proof keep the deployed packet blocked/risk. Development-wide Claude/API/coding-assistant spend remains explicitly excluded unless a separate instrumentation path is added.

## D075 - FleetGraph Chat Uses Bounded Page Context

**Date:** 2026-05-29

**Decision:** Add `FleetGraphPageContext` as a capped chat capsule for issues lists, My Week, and embedded project/program/week issue tabs via the reusable `IssuesList`. It includes route, surface, title, filters, sort/view mode, counts, up to 25 visible item summaries, and up to 8 selected IDs.

**Consequence:** Chat can answer from what the user is looking at without becoming a raw DOM scraper or broad workspace assistant. Client labels are hints; the API reloads IDs through existing authorization before enriching context. Mutation/contact remains human-gated.

## D076 - FleetGraph Public Proof Publishes Only Passing Deployed Evidence

**Date:** 2026-05-29

**Decision:** Local-only proof runs write local `my-docs/evidence/fleetgraph-proof/latest.*` only. Public artifacts under `web/public/fleetgraph-observability/proof/` are written only when a non-local deployed/both proof packet passes. Non-local proof is blocked if the focused attention-loop E2E is skipped, and required trace links must be valid public HTTP(S) URLs.

**Consequence:** The public reviewer URL cannot be accidentally overwritten by a local deterministic packet. Final submission still requires a deployed proof run with DB evidence, focused E2E, and public trace links.

## D077 - FleetGraph Page Context And Usage Wire Refactor

**Date:** 2026-05-29

**Decision:** Stabilize FleetGraph page-context registration with fingerprint guards so selection/filter churn does not republish the app shell context. Add `scoped_issues_list` as the surface for project/program/week-scoped issue lists. Centralize page-context builders in `web/src/fleetgraph/page-context.ts`, chat turn state in `useFleetGraphChatTurns`, and assistant wiring in `FleetGraphAssistantShell` (provider + probes). API `usageMetadata` is built only through `usageMetadataFromResult` in `api/src/fleetgraph/usage-metadata.ts` and is omitted when `modelCalls === 0`. Split `scripts/fleetgraph-proof/run.mjs` into command, git, and deployed-evidence modules.

**Consequence:** Feature work should not reintroduce pass-through assistant layers, duplicate usage mappers, or raw page-context objects in list pages. Regenerated proof/eval JSON belongs in chore/CI commits, not mixed with product refactors. Context-chat finding resolution may run in parallel; behavior must stay aligned with existing golden cases.

## D078 - FleetGraph Live Reviewer Proof Is The Authority

**Date:** 2026-05-29

**Decision:** Add authenticated `/fleetgraph/reviewer` as the Week 5 reviewer control room. It assembles live proof chains from Ship/FleetGraph durable ledgers and gates mutating controls behind workspace admin plus `FLEETGRAPH_REVIEWER_PROOF_ENABLED=1`. Static proof packets now carry the live reviewer chain and fail/block when the live chain is not complete.

**Consequence:** Reviewer proof is no longer just generated HTML. The reviewer can run a current-week blocked scenario, watch source -> attention event -> worker tick -> graph run -> trace -> finding -> notification projection -> chat/human gate, and generate the static packet from that result. Documentation must describe notifications as derived projections and avoid claiming static artifacts are fresher or more authoritative than the live verifier.

## D079 - Reviewer Mutation Proof Is Durable Evidence, Not Copy

**Date:** 2026-05-30

**Decision:** Add `fleetgraph_reviewer_chat_proofs` as the minimal reviewer-only ledger for chat before/after source snapshots. The live reviewer chain reads this table for the mutation gate and labels missing evidence as `not_measured` / proof incomplete instead of implying source damage.

**Consequence:** Reviewer chat can prove "no Ship source mutation" from persisted evidence instead of UI copy or inference. The product path and submission proof are separate statuses: the product can work while submission proof remains incomplete until the reviewer-specific gate is measured.

## D080 - Reviewer Repair Owns Safe Proof Healing

**Date:** 2026-05-30

**Decision:** Keep `Generate packet` read-only. The week-blocker scenario now records source-mutation proof automatically after the live finding exists, and `/api/fleetgraph/reviewer/repair` is the explicit admin/env-gated path for safe missing gates such as `source_mutation_check`.

**Consequence:** Packet generation cannot mask missing evidence by mutating state. Reviewers get a visible “Repair proof” action when the product path works but submission proof is incomplete, and unsupported gaps remain named instead of silently patched.

## D081 - Reviewer Packet Uses Canonical Selected Proof

**Date:** 2026-05-30

**Decision:** The reviewer dashboard and static packet generator prefer complete `week-blocker` chains over broken historical chains. Explicit reviewer selection wins; otherwise the server chooses the best complete canonical chain before falling back to historical evidence.

**Consequence:** A valid current-week proof no longer gets hidden behind older broken rows. `Generate packet` packages the selected/canonical live verifier result instead of blindly using the newest FleetGraph run.

## D082 - Local Reviewer Packet Trusts The Live Chain

**Date:** 2026-05-30

**Decision:** For local reviewer-control-room packets, a complete live reviewer chain is the submission authority. The older golden-case matrix remains diagnostic and deployed proof remains stricter, but skipped local proof tests or missing historical trace-decision coverage do not fail a packet whose live chain has source, event, worker, graph, trace, finding, notification projection, mutation, and human-gate proof.

**Consequence:** The dashboard no longer reports contradictory states where the canonical live proof is complete but the static packet fails because supplemental historical evidence was not refreshed. Deployed/final public proof still keeps its deployed evidence, public trace, and focused E2E requirements.

## D083 - Reviewer Scenario Runs Create Fresh Evidence

**Date:** 2026-05-30

**Decision:** The reviewer dashboard's `Run scenario` action requests a fresh week-blocker source issue by default. Reusing one deterministic reviewer issue made repeated scenario runs look active while the 25-row historical sample barely moved and could leave stale/broken rows dominating the reviewer view.

**Consequence:** The canonical submission proof remains the latest complete week-blocker chain, while the 25-row historical audit is explicitly background evidence. To raise historical completeness, run fresh reviewer scenarios or a future dedicated scenario suite; do not expect worker ticks or packet generation to repair unrelated historical rows.

## D084 - Reviewer Proof Fails Closed On Packet And Mutation Integrity

**Date:** 2026-05-30

**Decision:** Harden reviewer proof around causal integrity. Source-mutation proof now snapshots the protected issue surface, compares nested state structurally, and only satisfies a finding-specific chain when it comes from the reviewer source-mutation proof run for the same workspace/source/finding after the certified run. Static packet generation returns the packet verdict (`pass`, `blocked`, `fail`, `risk`) and treats non-passing packets as command failures instead of translating them into chain status.

**Consequence:** A complete-looking chain cannot borrow unrelated chat proof, hide source changes outside three scalar fields, or report a failed static packet as complete. Reviewer controls require an interactive admin session, not an admin-scoped API token, and proof command diagnostics are redacted before returning to the UI.

## D085 - Reviewer Chain Decision Coverage Is Scenario-Local

**Date:** 2026-05-30

**Decision:** A live reviewer chain proves the graph decision for its own causal story. Global graph decision coverage (`create_finding`, `update_finding`, `quiet_exit`, `explain`, and newer scenario decisions) remains in the proof scenario matrix, not in each selected chain's trace-quality gate.

**Consequence:** `Generate packet` no longer fails a complete current-week chain because unrelated global decisions were not observed inside that one chain. The static packet and dashboard now use the same boundary for chain completeness while still allowing scenario tests to prove broader FleetGraph behavior.

## D086 - FleetGraph Contextual Chat Is The Product Surface

**Date:** 2026-05-30

**Decision:** Improve FleetGraph by making the existing chat understand current page context, attached document/page context, notification/finding context, and bounded recent turns. Do not add new buttons, quick actions, panels, banners, dashboards, or reviewer-only affordances for this slice.

**Consequence:** Future contextual-chat work should add behavior cases and strengthen the existing context payload/runtime path. Chat context informs a free conversation; it must not become a guided workflow, mutation surface, or action menu. Mutation/contact requests remain human-gated and must never claim Ship records or people were changed/contacted. Client page labels are ID hints only; answer/model/source text must come from authorized server-loaded records.

## D087 - FleetGraph Blast Radius Person Node Visibility

**Date:** 2026-05-31

**Decision:** Blast-radius person nodes follow the same source-visibility contract as FleetGraph evidence. The route already requires both source issue and source sprint to be readable before returning a map. Person documents are filtered in one batch via `filterReadableDocumentIds`. Rows resolved only through `users.name` (no person document) may appear when the root finding is visible, because assignee/owner IDs are properties on those already-authorized source documents.

**Consequence:** Blast radius must not expose person documents the actor cannot read. It must not add a separate person-document read path per row when batch filtering is available. User-name fallback rows are assignee/owner labels from visible source context, not a bypass around document visibility for person records.

## D088 - FleetGraph Reviewer Page Module Boundaries

**Date:** 2026-05-31

**Decision:** Decompose `FleetGraphReviewerPage` into three layers: pure helpers under `web/src/fleetgraph/reviewer/`, data hooks under `web/src/hooks/useFleetGraphReviewer*.ts`, and UI panels under `web/src/components/fleetgraph-reviewer/`. The page file remains the layout orchestrator only.

**Consequence:** New reviewer UI should land in the component folder, not grow the page monolith. Integration tests stay on the page; pure helpers and hooks get colocated unit tests.

## D089 - FleetGraph Deep Module Facades

**Date:** 2026-05-31

**Decision:** Introduce small FleetGraph facades instead of splitting god files immediately. Shared `reviewer-verifier` owns gate step keys, `proofGapLabel`, `productPath`, `preferredReviewerProofChain`, and chain enrichment. API adds `finding-projection`, `attention-pipeline`, `fleetgraph-runtime`, `context-chat-service`, and `wire-contract`. Reviewer chains on the wire include `productPath`, `missingLabels`, and `summary.preferredChainId` so web does not re-derive verifier semantics.

**Consequence:** New reviewer presentation must consume server wire fields. Do not reintroduce web-only `productPathStatus` math against a different step list. Blast radius and finding routes should project through `projectFindingForActor`. Zod-in-shared / OpenAPI codegen for the full wire layer stays a follow-up, not mixed into this facade pass.

## D090 - FleetGraph Galaxy-Brain Follow-Through

**Date:** 2026-05-31

**Decision:** Ship the three deferred deep-module upgrades together: (1) reviewer + core FleetGraph wire Zod lives in `shared/src/fleetgraph/wire-schema-factory.ts` with API OpenAPI wrappers in `openapi-wire-schemas.ts` and regenerated `web/src/api/generated/ship-openapi.d.ts`; (2) `reviewer-proof/` folder replaces the monolithic file; (3) live operation drawer progress reads refreshed proof-chain steps via `operation-chain-steps.ts`, not cosmetic timers.

**Consequence:** Extend non-reviewer FleetGraph Zod into the shared factory before adding more hand types. Reviewer imports use `reviewer-proof/index.js` explicitly (NodeNext). Operation UI must not reintroduce catalog-only progress that ignores chain steps.

**Audit (2026-05-31, `/are-you-sure`):** OpenAPI wrappers must reference `wire-schema-factory` schemas (no parallel finding/notification Zod). Live drawer uses `chainStepsForOperation` on refreshed chains while `running`; `activeChainStepIndex` treats all-pass mid-run as last step. Route/test fixtures include `productPath`, `missingLabels`, `preferredChainId`.

**Follow-through (2026-05-31):** `buildFleetGraphRouteWireSchemas` covers blast radius, chat, run/manual, and list wrappers; reviewer routes use `reviewer-wire-response.ts` `.parse()` before `res.json`; dead `operationSteps()` removed; UI gap copy uses `chainMissingLabels` (server `missingLabels` first).

## D091 - ESLint Category-First Cleanup (Phases 1–4)

**Date:** 2026-05-31

**Decision:** Reduce lint noise by clearing whole rule categories in order: unused vars and template expressions first, then concentrated `no-explicit-any` in API tests, then `no-non-null-assertion` in tests/e2e/scripts (excluding `api/src/db/seed.ts` for now). Do not start `max-lines` file splits or broad `no-unsafe-*` typing in the same pass.

**Consequence:** New lint fixes should prefer mechanical category completion (delete unused bindings, type guards, `z.infer` in tests) over eslint-disable or config carve-outs. Seed non-null and `max-lines` remain a follow-up slice. FleetGraph reviewer page should not destructure unused hook fields (`setError`, `refresh`).

**Follow-through (2026-05-31):** Promoted the four mechanical rules to `error` after clearing warnings. `seed.ts` uses `seedAt()` for invariant array/map access; `max-lines` and `no-unsafe-*` stay warn until a dedicated pass.

**Follow-through (2026-05-31, unsafe return/call/argument):** Cleared `no-unsafe-return`, `no-unsafe-call`, and `no-unsafe-argument` repo-wide; promoted all three to `error`. E2E JSON boundaries use `e2e/fixtures/typed-json.ts`; web fetch JSON uses `web/src/api/read-json.ts`.

## D092 - Tier 1 Route Test OpenAPI Boundaries

**Date:** 2026-05-31

**Decision:** API route integration tests must assert HTTP JSON through registered OpenAPI Zod schemas (`expectOpenApiResponse`), not raw `res.body`. Shared helpers: `getCsrfTokenFromApp`, `expectApiErrorResponse`, `expectJsonBody` under `api/src/test/`. When tests fail schema validation, fix the API/OpenAPI registration (e.g. bulk issue responses use `mapIssueListItem`; `assignee_name` nullable on `extractIssueFromRow`) instead of weakening tests.

**Consequence:** New route tests copy the helper pattern; paths in assertions omit the `/api` prefix. Legacy shapes without OpenAPI JSON use `expectJsonBody` only. Tier 2 is production route JSONB narrowing; Tier 3 is E2E `readJsonAs`.

## D093 - Tier 2 Production Route SQL + JSONB Boundaries

**Date:** 2026-05-31

**Decision:** Production API route handlers under `api/src/routes/**` (excluding `*.test.ts`) must type every `pool.query` row projection and narrow persisted `documents.properties` JSONB at named boundaries — not inline dot-access on `Record<string, unknown>`. Shared helpers: `api/src/routes/route-query-rows.ts` (comment/standup/iteration row types + response mappers + `requireFirstRow` re-export), `api/src/utils/document-properties.ts` (read-only property flatteners for list/GET/bootstrap/restore). `pickBootstrapDocumentProperties` lives in `document-properties.ts` and is re-exported from `constants/bootstrap-document.ts`.

**Consequence:** Production route `no-unsafe-assignment` + `no-unsafe-member-access` at zero (~389 cleared). When typing exposes an OpenAPI/runtime mismatch, fix the mapper or handler — do not eslint-disable. Tier 3 is E2E typed JSON; `max-lines` route splits remain a separate pass.

## D094 - Tier 3 E2E Typed JSON + Seed SQL Rows

**Date:** 2026-05-31

**Decision:** E2E specs and fixtures must parse Playwright `APIResponse` JSON through `readJsonAs<T>` (`e2e/fixtures/typed-json.ts`) with assertion-minimal types in `e2e/fixtures/e2e-api-types.ts` — not raw `.json()` plus dot-access on `any`. Testcontainers seed SQL in `e2e/fixtures/isolated-env.ts` uses `e2e/fixtures/e2e-seed-rows.ts` (`IdRow`, `requireFirstRow`) for `pool.query` rows. Do not import web OpenAPI generated types into E2E; full wire validation stays in Tier 1 API route tests.

**Consequence:** E2E `no-unsafe-assignment` + `no-unsafe-member-access` at zero (~487 cleared). Partial `readJsonAs` without shared types or mixed `.json()` calls does not count as migrated. Next: repo tail (`seed.ts`, services, collaboration) and optional ESLint error promotion on cleaned paths.

## D095 - FleetGraph PM Chat Is Model-Primary Conversation

**Date:** 2026-06-01

**Decision:** PM-facing `POST /api/fleetgraph/chat` is a conversational LLM path. Context chips and page/finding attachments name the topic; they are not regex intents or command menus. `shouldUseChatModel()` is true when `OPENAI_API_KEY` and `FLEETGRAPH_MODEL` are set. Without them, `chatModelUnavailableAnswer` returns an honest configuration message only. The old template router (`deterministicContextChatAnswer`) and the chat-deterministic env flag are removed.

**Consequence:** Do not reintroduce large deterministic chat templates, intent classifiers, or flags that disable the chat model in dev/prod. Detection/worker SQL policy, human gates, and permission filtering stay as-is. Active contract: `my-docs/fleetgraph-conversational-chat.md`. Excised submission text: `my-docs/project-weeks-sot/week-5/archive/submission-deterministic-chat/`.
