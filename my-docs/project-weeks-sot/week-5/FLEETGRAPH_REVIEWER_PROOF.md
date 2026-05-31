# FleetGraph Reviewer Control Room

Live authority: `/fleetgraph/reviewer`.

The reviewer control room proves FleetGraph from deployed Ship data. It is not a static HTML claim. The static proof packet is generated from the latest live verifier chain and should be treated as a snapshot.

## Required Gates

| Gate | Pass condition | Failure meaning |
| --- | --- | --- |
| Auth | Reviewer is signed in with an interactive workspace-admin session; reviewer controls require `FLEETGRAPH_REVIEWER_PROOF_ENABLED=1` | Public, non-admin, or generic API-token callers cannot create or inspect reviewer proof data |
| Scenario | Week-blocker scenario creates/reuses a current-week issue and week association | No week-native proof chain exists |
| Causality | Source -> attention event -> worker tick -> graph run -> trace -> finding -> notification projection -> chat/human gate | Chain is partial; do not claim full loop |
| Trace quality | Trace ID, trace URL, node path, decision, usage metadata, and sanitized metadata are present | Proof is broken even if the UI looks right |
| Quiet/create separation | Quiet exit cannot satisfy create-path proof | False positive proof |
| Freshness | Proof/traces are under 24h old; live worker tick is under 10m old | Stale proof, not live proof |
| Latency | Source event to notification projection is under 5 minutes | Live pass fails latency |
| Mutation | Protected source issue state matches before/after the reviewer source-mutation proof run for the same finding | Fails closed as `not_measured` until reviewer repair/scenario captures bound before/after source state |
| Packet | Static packet verdict is `pass` and matches the selected live chain | `blocked`, `fail`, or `risk` remains a failed packet action in the dashboard |

## Live Runbook

1. Sign in with the FleetGraph reviewer account.
2. Open `/fleetgraph/reviewer`.
3. Run `Run scenario`.
4. Confirm the selected chain is `complete`; if it is `broken`, read the missing list first.
5. Ask the reviewer chat from the right pane and confirm the human gate is explicit.
6. Run `Generate packet` only after the live chain is complete.

## Expected Durable Rows

| Stage | Table/source | Notes |
| --- | --- | --- |
| Source | `documents`, `document_associations`, `issue_iterations` | Reviewer issue belongs to the reviewer week and is blocked |
| Event | `fleetgraph_attention_events` | `reason = reviewer-week-blocker-scenario` |
| Worker | `fleetgraph_worker_ticks` | Recent completed tick near the event/run |
| Graph | `fleetgraph_runs` | Proactive run with safe trace metadata and usage metadata |
| Finding | `fleetgraph_findings` | Open/needs-confirmation finding with safe evidence snapshot |
| Notification | Derived projection | Explicitly not a separate source-of-truth row |
| Chat | `fleetgraph_runs` on-demand run, `fleetgraph_reviewer_chat_proofs` | Human gate plus before/after source-state proof for the mutation gate |

## Failure Meanings

- `in_progress`: event or run exists but the chain has not settled yet.
- `broken`: reviewer proof is missing a required gate; do not submit as passing proof.
- `failed`: graph execution errored.
- `complete`: live reviewer chain satisfies the current proof gates.

## Non-Claims

- No autonomous Ship mutation.
- No external contact or message send.
- No public unauthenticated reviewer control.
- No claim that static artifacts are fresher than the live chain they snapshot.
