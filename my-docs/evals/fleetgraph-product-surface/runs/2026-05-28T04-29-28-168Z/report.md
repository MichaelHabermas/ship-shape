# FleetGraph Product Surface Eval

Generated: 2026-05-28T04:29:28.168Z

## Summary

- Pass: 6
- Fail: 20

| Dimension | Average |
| --- | ---: |
| actionability | 4.00 |
| groundedness | 2.12 |
| specificity | 2.35 |
| brevity | 2.58 |
| repetitionBudget | 1.62 |
| informationDensity | 2.23 |
| cavemanCopy | 2.58 |
| duplicateFactControl | 3.92 |
| uncertaintyHonesty | 4.00 |
| missingDataUsefulness | 4.00 |
| uiProofSeparation | 4.00 |

## Cases

### fg-surface-clear-blocker

Blocked issue copy names the concrete blocker and next move once

Visible copy:

> Blocked · Audit issue 110 · Missing API credentials · Audit Load User 029 · Week 11 · Confirm credential owner.

Status: pass

| Dimension | Score |
| --- | ---: |
| actionability | 4 |
| groundedness | 4 |
| specificity | 4 |
| brevity | 4 |
| repetitionBudget | 4 |
| informationDensity | 4 |
| cavemanCopy | 4 |
| duplicateFactControl | 4 |
| uncertaintyHonesty | 4 |
| missingDataUsefulness | 4 |
| uiProofSeparation | 4 |

Notes:
- User can see the blocker and next move without reading architecture proof.
- Blocked appears as useful state, not repeated filler.

Human review:
- TBD

### fg-surface-missing-blocker-text

Missing blocker text is explained as a useful data gap

Visible copy:

> Blocked · Audit issue 110 · Blocker missing · Audit Load User 029 · Week 11 · Add reason.

Status: pass

| Dimension | Score |
| --- | ---: |
| actionability | 4 |
| groundedness | 3 |
| specificity | 4 |
| brevity | 4 |
| repetitionBudget | 4 |
| informationDensity | 4 |
| cavemanCopy | 4 |
| duplicateFactControl | 4 |
| uncertaintyHonesty | 4 |
| missingDataUsefulness | 4 |
| uiProofSeparation | 4 |

Notes:
- Missing evidence should become a concrete next step.
- The copy should not pretend the blocker is known.

Human review:
- TBD

### fg-surface-ui-proof-boundary

User copy stays free of reviewer-proof scaffolding

Visible copy:

> Blocked · Audit issue 110 · Owner missing · Waiting on review · - · Audit Project · Find approver.

Status: pass

| Dimension | Score |
| --- | ---: |
| actionability | 4 |
| groundedness | 3 |
| specificity | 3 |
| brevity | 4 |
| repetitionBudget | 4 |
| informationDensity | 4 |
| cavemanCopy | 4 |
| duplicateFactControl | 4 |
| uncertaintyHonesty | 4 |
| missingDataUsefulness | 4 |
| uiProofSeparation | 4 |

Notes:
- Reviewer evidence belongs in traces, logs, tests, and docs.
- User copy can show missing owner compactly without exposing graph/debug fields.

Human review:
- TBD

### fg-surface-runtime-proactive-clear-blocker

Runtime proactive clear-blocker output from runFleetGraph

Visible copy:

> Runtime issue clear blocker · Waiting on API credentials · Week 11 · Ask issue_assignee to confirm owner and next step for Week 11.

Status: pass

| Dimension | Score |
| --- | ---: |
| actionability | 4 |
| groundedness | 3 |
| specificity | 3 |
| brevity | 4 |
| repetitionBudget | 3 |
| informationDensity | 4 |
| cavemanCopy | 4 |
| duplicateFactControl | 3 |
| uncertaintyHonesty | 4 |
| missingDataUsefulness | 4 |
| uiProofSeparation | 4 |

Notes:
- Generated through runFleetGraph, not a hand-authored product-surface example.
- Failures here identify current runtime copy that needs product wording work.

Human review:
- TBD

### fg-surface-runtime-proactive-missing-blocker

