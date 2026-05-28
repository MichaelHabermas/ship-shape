# FleetGraph Product Surface Eval

Generated: 2026-05-28T20:40:55.599Z

## Current Surface Summary

- Pass: 6
- Fail: 0
- Historical persisted failures: 19 (trend only)

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

- Pass: 1
- Fail: 19

### fg-surface-persisted-explain-06857f62

Persisted on_demand/explain output from 2026-05-28T19:40:23.201Z

Visible copy:

> At risk: FG Demo - At-risk unowned launch task · FG Demo - At-risk unowned launch task is at risk. High-priority current-week work has no owner. · Ask Morgan Project Owner to confirm scope, owner, and whether this can still land this week.

Status: fail (groundedness, repetitionBudget, informationDensity, uncertaintyHonesty, missingDataUsefulness)

| Dimension | Score |
| --- | ---: |
| actionability | 4 |
| groundedness | 2 |
| specificity | 3 |
| brevity | 3 |
| repetitionBudget | 1 |
| informationDensity | 2 |
| cavemanCopy | 3 |
| duplicateFactControl | 4 |
| uncertaintyHonesty | 2 |
| missingDataUsefulness | 2 |
| uiProofSeparation | 4 |

Notes:
- Loaded from fleetgraph_runs.output_snapshot.
- This is the report path that tracks real persisted FleetGraph outputs over time.

Human review:
- TBD

### fg-surface-persisted-create_finding-08c8327a

Persisted proactive/create_finding output from 2026-05-28T19:28:07.668Z

Visible copy:

> Blocked: FG Demo - Medium priority blocked control · Blocked even though medium priority; blocked state alone should surface it · Week 7 · Ask Riley Builder to confirm owner and next step for Week 7.

Status: fail (repetitionBudget)

| Dimension | Score |
| --- | ---: |
| actionability | 4 |
| groundedness | 3 |
| specificity | 3 |
| brevity | 4 |
| repetitionBudget | 2 |
| informationDensity | 4 |
| cavemanCopy | 4 |
| duplicateFactControl | 3 |
| uncertaintyHonesty | 4 |
| missingDataUsefulness | 4 |
| uiProofSeparation | 4 |

Notes:
- Loaded from fleetgraph_runs.output_snapshot.
- This is the report path that tracks real persisted FleetGraph outputs over time.

Human review:
- TBD

### fg-surface-persisted-create_finding-42c7c6ff

Persisted proactive/create_finding output from 2026-05-28T19:28:03.157Z

Visible copy:

> Stale: FG Demo - Stale integration cleanup · FG Demo - Stale integration cleanup looks stale. No meaningful update for 180+ days. · Ask Riley Builder to post a fresh status or close the work if it is no longer active.

Status: fail (groundedness, repetitionBudget, informationDensity, uncertaintyHonesty, missingDataUsefulness)

| Dimension | Score |
| --- | ---: |
| actionability | 4 |
| groundedness | 2 |
| specificity | 3 |
| brevity | 3 |
| repetitionBudget | 2 |
| informationDensity | 2 |
| cavemanCopy | 3 |
| duplicateFactControl | 4 |
| uncertaintyHonesty | 2 |
| missingDataUsefulness | 2 |
| uiProofSeparation | 4 |

Notes:
- Loaded from fleetgraph_runs.output_snapshot.
- This is the report path that tracks real persisted FleetGraph outputs over time.

Human review:
- TBD

### fg-surface-persisted-create_finding-2f74eacd

Persisted proactive/create_finding output from 2026-05-28T19:27:58.879Z

Visible copy:

> Blocked: FG Demo - Data export contract blocked · Blocked on Morgan Project Owner deciding whether the export includes archived issues · Week 7 · Ask Riley Builder to confirm owner and next step for Week 7.

Status: fail (repetitionBudget)

| Dimension | Score |
| --- | ---: |
| actionability | 4 |
| groundedness | 3 |
| specificity | 3 |
| brevity | 3 |
| repetitionBudget | 2 |
| informationDensity | 3 |
| cavemanCopy | 3 |
| duplicateFactControl | 3 |
| uncertaintyHonesty | 4 |
| missingDataUsefulness | 4 |
| uiProofSeparation | 4 |

Notes:
- Loaded from fleetgraph_runs.output_snapshot.
- This is the report path that tracks real persisted FleetGraph outputs over time.

Human review:
- TBD

### fg-surface-persisted-update_finding-a903dccb

Persisted proactive/update_finding output from 2026-05-28T19:27:54.329Z

Visible copy:

> Blocked: FG Demo - Duplicate open finding control · FG Demo - Duplicate open finding control still needs an unblock decision. · Ask Riley Builder to confirm owner and next step for Week 7.

Status: fail (repetitionBudget)

