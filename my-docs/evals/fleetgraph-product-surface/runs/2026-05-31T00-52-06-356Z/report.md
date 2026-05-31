# FleetGraph Product Surface Eval

Generated: 2026-05-31T00:52:06.356Z

## Current Surface Summary

- Pass: 8
- Fail: 0
- Historical persisted failures: 20 (trend only)

| Dimension | Average |
| --- | ---: |
| actionability | 4.00 |
| groundedness | 3.25 |
| specificity | 3.50 |
| brevity | 4.00 |
| repetitionBudget | 3.88 |
| informationDensity | 4.00 |
| cavemanCopy | 4.00 |
| duplicateFactControl | 3.75 |
| uncertaintyHonesty | 4.00 |
| missingDataUsefulness | 4.00 |
| uiProofSeparation | 4.00 |


## Current Surface

Fresh authored and runFleetGraph cases. This is the present-tense pass/fail signal.

- Pass: 8
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

### fg-surface-stale-active-work

Stale work copy names inactivity and the review move

Visible copy:

> Stale · Integration cleanup · No meaningful update for 30+ days · Riley Builder · Week 11 · Review or close.

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
- Stale copy should explain the time-based evidence.
- The next step stays human-owned instead of pretending FleetGraph closed work.

Human review:
- TBD

### fg-surface-at-risk-current-week

At-risk work copy names current-week risk and owner decision

Visible copy:

> At risk · Rollout checklist · Owner missing · High-priority current-week work · Week 11 · Confirm owner.

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
| duplicateFactControl | 4 |
| uncertaintyHonesty | 4 |
| missingDataUsefulness | 4 |
| uiProofSeparation | 4 |

Notes:
- At-risk copy should identify the planning risk, not only urgency.
- Missing owner becomes a decision prompt for the PM.

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

### fg-surface-persisted-update_finding-ed0b104e

Persisted proactive/update_finding output from 2026-05-31T00:50:47.838Z

Visible copy:

> At risk: FG-STALE-04 API pagination cleanup stopped after route inventory · FG-STALE-04 API pagination cleanup stopped after route inventory is at risk. High-priority current-week work is within 3 days of sprint end. · Ask Riley Builder to confirm scope, owner, and whether this can still land this week.

Status: fail (groundedness, specificity, repetitionBudget, informationDensity, uncertaintyHonesty, missingDataUsefulness)

| Dimension | Score |
| --- | ---: |
| actionability | 4 |
| groundedness | 2 |
| specificity | 2 |
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

### fg-surface-persisted-update_finding-0d7b7356

Persisted proactive/update_finding output from 2026-05-31T00:50:42.825Z

Visible copy:

> Blocked: FG-MULTI-03 Compliance export masking is blocked near demo · FG-MULTI-03 Compliance export masking is blocked near demo still needs an unblock decision. · Ask Riley Builder to confirm owner and next step for Week 7.

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

### fg-surface-persisted-update_finding-c2056096

Persisted proactive/update_finding output from 2026-05-31T00:50:37.811Z

Visible copy:

> Blocked: FG-MULTI-04 Workspace invite recovery is blocked before pilot · FG-MULTI-04 Workspace invite recovery is blocked before pilot still needs an unblock decision. · Ask Riley Builder to confirm owner and next step for Week 7.

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

### fg-surface-persisted-update_finding-6e996e4e

Persisted proactive/update_finding output from 2026-05-31T00:50:32.727Z

Visible copy:

> Blocked: FG Demo - Blocked without blocker explanation · FG Demo - Blocked without blocker explanation still needs an unblock decision. · Ask Morgan Project Owner to add the blocker reason.

Status: fail (groundedness, specificity, repetitionBudget, cavemanCopy)

| Dimension | Score |
| --- | ---: |
| actionability | 4 |
| groundedness | 2 |
| specificity | 2 |
| brevity | 4 |
| repetitionBudget | 1 |
| informationDensity | 3 |
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