Runtime proactive missing-blocker output from runFleetGraph

Visible copy:

> Runtime issue needs reason · Reason missing · Week 11 · Ask issue_assignee to add the blocker reason.

Status: pass

| Dimension | Score |
| --- | ---: |
| actionability | 4 |
| groundedness | 3 |
| specificity | 4 |
| brevity | 4 |
| repetitionBudget | 3 |
| informationDensity | 4 |
| cavemanCopy | 4 |
| duplicateFactControl | 4 |
| uncertaintyHonesty | 4 |
| missingDataUsefulness | 4 |
| uiProofSeparation | 4 |

Notes:
- Generated through runFleetGraph, not a hand-authored product-surface example.
- Failures here identify current runtime copy that needs product wording work.

Human review:
- TBD

### fg-surface-runtime-explain-existing-finding

Runtime explain output from runFleetGraph

Visible copy:

> Runtime existing finding · Waiting on review · Week 11 · Ask issue_assignee to confirm owner and next step for Week 11.

Status: pass

| Dimension | Score |
| --- | ---: |
| actionability | 4 |
| groundedness | 3 |
| specificity | 3 |
| brevity | 4 |
| repetitionBudget | 4 |
| informationDensity | 4 |
| cavemanCopy | 4 |
| duplicateFactControl | 3 |
| uncertaintyHonesty | 4 |
| missingDataUsefulness | 4 |
| uiProofSeparation | 4 |

Notes:
- Generated through runFleetGraph, not a hand-authored product-surface example.
- Failures here identify current runtime copy that needs product wording work.

Human review:
- TBD

### fg-surface-persisted-explain-455cf263

Persisted on_demand/explain output from 2026-05-28T02:42:31.067Z

Visible copy:

> Blocked issue: Add team workload view · Add team workload view is blocked. Latest blocker: Therefore? · Confirm the unblock path · FleetGraph sees a blocker signal, but a human must confirm the current unblock path.

Status: fail (groundedness, specificity, repetitionBudget)

| Dimension | Score |
| --- | ---: |
| actionability | 4 |
| groundedness | 2 |
| specificity | 2 |
| brevity | 4 |
| repetitionBudget | 1 |
| informationDensity | 3 |
| cavemanCopy | 4 |
| duplicateFactControl | 4 |
| uncertaintyHonesty | 4 |
| missingDataUsefulness | 4 |
| uiProofSeparation | 4 |

Notes:
- Loaded from fleetgraph_runs.output_snapshot.
- This is the report path that tracks real persisted FleetGraph outputs over time.

Human review:
- TBD

### fg-surface-persisted-explain-f84095c5

Persisted on_demand/explain output from 2026-05-28T02:33:26.569Z

Visible copy:

> Blocked issue: FG Demo - Medium priority blocked control · FG Demo - Medium priority blocked control is blocked. Latest blocker: Blocked but medium priority, so FleetGraph should stay quiet for MVP. · Confirm the unblock path · FleetGraph sees a blocker signal, but a human must confirm the current unblock path.

Status: fail (groundedness, specificity, brevity, repetitionBudget, informationDensity, cavemanCopy)

| Dimension | Score |
| --- | ---: |
| actionability | 4 |
| groundedness | 2 |
| specificity | 2 |
| brevity | 2 |
| repetitionBudget | 1 |
| informationDensity | 2 |
| cavemanCopy | 2 |
| duplicateFactControl | 4 |
| uncertaintyHonesty | 4 |
| missingDataUsefulness | 4 |
| uiProofSeparation | 4 |

Notes:
- Loaded from fleetgraph_runs.output_snapshot.
- This is the report path that tracks real persisted FleetGraph outputs over time.

Human review:
- TBD

### fg-surface-persisted-explain-51e368ad

Persisted on_demand/explain output from 2026-05-28T02:31:25.557Z

Visible copy:

> Blocked issue: FG Demo - Medium priority blocked control · FG Demo - Medium priority blocked control is blocked. Latest blocker: Blocked but medium priority, so FleetGraph should stay quiet for MVP. · Confirm the unblock path · FleetGraph sees a blocker signal, but a human must confirm the current unblock path.

