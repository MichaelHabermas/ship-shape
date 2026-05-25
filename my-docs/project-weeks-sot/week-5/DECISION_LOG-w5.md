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