### fg-surface-persisted-update_finding-88fda444

Persisted proactive/update_finding output from 2026-05-31T00:50:27.713Z

Visible copy:

> Blocked: FG Demo - Inactive week blocked control · FG Demo - Inactive week blocked control still needs an unblock decision. · Ask Riley Builder to confirm owner and next step for Week 6.

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

### fg-surface-persisted-update_finding-e17e9c8b

Persisted proactive/update_finding output from 2026-05-31T00:48:22.668Z

Visible copy:

> At risk: FG-STALE-04 API pagination cleanup stopped after route inventory · FG-STALE-04 API pagination cleanup stopped after route inventory is at risk. High-priority current-week work is within 3 days of sprint end. · Ask Riley Builder to confirm scope, owner, and whether this can still land this week.

Status: fail (groundedness, specificity, repetitionBudget, informationDensity, uncertaintyHonesty, missingDataUsefulness)

| Dimension | Score |
| --- | ---: |
| actionability | 4 |
| groundedness | 2 |
| specificity | 2 |
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

### fg-surface-persisted-update_finding-cad925b8

Persisted proactive/update_finding output from 2026-05-31T00:48:17.658Z

Visible copy:

> Blocked: FG-MULTI-03 Compliance export masking is blocked near demo · FG-MULTI-03 Compliance export masking is blocked near demo still needs an unblock decision. · Ask Riley Builder to confirm owner and next step for Week 7.

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

### fg-surface-persisted-update_finding-f536b0e0

Persisted proactive/update_finding output from 2026-05-31T00:48:12.646Z

Visible copy:

> Blocked: FG-MULTI-04 Workspace invite recovery is blocked before pilot · FG-MULTI-04 Workspace invite recovery is blocked before pilot still needs an unblock decision. · Ask Riley Builder to confirm owner and next step for Week 7.

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

### fg-surface-persisted-update_finding-d0cd979f

Persisted proactive/update_finding output from 2026-05-31T00:48:07.554Z

Visible copy:

> Blocked: FG Demo - Blocked without blocker explanation · FG Demo - Blocked without blocker explanation still needs an unblock decision. · Ask Morgan Project Owner to add the blocker reason.

Status: fail (groundedness, specificity, repetitionBudget, cavemanCopy)

| Dimension | Score |
| --- | ---: |
| actionability | 4 |
| groundedness | 2 |
| specificity | 2 |
| brevity | 4 |
| repetitionBudget | 1 |
| informationDensity | 3 |
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

### fg-surface-persisted-update_finding-12330f94

Persisted proactive/update_finding output from 2026-05-31T00:48:02.538Z

Visible copy:

> Blocked: FG Demo - Inactive week blocked control · FG Demo - Inactive week blocked control still needs an unblock decision. · Ask Riley Builder to confirm owner and next step for Week 6.

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

### fg-surface-persisted-update_finding-ae630a63

Persisted proactive/update_finding output from 2026-05-31T00:45:57.492Z

Visible copy:

> At risk: FG-STALE-04 API pagination cleanup stopped after route inventory · FG-STALE-04 API pagination cleanup stopped after route inventory is at risk. High-priority current-week work is within 3 days of sprint end. · Ask Riley Builder to confirm scope, owner, and whether this can still land this week.

Status: fail (groundedness, specificity, repetitionBudget, informationDensity, uncertaintyHonesty, missingDataUsefulness)

| Dimension | Score |
| --- | ---: |
| actionability | 4 |
| groundedness | 2 |
| specificity | 2 |
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

### fg-surface-persisted-update_finding-87fd46f2

Persisted proactive/update_finding output from 2026-05-31T00:45:52.480Z

Visible copy:

> Blocked: FG-MULTI-03 Compliance export masking is blocked near demo · FG-MULTI-03 Compliance export masking is blocked near demo still needs an unblock decision. · Ask Riley Builder to confirm owner and next step for Week 7.

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