Status: fail (groundedness, specificity, brevity, repetitionBudget, informationDensity, cavemanCopy)

| Dimension | Score |
| --- | ---: |
| actionability | 4 |
| groundedness | 2 |
| specificity | 2 |
| brevity | 2 |
| repetitionBudget | 1 |
| informationDensity | 2 |
| cavemanCopy | 2 |
| duplicateFactControl | 4 |
| uncertaintyHonesty | 4 |
| missingDataUsefulness | 4 |
| uiProofSeparation | 4 |

Notes:
- Loaded from fleetgraph_runs.output_snapshot.
- This is the report path that tracks real persisted FleetGraph outputs over time.

Human review:
- TBD

### fg-surface-persisted-explain-c61d73ff

Persisted on_demand/explain output from 2026-05-28T02:29:31.638Z

Visible copy:

> Blocked issue: FG Demo - Medium priority blocked control · FG Demo - Medium priority blocked control is blocked. Latest blocker: Blocked but medium priority, so FleetGraph should stay quiet for MVP. · Confirm the unblock path · FleetGraph sees a blocker signal, but a human must confirm the current unblock path.

Status: fail (groundedness, specificity, brevity, repetitionBudget, informationDensity, cavemanCopy)

| Dimension | Score |
| --- | ---: |
| actionability | 4 |
| groundedness | 2 |
| specificity | 2 |
| brevity | 2 |
| repetitionBudget | 1 |
| informationDensity | 2 |
| cavemanCopy | 2 |
| duplicateFactControl | 4 |
| uncertaintyHonesty | 4 |
| missingDataUsefulness | 4 |
| uiProofSeparation | 4 |

Notes:
- Loaded from fleetgraph_runs.output_snapshot.
- This is the report path that tracks real persisted FleetGraph outputs over time.

Human review:
- TBD

### fg-surface-persisted-explain-f59f9965

Persisted on_demand/explain output from 2026-05-28T02:20:57.532Z

Visible copy:

> Blocked issue: Audit Issue 110: Repair stale read · Audit Issue 110: Repair stale read is blocked. No blocker reason was recorded. · Confirm the unblock path · FleetGraph sees a blocker signal, but a human must confirm the current unblock path.

Status: fail (groundedness, specificity, repetitionBudget, informationDensity)

| Dimension | Score |
| --- | ---: |
| actionability | 4 |
| groundedness | 1 |
| specificity | 2 |
| brevity | 3 |
| repetitionBudget | 1 |
| informationDensity | 1 |
| cavemanCopy | 3 |
| duplicateFactControl | 4 |
| uncertaintyHonesty | 4 |
| missingDataUsefulness | 4 |
| uiProofSeparation | 4 |

Notes:
- Loaded from fleetgraph_runs.output_snapshot.
- This is the report path that tracks real persisted FleetGraph outputs over time.

Human review:
- TBD

### fg-surface-persisted-explain-4941622c

Persisted on_demand/explain output from 2026-05-28T02:20:30.590Z

Visible copy:

> Blocked issue: Audit Issue 110: Repair stale read · Audit Issue 110: Repair stale read is blocked. No blocker reason was recorded. · Confirm the unblock path · FleetGraph sees a blocker signal, but a human must confirm the current unblock path.

Status: fail (groundedness, specificity, repetitionBudget, informationDensity)

| Dimension | Score |
| --- | ---: |
| actionability | 4 |
| groundedness | 1 |
| specificity | 2 |
| brevity | 3 |
| repetitionBudget | 1 |
| informationDensity | 1 |
| cavemanCopy | 3 |
| duplicateFactControl | 4 |
| uncertaintyHonesty | 4 |
| missingDataUsefulness | 4 |
| uiProofSeparation | 4 |

Notes:
- Loaded from fleetgraph_runs.output_snapshot.
- This is the report path that tracks real persisted FleetGraph outputs over time.

Human review:
- TBD

### fg-surface-persisted-explain-e0cf35ec

Persisted on_demand/explain output from 2026-05-28T02:14:38.596Z

