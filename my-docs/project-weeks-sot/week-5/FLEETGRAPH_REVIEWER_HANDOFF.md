# FleetGraph Reviewer Handoff

Start here: authenticated reviewer dashboard `/fleetgraph/reviewer`.

The dashboard is the live proof surface. It shows the deployed source -> attention event -> worker tick -> graph run -> trace -> finding -> notification projection -> chat/human gate chain. Use it before the static packet.

## Reviewer Links

- Live dashboard: `https://ship-shape-web.onrender.com/fleetgraph/reviewer`
- Public proof packet: `https://ship-shape-web.onrender.com/fleetgraph-observability/proof/latest.html`
- Root submission doc: `FLEETGRAPH.md`
- Public proof JSON: `web/public/fleetgraph-observability/proof/latest.json`

## What To Check

1. Sign in with the reviewer/admin account.
2. Open `/fleetgraph/reviewer`.
3. Confirm the selected chain is `complete`.
4. Confirm the chain includes source, event, worker, graph run, public trace, finding, notification projection, chat, and human gate.
5. Open the public proof packet and confirm `Verdict: pass`.
6. Open each `smith.langchain.com/public/...` trace link from the Reviewer Test Cases table.

## Required Evidence

| Requirement | Where it is shown |
| --- | --- |
| Proactive path | Dashboard chain plus `FLEETGRAPH.md` test cases 1-3 and 7 |
| On-demand path | Dashboard chat/human-gate panel plus `FLEETGRAPH.md` test cases 4-5 |
| Public traces | Public proof packet Reviewer Test Cases table |
| Quiet/create separation | Required decision equals observed decision in `FLEETGRAPH.md` and public packet |
| Stale threshold | `30+ days`; no `180+ days` proof text |
| No autonomous Ship mutation | Dashboard mutation proof and `e2e/fleetgraph-attention-loop.spec.ts` |
| Cost evidence | Public proof packet Cost And Usage section |

## Verification Commands

```bash
pnpm fleetgraph:proof:check
pnpm fleetgraph:proof:verify-traces
```

Current expected result: both pass.

## Non-Claims

- FleetGraph does not mutate Ship source records without human approval.
- FleetGraph does not send external messages.
- The dashboard requires authenticated access; it is not a public bypass.
- Static proof is a snapshot. The dashboard is the live authority.
