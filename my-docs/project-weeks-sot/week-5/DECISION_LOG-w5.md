# Decision Log

Durable choices made during the week 5 work. This file exists so we can defend why structural decisions were made, what they do not claim, and what future work must preserve.

## D001 - FleetGraph MVP Source Truth And Boundary

**Date:** 2026-05-25

**Decision:** Treat `my-docs/project-weeks-sot/week-5/w5-specs/` as authoritative, with `PRESEARCH.md`, `FLEETGRAPH.md`, `ARCHITECTURE.md`, `ARCHITECTURAL_DEFENSE.md`, and `IMPLEMENTATION_PLAN_MVP.md` as aligned execution docs. The MVP vertical slice is blocked urgent/high active-week work with real blocker text becoming an action-ready FleetGraph finding through deterministic SQL before graph reasoning.

**Boundary:** FleetGraph owns diagnosis state only: findings, runs, evidence snapshots, trace metadata, and draft content. Ship remains canonical for documents, issues, weeks, associations, ownership, priority, status, and content. Any Ship mutation or contact with another person requires a human gate.

**Consequence:** Future slices must not add a new document type, invent `blocked` state or `critical` priority, let the LLM choose scan scope, build separate proactive/on-demand graph cores, or surface user-visible claims without visible evidence.

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
