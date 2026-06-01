# Excised decision sections (2026-06-01)

## D020 - FleetGraph Model Calls Are Hybrid And Explicitly Opt-In (chat clause removed from active log)

**Decision:** Epic 4 permits real model calls only for proactive create, and only when explicitly enabled with `FLEETGRAPH_REAL_MODEL_ENABLED=true` plus model/API-key configuration. Update, quiet, explain, refine, dismiss/resolve, and error paths remain deterministic and record zero model calls.

**Consequence:** Local tests and default worker/API wiring cannot accidentally spend tokens.

## D054 - Context Chat Is A Bounded Graph Capsule (removed from active log)

**Decision:** The approved 10x on-demand path is a Context Capsule, not generic chat. Typed prompts enter the same FleetGraph runtime as `context_chat`, resolve the active notification/finding/page context, and support only bounded intents: `why_flagged`, `next_step`, and `summarize_changes`.

**Consequence:** `/api/fleetgraph/chat` records `fleetgraph_runs` with distinct graph paths and zero model calls for the current deterministic slice.

## D072 - FleetGraph Chat Behavior Golden Cases (deterministic-CI clause removed from active log)

**Consequence (excised):** CI-safe checks remain deterministic and no-model by default; Playwright smoke proves browser wiring only.
