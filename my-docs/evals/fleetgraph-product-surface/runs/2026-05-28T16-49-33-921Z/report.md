# FleetGraph Product Surface Eval

Generated: 2026-05-28T16:49:33.921Z

## Current Surface Summary

- Pass: 6
- Fail: 0
- Historical persisted failures: 20 (trend only)

| Dimension | Average |
| --- | ---: |
| actionability | 4.00 |
| groundedness | 3.17 |
| specificity | 3.50 |
| brevity | 4.00 |
| repetitionBudget | 4.00 |
| informationDensity | 4.00 |
| cavemanCopy | 4.00 |
| duplicateFactControl | 3.67 |
| uncertaintyHonesty | 4.00 |
| missingDataUsefulness | 4.00 |
| uiProofSeparation | 4.00 |


## Current Surface

Fresh authored and runFleetGraph cases. This is the present-tense pass/fail signal.

- Pass: 6
- Fail: 0

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

> Blocked: Runtime issue clear blocker · Waiting on API credentials · Week 11 · Ask Audit Load User 029 to confirm owner and next step for Week 11.

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

### fg-surface-runtime-proactive-missing-blocker

Runtime proactive missing-blocker output from runFleetGraph

Visible copy:

> Blocked: Runtime issue needs reason · Reason missing · Week 11 · Ask Audit Load User 029 to add the blocker reason.

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
- Generated through runFleetGraph, not a hand-authored product-surface example.
- Failures here identify current runtime copy that needs product wording work.

Human review:
- TBD

### fg-surface-runtime-explain-existing-finding

Runtime explain output from runFleetGraph

Visible copy:

> Runtime existing finding · Waiting on review · Week 11 · Ask Audit Load User 029 to confirm owner and next step for Week 11.

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

## Historical Persisted Samples

Older fleetgraph_runs.output_snapshot rows for trend review only. These do not affect the current headline.

- Pass: 0
- Fail: 20

### fg-surface-persisted-explain-7746e40f

Persisted on_demand/explain output from 2026-05-28T15:41:40.058Z

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

### fg-surface-persisted-explain-6cc16019

Persisted on_demand/explain output from 2026-05-28T15:40:40.339Z

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

### fg-surface-persisted-explain-63d7f970

Persisted on_demand/explain output from 2026-05-28T15:39:50.596Z

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

### fg-surface-persisted-explain-4aae8010

Persisted on_demand/explain output from 2026-05-28T15:39:46.361Z

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

### fg-surface-persisted-explain-584c1521

Persisted on_demand/explain output from 2026-05-28T15:36:19.489Z

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

### fg-surface-persisted-explain-8b329cb6

Persisted on_demand/explain output from 2026-05-28T15:34:26.869Z

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

### fg-surface-persisted-explain-d9f41ffd

Persisted on_demand/explain output from 2026-05-28T15:32:36.057Z

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

### fg-surface-persisted-explain-d0c6a81a

Persisted on_demand/explain output from 2026-05-28T15:32:05.273Z

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