| Dimension | Score |
| --- | ---: |
| actionability | 4 |
| groundedness | 3 |
| specificity | 3 |
| brevity | 4 |
| repetitionBudget | 1 |
| informationDensity | 4 |
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

### fg-surface-persisted-create_finding-70cb0257

Persisted proactive/create_finding output from 2026-05-28T19:27:49.746Z

Visible copy:

> At risk: FG Demo - At-risk unowned launch task · FG Demo - At-risk unowned launch task is at risk. High-priority current-week work has no owner. · Ask Morgan Project Owner to confirm scope, owner, and whether this can still land this week.

Status: fail (groundedness, repetitionBudget, informationDensity, uncertaintyHonesty, missingDataUsefulness)

| Dimension | Score |
| --- | ---: |
| actionability | 4 |
| groundedness | 2 |
| specificity | 3 |
| brevity | 3 |
| repetitionBudget | 1 |
| informationDensity | 2 |
| cavemanCopy | 3 |
| duplicateFactControl | 4 |
| uncertaintyHonesty | 2 |
| missingDataUsefulness | 2 |
| uiProofSeparation | 4 |

Notes:
- Loaded from fleetgraph_runs.output_snapshot.
- This is the report path that tracks real persisted FleetGraph outputs over time.

Human review:
- TBD

### fg-surface-persisted-update_finding-55906321

Persisted proactive/update_finding output from 2026-05-28T19:27:45.264Z

Visible copy:

> Blocked: Audit Issue 086: Repair stale read · Audit Issue 086: Repair stale read still needs an unblock decision. · Ask Frank Garcia to confirm owner and next step for Week 14.

Status: fail (repetitionBudget)

| Dimension | Score |
| --- | ---: |
| actionability | 4 |
| groundedness | 3 |
| specificity | 3 |
| brevity | 4 |
| repetitionBudget | 1 |
| informationDensity | 4 |
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

### fg-surface-persisted-update_finding-fbc583bc

Persisted proactive/update_finding output from 2026-05-28T19:27:39.853Z

Visible copy:

> Blocked: Add team workload view · Add team workload view still needs an unblock decision. · Ask Emma Johnson to confirm owner and next step for Week 15.

Status: fail (repetitionBudget)

| Dimension | Score |
| --- | ---: |
| actionability | 4 |
| groundedness | 3 |
| specificity | 3 |
| brevity | 4 |
| repetitionBudget | 2 |
| informationDensity | 4 |
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

### fg-surface-persisted-update_finding-11178633

Persisted proactive/update_finding output from 2026-05-28T19:27:36.857Z

Visible copy:

> Blocked: Audit Issue 110: Repair stale read · Audit Issue 110: Repair stale read still needs an unblock decision. · Ask Emma Johnson to add the blocker reason.

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

### fg-surface-persisted-create_finding-e66879a6

Persisted proactive/create_finding output from 2026-05-28T19:27:31.421Z

Visible copy:

> Blocked: FG Demo - SSO cert rotation blocked · Blocked on Casey Dependency Owner approving the SSO cert rotation window · Week 7 · Ask Riley Builder to confirm owner and next step for Week 7.

Status: fail (repetitionBudget)

| Dimension | Score |
| --- | ---: |
| actionability | 4 |
| groundedness | 3 |
| specificity | 3 |
| brevity | 4 |
| repetitionBudget | 1 |
| informationDensity | 4 |
| cavemanCopy | 4 |
| duplicateFactControl | 3 |
| uncertaintyHonesty | 4 |
| missingDataUsefulness | 4 |
| uiProofSeparation | 4 |

Notes:
- Loaded from fleetgraph_runs.output_snapshot.
- This is the report path that tracks real persisted FleetGraph outputs over time.

Human review:
- TBD

### fg-surface-persisted-create_finding-7ea69a76

Persisted proactive/create_finding output from 2026-05-28T19:27:22.519Z

Visible copy:

> Blocked: FG Demo - Blocked without blocker explanation · Reason missing · Week 7 · Ask Morgan Project Owner to add the blocker reason.

Status: fail (repetitionBudget)

| Dimension | Score |
| --- | ---: |
| actionability | 4 |
| groundedness | 3 |
| specificity | 4 |
| brevity | 4 |
| repetitionBudget | 2 |
| informationDensity | 4 |
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

### fg-surface-persisted-create_finding-fc7544c8

Persisted proactive/create_finding output from 2026-05-28T19:27:17.704Z

Visible copy:

> Blocked: FG Demo - Inactive week blocked control · Blocked in a prior week, outside the active-week detector scope · Week 6 · Ask Riley Builder to confirm owner and next step for Week 6.

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
- Loaded from fleetgraph_runs.output_snapshot.
- This is the report path that tracks real persisted FleetGraph outputs over time.

Human review:
- TBD

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