Visible copy:

> Blocked issue: Audit Issue 110: Repair stale read · Audit Issue 110: Repair stale read is blocked. No blocker reason was recorded. · Confirm the unblock path · FleetGraph sees a blocker signal, but a human must confirm the current unblock path.

Status: fail (groundedness, specificity, repetitionBudget, informationDensity)

| Dimension | Score |
| --- | ---: |
| actionability | 4 |
| groundedness | 1 |
| specificity | 2 |
| brevity | 3 |
| repetitionBudget | 1 |
| informationDensity | 1 |
| cavemanCopy | 3 |
| duplicateFactControl | 4 |
| uncertaintyHonesty | 4 |
| missingDataUsefulness | 4 |
| uiProofSeparation | 4 |

Notes:
- Loaded from fleetgraph_runs.output_snapshot.
- This is the report path that tracks real persisted FleetGraph outputs over time.

Human review:
- TBD

### fg-surface-persisted-explain-b944dadd

Persisted on_demand/explain output from 2026-05-28T02:01:53.288Z

Visible copy:

> Blocked issue: Audit Issue 110: Repair stale read · Audit Issue 110: Repair stale read is blocked. No blocker reason was recorded. · Confirm the unblock path · FleetGraph sees a blocker signal, but a human must confirm the current unblock path.

Status: fail (groundedness, specificity, repetitionBudget, informationDensity)

| Dimension | Score |
| --- | ---: |
| actionability | 4 |
| groundedness | 1 |
| specificity | 2 |
| brevity | 3 |
| repetitionBudget | 1 |
| informationDensity | 1 |
| cavemanCopy | 3 |
| duplicateFactControl | 4 |
| uncertaintyHonesty | 4 |
| missingDataUsefulness | 4 |
| uiProofSeparation | 4 |

Notes:
- Loaded from fleetgraph_runs.output_snapshot.
- This is the report path that tracks real persisted FleetGraph outputs over time.

Human review:
- TBD

### fg-surface-persisted-explain-568ad38d

Persisted on_demand/explain output from 2026-05-28T01:57:22.529Z

Visible copy:

> Blocked issue: Audit Issue 086: Repair stale read · Audit Issue 086: Repair stale read is blocked. Latest blocker: "War and Peace," blah, blah, blah. Anything goes.

What are we doing? It's Wednesday. I see a table. I see Jimmy John and Tyler.

Hey, Tyler. Here's Chris and a bunch of other things. OpenAI, detector, detector issues, documentation issues.

Let me see what else we can say. Something about the issues, projects, my name, my resume. · Confirm the unblock path · FleetGraph sees a blocker signal, but a human must confirm the current unblock path.

Status: fail (groundedness, specificity, brevity, repetitionBudget, informationDensity, cavemanCopy)

| Dimension | Score |
| --- | ---: |
| actionability | 4 |
| groundedness | 2 |
| specificity | 2 |
| brevity | 1 |
| repetitionBudget | 1 |
| informationDensity | 1 |
| cavemanCopy | 1 |
| duplicateFactControl | 4 |
| uncertaintyHonesty | 4 |
| missingDataUsefulness | 4 |
| uiProofSeparation | 4 |

Notes:
- Loaded from fleetgraph_runs.output_snapshot.
- This is the report path that tracks real persisted FleetGraph outputs over time.

Human review:
- TBD

### fg-surface-persisted-explain-53c08f8b

Persisted on_demand/explain output from 2026-05-28T01:57:14.637Z

Visible copy:

> Blocked issue: Audit Issue 086: Repair stale read · Audit Issue 086: Repair stale read is blocked. Latest blocker: "War and Peace," blah, blah, blah. Anything goes.

What are we doing? It's Wednesday. I see a table. I see Jimmy John and Tyler.

Hey, Tyler. Here's Chris and a bunch of other things. OpenAI, detector, detector issues, documentation issues.

Let me see what else we can say. Something about the issues, projects, my name, my resume. · Confirm the unblock path · FleetGraph sees a blocker signal, but a human must confirm the current unblock path.

