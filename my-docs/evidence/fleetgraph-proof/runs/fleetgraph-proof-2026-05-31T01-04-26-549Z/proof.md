# FleetGraph Reviewer Proof

Generated: 2026-05-31T01:04:26.549Z
Run: fleetgraph-proof-2026-05-31T01-04-26-549Z
Target: local
Verdict: pass
Git: master @ 4e893615528991939ddf7fc3a052b1c5f7ef6247

## Verdict

Required scenarios: 9/9
Current product surface: 8 pass / 0 fail
Deployed signals: -

## Attention Loop

| Step | Status | Evidence |
| --- | --- | --- |
| Ship signal | pass | api/src/fleetgraph/eval/golden-cases.ts |
| Detector policy | pass | api/src/fleetgraph/eval/executable-golden-cases.test.ts |
| Finding lifecycle | pass | my-docs/evals/fleetgraph-product-surface/latest.json |
| Notification state | skipped | e2e/fleetgraph-attention-loop.spec.ts |
| Source and chat | skipped | my-docs/evidence/fleetgraph-proof/latest.html |
| Human gate | skipped | my-docs/evidence/fleetgraph-proof/latest.md |

## Reviewer Test Cases

| # | Ship state | Expected output | Public LangSmith trace |
| ---: | --- | --- | --- |
| 1 | Visible issue has state = blocked and blocker text | Proactive create_finding, notification visible, no Ship mutation claim | missing public LangSmith trace |
| 2 | Visible active issue has no meaningful update for 30+ days | Proactive create_finding, stale notification, human-gated review/close action | missing public LangSmith trace |
| 3 | Visible high/urgent current-week issue is unowned or near sprint end | Proactive create_finding, at-risk notification, human-gated owner/scope action | missing public LangSmith trace |
| 4 | User asks from existing finding or page context | On-demand explain/chat path returns visible evidence, page context, and next action | missing public LangSmith trace |
| 5 | Chat asks for next action on a source/finding | Human gate required; source issue remains unchanged after chat | missing public LangSmith trace |
| 6 | Source condition disappears or evidence becomes unsafe | Finding resolves/suppresses or quiet-exits without model cost | missing public LangSmith trace |
| 7 | Reviewer runs current-week blocker scenario in /fleetgraph/reviewer | Live chain shows source -> attention event -> worker tick -> graph run -> trace -> finding -> notification projection -> chat/human gate under 5 minutes | missing public LangSmith trace |

## Graph Path Matrix

| Scenario | Proactive | On-demand | Update | Quiet | Human gate |
| --- | --- | --- | --- | --- | --- |
| Proactive blocked finding creates notification | executed | not applicable | not applicable | not applicable | executed |
| Duplicate source updates existing finding | executed | not applicable | executed | not applicable | not applicable |
| Proactive stale finding creates notification | executed | not applicable | not applicable | not applicable | executed |
| Proactive at-risk finding creates notification | executed | not applicable | not applicable | not applicable | executed |
| Done or cancelled work exits quietly | executed | not applicable | not applicable | executed | not applicable |
| Restricted evidence does not leak | executed | not applicable | not applicable | executed | not applicable |
| On-demand source explanation stays grounded | not applicable | executed | not applicable | not applicable | not applicable |
| Next-action chat preserves human gate | not applicable | executed | not applicable | not applicable | executed |
| Finding resolves when source condition disappears | executed | not applicable | not applicable | not applicable | not applicable |

## Current Findings

| Signal | Source | Visible copy | Next action | Status |
| --- | --- | --- | --- | --- |
| Blocked | Audit issue 110 | Blocked · Audit issue 110 · Missing API credentials · Audit Load User 029 | Confirm credential owner. | pass |
| Blocked | Audit issue 110 | Blocked · Audit issue 110 · Blocker missing · Audit Load User 029 | Add reason. | pass |
| Blocked | Audit issue 110 | Blocked · Audit issue 110 · Owner missing · Waiting on review | Find approver. | pass |
| Stale | Integration cleanup | Stale · Integration cleanup · No meaningful update for 30+ days · Riley Builder | Review or close. | pass |
| At risk | Rollout checklist | At risk · Rollout checklist · Owner missing · High-priority current-week work | Confirm owner. | pass |
| Blocked: Runtime issue clear blocker | Waiting on API credentials · Week 11 | Blocked: Runtime issue clear blocker · Waiting on API credentials · Week 11 · Ask Audit Load User 029 to confirm owner and next step for Week 11. | Ask Audit Load User 029 to confirm owner and next step for Week 11. | pass |

## Deployed Runtime Evidence

No deployed database evidence was configured.

## Cost And Usage

Graph invocations: 0
Model calls: 0
Tokens: 0 input / 0 output / 0 total
Deterministic runs: 0; real-model runs: 0
Estimated FleetGraph model cost: not measured; no deployed run metadata was available
Projection, 100 users: requires deployed telemetry
Projection, 1,000 users: requires deployed telemetry
Projection, 10,000 users: requires deployed telemetry
Excluded: Out-of-band coding assistant and development-wide Claude/API spend were not instrumented and are excluded.

## Deployed Runtime Trace Evidence

No trace evidence was configured.

## Safety

- pass: Permission-filtered evidence (fg-restricted-source-hidden)
- pass: No autonomous Ship mutation/contact (FleetGraph golden-case mutation boundaries)
- pass: Human gate before next action (fg-human-gated-action-prep)
- pass: Authenticated live proof surface (/fleetgraph/reviewer plus fleetgraph-product-surface latest.json)

## Risks

- None recorded.

## Non-Claims

- The reviewer control room is an authenticated proof surface, not a marketing page or public reviewer bypass.
- This proof packet does not claim autonomous Ship mutation or external contact.
- A blocked deployed target means required deployed evidence was missing, not that production passed.

## Artifacts

- Static dashboard: my-docs/evidence/fleetgraph-proof/latest.html
- Proof JSON: my-docs/evidence/fleetgraph-proof/latest.json
- Proof Markdown: my-docs/evidence/fleetgraph-proof/latest.md
- Timestamped run: my-docs/evidence/fleetgraph-proof/runs/fleetgraph-proof-2026-05-31T01-04-26-549Z/proof.html
- Golden cases: api/src/fleetgraph/eval/golden-cases.ts
- Executable golden-case tests: api/src/fleetgraph/eval/executable-golden-cases.test.ts
- Product-surface eval: my-docs/evals/fleetgraph-product-surface/latest.html
- Focused E2E spec: e2e/fleetgraph-attention-loop.spec.ts
