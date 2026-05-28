# FleetGraph Architecture

FleetGraph has one shared execution boundary: `api/src/fleetgraph/core.ts` exports `runFleetGraph`, builds the LangGraph runtime, routes proactive/on-demand triggers, and coordinates persistence, actor-filtered evidence, trace metadata, and visible results.

Focused runtime helper modules under `api/src/fleetgraph/runtime/` keep the core from becoming a catch-all:

- `audience.ts`: chooses the smallest useful Ship audience and next action for unblock recommendations.
- `drafts.ts`: builds deterministic draft refinements without model calls.
- `outputs.ts`: maps decision packets and persisted runs into visible output and change summaries.
- `run-recording.ts`: converts runtime decisions into `fleetgraph_runs` inputs and `FleetGraphResult`.
- `json.ts`: shared JSON record/string guards for persistence-shaped data.