Status: fail (groundedness, specificity, brevity, repetitionBudget, informationDensity, cavemanCopy)

| Dimension | Score |
| --- | ---: |
| actionability | 4 |
| groundedness | 2 |
| specificity | 2 |
| brevity | 1 |
| repetitionBudget | 1 |
| informationDensity | 1 |
| cavemanCopy | 1 |
| duplicateFactControl | 4 |
| uncertaintyHonesty | 4 |
| missingDataUsefulness | 4 |
| uiProofSeparation | 4 |

Notes:
- Loaded from fleetgraph_runs.output_snapshot.
- This is the report path that tracks real persisted FleetGraph outputs over time.

Human review:
- TBD

### fg-surface-persisted-explain-10438228

Persisted on_demand/explain output from 2026-05-28T01:43:19.237Z

Visible copy:

> Blocked issue: Audit Issue 086: Repair stale read · Audit Issue 086: Repair stale read is blocked. Latest blocker: "War and Peace," blah, blah, blah. Anything goes.

What are we doing? It's Wednesday. I see a table. I see Jimmy John and Tyler.

Hey, Tyler. Here's Chris and a bunch of other things. OpenAI, detector, detector issues, documentation issues.

Let me see what else we can say. Something about the issues, projects, my name, my resume. · Confirm the unblock path · FleetGraph sees a blocker signal, but a human must confirm the current unblock path.

Status: fail (groundedness, specificity, brevity, repetitionBudget, informationDensity, cavemanCopy)

| Dimension | Score |
| --- | ---: |
| actionability | 4 |
| groundedness | 2 |
| specificity | 2 |
| brevity | 1 |
| repetitionBudget | 1 |
| informationDensity | 1 |
| cavemanCopy | 1 |
| duplicateFactControl | 4 |
| uncertaintyHonesty | 4 |
| missingDataUsefulness | 4 |
| uiProofSeparation | 4 |

Notes:
- Loaded from fleetgraph_runs.output_snapshot.
- This is the report path that tracks real persisted FleetGraph outputs over time.

Human review:
- TBD

### fg-surface-persisted-explain-74e43209

Persisted on_demand/explain output from 2026-05-28T01:17:38.136Z

Visible copy:

> Blocked issue: FG Demo - Medium priority blocked control · FG Demo - Medium priority blocked control is blocked. Latest blocker: Blocked but medium priority, so FleetGraph should stay quiet for MVP. · Confirm the unblock path · FleetGraph sees a blocker signal, but a human must confirm the current unblock path.

Status: fail (groundedness, specificity, brevity, repetitionBudget, informationDensity, cavemanCopy)

| Dimension | Score |
| --- | ---: |
| actionability | 4 |
| groundedness | 2 |
| specificity | 2 |
| brevity | 2 |
| repetitionBudget | 1 |
| informationDensity | 2 |
| cavemanCopy | 2 |
| duplicateFactControl | 4 |
| uncertaintyHonesty | 4 |
| missingDataUsefulness | 4 |
| uiProofSeparation | 4 |

Notes:
- Loaded from fleetgraph_runs.output_snapshot.
- This is the report path that tracks real persisted FleetGraph outputs over time.

Human review:
- TBD

### fg-surface-persisted-explain-2c1f71e1

Persisted on_demand/explain output from 2026-05-28T01:16:06.308Z

Visible copy:

> Blocked issue: FG Demo - Medium priority blocked control · FG Demo - Medium priority blocked control is blocked. Latest blocker: Blocked but medium priority, so FleetGraph should stay quiet for MVP. · Confirm the unblock path · FleetGraph sees a blocker signal, but a human must confirm the current unblock path.

Status: fail (groundedness, specificity, brevity, repetitionBudget, informationDensity, cavemanCopy)

| Dimension | Score |
| --- | ---: |
| actionability | 4 |
| groundedness | 2 |
| specificity | 2 |
| brevity | 2 |
| repetitionBudget | 1 |
| informationDensity | 2 |
| cavemanCopy | 2 |
| duplicateFactControl | 4 |
| uncertaintyHonesty | 4 |
| missingDataUsefulness | 4 |
| uiProofSeparation | 4 |

