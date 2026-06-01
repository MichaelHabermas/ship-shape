# FleetGraph Architecture

FleetGraph has one shared execution boundary: `api/src/fleetgraph/core.ts` exports `runFleetGraph`, builds the LangGraph runtime, routes proactive/on-demand triggers, and coordinates persistence, actor-filtered evidence, trace metadata, and visible results.

Subfolders are used only where the reason-to-change is distinct:

- `runtime/`: helper logic behind `runFleetGraph`, including audience selection, draft shaping, output mapping, run serialization, JSON guards, context assembly for chat, and a thin offline chat fallback.
- `detection/`: read-only candidate selection, current-week resolution, and manual detector preview.
- `execution/`: worker tick orchestration, scheduled proactive execution, and bounded manual admin execution.

Top-level FleetGraph files remain for major boundaries: `core.ts`, `persistence.ts`, `evidence.ts`, `api-contract.ts`, `types.ts`, trace/model modules, tests, and evals.
