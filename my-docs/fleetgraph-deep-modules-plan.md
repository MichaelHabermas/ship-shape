# FleetGraph deep modules — execution plan

**Date:** 2026-05-31  
**Scope:** All eight architecture candidates (api / web / shared). Radical simplicity: small facades, no god-file splits unless required.

## Execution order

| Phase | Module | Deliverable |
| --- | --- | --- |
| 1 | Wire + verifier foundation | Shared gate constants + `reviewer-verifier` pure helpers; chain wire fields `productPath`, `missingLabels`, `summary.preferredChainId` |
| 2 | Reviewer proof authority | API `chainFromRow` enriches via shared; remove web duplicate gate math |
| 3 | Finding projection | `finding-projection.ts` → `projectFindingForActor`; blast-radius + routes use it |
| 4 | Blast radius | Re-export `blastRadiusMapForFinding` alias; tests unchanged |
| 5 | Attention pipeline | `attention-pipeline.ts` facade over events + worker tick |
| 6 | Runtime shell | `fleetgraph-runtime.ts` re-exports `runFleetGraph` |
| 7 | Context chat | `context-chat-service.ts` facade over `resolveContextChatBundle` + answer path |
| 8 | Control room | `useReviewerControlRoom`; drawer uses chain steps after refresh |
| 9 | Verify | type-check, lint (no new warnings), API tests, reviewer smoke |

## Galaxy-brained (needs your call)

1. **Zod-in-shared / OpenAPI codegen** — eliminates triple type maintenance (6). High payoff, separate PR-sized effort. **Not in this pass** unless you want it now.
2. **Split `reviewer-proof.ts` into a folder** — only if verifier facade is insufficient after this pass.
3. **Split `core.ts` nodes** — deferred; runtime facade only.

## Status (2026-05-31)

| Phase | Status |
| --- | --- |
| 1 Wire + verifier | Done — `shared/src/fleetgraph/reviewer-verifier.ts`, chain fields `productPath`, `missingLabels`, `summary.preferredChainId` |
| 2 Reviewer authority | Done — API enriches chains; web uses server fields |
| 3 Finding projection | Done — `api/src/fleetgraph/finding-projection.ts` |
| 4 Blast radius | Done — alias `blastRadiusMapForFinding` |
| 5 Attention pipeline | Done — `api/src/fleetgraph/attention-pipeline.ts` |
| 6 Runtime shell | Done — `api/src/fleetgraph/fleetgraph-runtime.ts` |
| 7 Context chat | Done — `api/src/fleetgraph/context-chat-service.ts` |
| 8 Control room | Done — `web/src/hooks/useReviewerControlRoom.ts` |

## Galaxy-brain follow-through (2026-05-31)

| Item | Status |
| --- | --- |
| Zod-in-shared + OpenAPI codegen | Done — `shared/src/fleetgraph/wire-schema-factory.ts`, `api/src/fleetgraph/openapi-wire-schemas.ts`, `pnpm openapi:generate` |
| Split `reviewer-proof.ts` | Done — `api/src/fleetgraph/reviewer-proof/` (9 modules) |
| Chain-step operation drawer | Done — `operation-chain-steps.ts`; no fake 1400ms timer |

## Docs touchpoints

- `my-docs/MEMORY.md` — deep module map
- `my-docs/engineering-lessons.md` — single-source gate vocabulary lesson
- `my-docs/project-weeks-sot/week-5/DECISION_LOG-w5.md` — D089 deep modules
- This file — status table above