Notes:
- Loaded from fleetgraph_runs.output_snapshot.
- This is the report path that tracks real persisted FleetGraph outputs over time.

Human review:
- TBD

### fg-surface-persisted-explain-eac8ea51

Persisted on_demand/explain output from 2026-05-28T01:15:07.316Z

Visible copy:

> Blocked issue: FG Demo - Medium priority blocked control · FG Demo - Medium priority blocked control is blocked. Latest blocker: Blocked but medium priority, so FleetGraph should stay quiet for MVP. · Confirm the unblock path · FleetGraph sees a blocker signal, but a human must confirm the current unblock path.

Status: fail (groundedness, specificity, brevity, repetitionBudget, informationDensity, cavemanCopy)

| Dimension | Score |
| --- | ---: |
| actionability | 4 |
| groundedness | 2 |
| specificity | 2 |
| brevity | 2 |
| repetitionBudget | 1 |
| informationDensity | 2 |
| cavemanCopy | 2 |
| duplicateFactControl | 4 |
| uncertaintyHonesty | 4 |
| missingDataUsefulness | 4 |
| uiProofSeparation | 4 |

Notes:
- Loaded from fleetgraph_runs.output_snapshot.
- This is the report path that tracks real persisted FleetGraph outputs over time.

Human review:
- TBD

### fg-surface-persisted-explain-3a81a0d7

Persisted on_demand/explain output from 2026-05-28T01:08:05.671Z

Visible copy:

> Blocked issue: FG Demo - Medium priority blocked control · FG Demo - Medium priority blocked control is blocked. Latest blocker: Blocked but medium priority, so FleetGraph should stay quiet for MVP. · Confirm the unblock path · FleetGraph sees a blocker signal, but a human must confirm the current unblock path.

Status: fail (groundedness, specificity, brevity, repetitionBudget, informationDensity, cavemanCopy)

| Dimension | Score |
| --- | ---: |
| actionability | 4 |
| groundedness | 2 |
| specificity | 2 |
| brevity | 2 |
| repetitionBudget | 1 |
| informationDensity | 2 |
| cavemanCopy | 2 |
| duplicateFactControl | 4 |
| uncertaintyHonesty | 4 |
| missingDataUsefulness | 4 |
| uiProofSeparation | 4 |

Notes:
- Loaded from fleetgraph_runs.output_snapshot.
- This is the report path that tracks real persisted FleetGraph outputs over time.

Human review:
- TBD

### fg-surface-persisted-explain-9f87df4b

Persisted on_demand/explain output from 2026-05-28T01:07:36.608Z

Visible copy:

> Blocked issue: FG Demo - Medium priority blocked control · FG Demo - Medium priority blocked control is blocked. Latest blocker: Blocked but medium priority, so FleetGraph should stay quiet for MVP. · Confirm the unblock path · FleetGraph sees a blocker signal, but a human must confirm the current unblock path.

Status: fail (groundedness, specificity, brevity, repetitionBudget, informationDensity, cavemanCopy)

| Dimension | Score |
| --- | ---: |
| actionability | 4 |
| groundedness | 2 |
| specificity | 2 |
| brevity | 2 |
| repetitionBudget | 1 |
| informationDensity | 2 |
| cavemanCopy | 2 |
| duplicateFactControl | 4 |
| uncertaintyHonesty | 4 |
| missingDataUsefulness | 4 |
| uiProofSeparation | 4 |

Notes:
- Loaded from fleetgraph_runs.output_snapshot.
- This is the report path that tracks real persisted FleetGraph outputs over time.

Human review:
- TBD

### fg-surface-persisted-explain-ed5e5478

Persisted on_demand/explain output from 2026-05-28T01:07:29.646Z

Visible copy:

> Blocked issue: FG Demo - Medium priority blocked control · FG Demo - Medium priority blocked control is blocked. Latest blocker: Blocked but medium priority, so FleetGraph should stay quiet for MVP. · Confirm the unblock path · FleetGraph sees a blocker signal, but a human must confirm the current unblock path.

