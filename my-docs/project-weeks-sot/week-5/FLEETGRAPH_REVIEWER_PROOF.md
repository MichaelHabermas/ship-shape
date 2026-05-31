# FleetGraph Reviewer Guide

Live proof first: `https://ship-shape-web.onrender.com/fleetgraph/reviewer`.

Use the reviewer dashboard as the authority. The public proof packet is a generated snapshot: `https://ship-shape-web.onrender.com/fleetgraph-observability/proof/latest.html`.

## Pass Criteria

| Gate | Must show |
| --- | --- |
| Dashboard | Selected chain is `complete` |
| Causality | Source -> attention event -> worker tick -> graph run -> trace -> finding -> notification projection -> chat/human gate |
| Proactive graph | `create_finding` trace for blocked, stale, and at-risk cases |
| On-demand graph | `explain` trace from page/finding context |
| Quiet/create separation | Quiet exits cannot satisfy create-path rows |
| Human gate | Chat/next-action proof shows approval required before mutation/contact |
| Latency | Source-to-notification chain is under 5 minutes |
| Mutation safety | Source issue is unchanged by chat proof |
| Public traces | Each Reviewer Test Cases row has a reachable `smith.langchain.com/public/...` URL |
| Static packet | Verdict is `pass` |

## Reviewer Steps

1. Sign in with the reviewer/admin account.
2. Open `/fleetgraph/reviewer`.
3. If no complete chain is selected, run `Run scenario`.
4. If a gate says proof incomplete, use the missing list before judging the packet.
5. Open the right-pane chat proof and confirm the human gate.
6. Open the public proof packet and verify `Verdict: pass`.
7. Open each public LangSmith trace link in the Reviewer Test Cases table.

## Evidence Map

| Evidence | Location |
| --- | --- |
| Live reviewer chain | `/fleetgraph/reviewer` |
| Public proof packet | `/fleetgraph-observability/proof/latest.html` |
| Root final submission | `FLEETGRAPH.md` |
| Machine-readable proof | `web/public/fleetgraph-observability/proof/latest.json` |
| Public trace verifier | `pnpm fleetgraph:proof:verify-traces` |
| Proof consistency checker | `pnpm fleetgraph:proof:check` |

## Status Labels

- `complete`: all required proof gates passed.
- `in_progress`: event/run exists but the chain has not settled.
- `proof incomplete`: a required gate is missing; do not treat as passing proof.
- `failed`: graph execution or packet generation failed.

## Non-Claims

- No autonomous Ship source-record mutation.
- No external contact/message sending.
- No public unauthenticated reviewer control.
- No claim that local-only proof is deployed proof.
