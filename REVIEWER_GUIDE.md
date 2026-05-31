# Reviewer Guide

Start here: https://ship-shape-web.onrender.com/fleetgraph/reviewer

Use the authenticated FleetGraph reviewer dashboard first. It is the live proof surface. The static proof packet is a generated snapshot.

## Primary Links

| Need | Link |
| --- | --- |
| Live reviewer dashboard | https://ship-shape-web.onrender.com/fleetgraph/reviewer |
| Public proof packet | https://ship-shape-web.onrender.com/fleetgraph-observability/proof/latest.html |
| Final submission doc | [`FLEETGRAPH.md`](./FLEETGRAPH.md) |
| Pre-search checklist | [`PRESEARCH.md`](./PRESEARCH.md) |
| Machine-readable proof | [`web/public/fleetgraph-observability/proof/latest.json`](./web/public/fleetgraph-observability/proof/latest.json) |
| Web app | https://ship-shape-web.onrender.com/ |
| API health | https://ship-shape-api.onrender.com/health |

Reviewer login: use the deployed reviewer credentials supplied out of band. No deployed password is published in this repo.

## What To Verify

| Requirement | Pass condition |
| --- | --- |
| Live proof | Dashboard selected chain is `complete` |
| Proactive agent | Chain shows source -> attention event -> worker tick -> graph run -> trace -> finding -> notification projection |
| On-demand agent | Dashboard chat proof shows page/finding context and a human gate |
| Same graph | `FLEETGRAPH.md` and traces show proactive and on-demand paths through `runFleetGraph` |
| Public traces | Public proof packet has reachable `smith.langchain.com/public/...` links for every Reviewer Test Cases row |
| Quiet/create separation | Required decision equals observed decision; quiet exits do not satisfy create rows |
| Signals | Blocked, stale, and at-risk all appear in deployed proof |
| Stale threshold | Stale proof says `30+ days`, not `180+ days` |
| Latency | Live source-to-notification proof is under 5 minutes |
| Human approval | Chat/next action requires approval before Ship mutation or external contact |
| No source mutation | Mutation proof/source-unchanged proof is present |
| Cost | Proof packet includes graph invocations, model calls, tokens, deterministic/real-model counts, estimated cost, and 100/1,000/10,000-user projections |

## Fast Review Path

1. Sign in to Ship with the reviewer account.
2. Open https://ship-shape-web.onrender.com/fleetgraph/reviewer.
3. Confirm the selected chain is `complete`.
4. If needed, run `Run scenario`; wait for the chain to complete.
5. Inspect the chain steps: source, event, worker, graph run, trace, finding, notification projection, chat, human gate.
6. Open the public proof packet.
7. Confirm `Verdict: pass`.
8. Open each public LangSmith trace link in the Reviewer Test Cases table.
9. Check `FLEETGRAPH.md` for the same direct trace links and required/observed decision labels.

Expected loop:

`Ship issue state -> attention event/worker -> FleetGraph finding -> notification projection -> source issue -> context chat -> human gate`

## Verification Commands

```bash
pnpm fleetgraph:proof:check
pnpm fleetgraph:proof:verify-traces
```

Final proof generation command:

```bash
FLEETGRAPH_PROOF_API_URL=https://ship-shape-api.onrender.com \
FLEETGRAPH_PROOF_WEB_URL=https://ship-shape-web.onrender.com \
FLEETGRAPH_PROOF_RENDER_POSTGRES=ship-shape-db \
E2E_RESULTS_DIR=test-results/fleetgraph-proof \
pnpm fleetgraph:proof -- --mode both --with-e2e
```

Do not use `--skip-tests`, omit `--with-e2e`, or pass `--allow-blocked` / `--allow-risk` for final submission.

## Non-Claims

- FleetGraph does not mutate Ship source records without human approval.
- FleetGraph does not send external messages.
- The reviewer dashboard requires authenticated access; it is not a public bypass.
- Static proof is a snapshot. The live dashboard is the authority.

## Implementation Anchors

| Boundary | File |
| --- | --- |
| Shared graph runtime | [`api/src/fleetgraph/core.ts`](./api/src/fleetgraph/core.ts) |
| FleetGraph routes | [`api/src/routes/fleetgraph.ts`](./api/src/routes/fleetgraph.ts) |
| Worker execution | [`api/src/fleetgraph/execution/worker.ts`](./api/src/fleetgraph/execution/worker.ts) |
| Reviewer dashboard | [`web/src/pages/FleetGraphReviewerPage.tsx`](./web/src/pages/FleetGraphReviewerPage.tsx) |
| Reviewer panels/helpers | [`web/src/components/fleetgraph-reviewer/`](./web/src/components/fleetgraph-reviewer/) and [`web/src/fleetgraph/reviewer/`](./web/src/fleetgraph/reviewer/) |
| Notifications entrypoint | [`web/src/components/FleetGraphNotificationsProbe.tsx`](./web/src/components/FleetGraphNotificationsProbe.tsx) |
| Shared wire types | [`shared/src/types/fleetgraph.ts`](./shared/src/types/fleetgraph.ts) |