Status: fail (groundedness, specificity, brevity, repetitionBudget, informationDensity, cavemanCopy)

| Dimension | Score |
| --- | ---: |
| actionability | 4 |
| groundedness | 2 |
| specificity | 2 |
| brevity | 2 |
| repetitionBudget | 1 |
| informationDensity | 2 |
| cavemanCopy | 2 |
| duplicateFactControl | 4 |
| uncertaintyHonesty | 4 |
| missingDataUsefulness | 4 |
| uiProofSeparation | 4 |

Notes:
- Loaded from fleetgraph_runs.output_snapshot.
- This is the report path that tracks real persisted FleetGraph outputs over time.

Human review:
- TBD

### fg-surface-persisted-explain-d99b49c1

Persisted on_demand/explain output from 2026-05-28T01:07:18.683Z

Visible copy:

> Blocked issue: FG Demo - Medium priority blocked control · FG Demo - Medium priority blocked control is blocked. Latest blocker: Blocked but medium priority, so FleetGraph should stay quiet for MVP. · Confirm the unblock path · FleetGraph sees a blocker signal, but a human must confirm the current unblock path.

Status: fail (groundedness, specificity, brevity, repetitionBudget, informationDensity, cavemanCopy)

| Dimension | Score |
| --- | ---: |
| actionability | 4 |
| groundedness | 2 |
| specificity | 2 |
| brevity | 2 |
| repetitionBudget | 1 |
| informationDensity | 2 |
| cavemanCopy | 2 |
| duplicateFactControl | 4 |
| uncertaintyHonesty | 4 |
| missingDataUsefulness | 4 |
| uiProofSeparation | 4 |

Notes:
- Loaded from fleetgraph_runs.output_snapshot.
- This is the report path that tracks real persisted FleetGraph outputs over time.

Human review:
- TBD

### fg-surface-persisted-explain-5cfd9cfb

Persisted on_demand/explain output from 2026-05-28T00:55:23.880Z

Visible copy:

> Blocked issue: FG Demo - Medium priority blocked control · FG Demo - Medium priority blocked control is blocked. Latest blocker: Blocked but medium priority, so FleetGraph should stay quiet for MVP. · Confirm the unblock path · FleetGraph sees a blocker signal, but a human must confirm the current unblock path.

Status: fail (groundedness, specificity, brevity, repetitionBudget, informationDensity, cavemanCopy)

| Dimension | Score |
| --- | ---: |
| actionability | 4 |
| groundedness | 2 |
| specificity | 2 |
| brevity | 2 |
| repetitionBudget | 1 |
| informationDensity | 2 |
| cavemanCopy | 2 |
| duplicateFactControl | 4 |
| uncertaintyHonesty | 4 |
| missingDataUsefulness | 4 |
| uiProofSeparation | 4 |

Notes:
- Loaded from fleetgraph_runs.output_snapshot.
- This is the report path that tracks real persisted FleetGraph outputs over time.

Human review:
- TBD

### fg-surface-persisted-create_finding-c12e88c2

Persisted proactive/create_finding output from 2026-05-28T00:39:28.059Z

Visible copy:

> Blocked issue: FG Demo - Medium priority blocked control · FG Demo - Medium priority blocked control is blocked. Latest blocker: Blocked but medium priority, so FleetGraph should stay quiet for MVP. · Confirm the unblock path · FleetGraph sees a blocker signal, but a human must confirm the current unblock path.

Status: fail (groundedness, specificity, brevity, repetitionBudget, informationDensity, cavemanCopy)

| Dimension | Score |
| --- | ---: |
| actionability | 4 |
| groundedness | 2 |
| specificity | 2 |
| brevity | 2 |
| repetitionBudget | 1 |
| informationDensity | 2 |
| cavemanCopy | 2 |
| duplicateFactControl | 4 |
| uncertaintyHonesty | 4 |
| missingDataUsefulness | 4 |
| uiProofSeparation | 4 |

Notes:
- Loaded from fleetgraph_runs.output_snapshot.
- This is the report path that tracks real persisted FleetGraph outputs over time.

Human review:
- TBD