### fg-surface-persisted-update_finding-ee5165a9

Persisted proactive/update_finding output from 2026-05-31T00:45:47.461Z

Visible copy:

> Blocked: FG-MULTI-04 Workspace invite recovery is blocked before pilot · FG-MULTI-04 Workspace invite recovery is blocked before pilot still needs an unblock decision. · Ask Riley Builder to confirm owner and next step for Week 7.

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

### fg-surface-persisted-update_finding-9c8c8dbc

Persisted proactive/update_finding output from 2026-05-31T00:45:42.377Z

Visible copy:

> Blocked: FG Demo - Blocked without blocker explanation · FG Demo - Blocked without blocker explanation still needs an unblock decision. · Ask Morgan Project Owner to add the blocker reason.

Status: fail (groundedness, specificity, repetitionBudget, cavemanCopy)

| Dimension | Score |
| --- | ---: |
| actionability | 4 |
| groundedness | 2 |
| specificity | 2 |
| brevity | 4 |
| repetitionBudget | 1 |
| informationDensity | 3 |
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

### fg-surface-persisted-update_finding-5fb672bc

Persisted proactive/update_finding output from 2026-05-31T00:45:37.360Z

Visible copy:

> Blocked: FG Demo - Inactive week blocked control · FG Demo - Inactive week blocked control still needs an unblock decision. · Ask Riley Builder to confirm owner and next step for Week 6.

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

### fg-surface-persisted-update_finding-7659497e

Persisted proactive/update_finding output from 2026-05-31T00:43:32.318Z

Visible copy:

> At risk: FG-STALE-04 API pagination cleanup stopped after route inventory · FG-STALE-04 API pagination cleanup stopped after route inventory is at risk. High-priority current-week work is within 3 days of sprint end. · Ask Riley Builder to confirm scope, owner, and whether this can still land this week.

Status: fail (groundedness, specificity, repetitionBudget, informationDensity, uncertaintyHonesty, missingDataUsefulness)

| Dimension | Score |
| --- | ---: |
| actionability | 4 |
| groundedness | 2 |
| specificity | 2 |
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

### fg-surface-persisted-update_finding-27cd9484

Persisted proactive/update_finding output from 2026-05-31T00:43:27.307Z

Visible copy:

> Blocked: FG-MULTI-03 Compliance export masking is blocked near demo · FG-MULTI-03 Compliance export masking is blocked near demo still needs an unblock decision. · Ask Riley Builder to confirm owner and next step for Week 7.

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

### fg-surface-persisted-update_finding-6587427e

Persisted proactive/update_finding output from 2026-05-31T00:43:22.293Z

Visible copy:

> Blocked: FG-MULTI-04 Workspace invite recovery is blocked before pilot · FG-MULTI-04 Workspace invite recovery is blocked before pilot still needs an unblock decision. · Ask Riley Builder to confirm owner and next step for Week 7.

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

### fg-surface-persisted-update_finding-5468528f

Persisted proactive/update_finding output from 2026-05-31T00:43:17.213Z

Visible copy:

> Blocked: FG Demo - Blocked without blocker explanation · FG Demo - Blocked without blocker explanation still needs an unblock decision. · Ask Morgan Project Owner to add the blocker reason.

Status: fail (groundedness, specificity, repetitionBudget, cavemanCopy)

| Dimension | Score |
| --- | ---: |
| actionability | 4 |
| groundedness | 2 |
| specificity | 2 |
| brevity | 4 |
| repetitionBudget | 1 |
| informationDensity | 3 |
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

### fg-surface-persisted-update_finding-04beeb33

Persisted proactive/update_finding output from 2026-05-31T00:43:12.190Z

Visible copy:

> Blocked: FG Demo - Inactive week blocked control · FG Demo - Inactive week blocked control still needs an unblock decision. · Ask Riley Builder to confirm owner and next step for Week 6.

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
