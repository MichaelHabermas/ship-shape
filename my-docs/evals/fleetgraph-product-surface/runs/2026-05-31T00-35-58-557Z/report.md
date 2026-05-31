# FleetGraph Product Surface Eval

Generated: 2026-05-31T00:35:58.557Z

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

### fg-surface-persisted-update_finding-f52b1ac8

Persisted proactive/update_finding output from 2026-05-31T00:36:06.801Z

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

### fg-surface-persisted-update_finding-5c2cace2

Persisted proactive/update_finding output from 2026-05-31T00:36:01.715Z

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

### fg-surface-persisted-update_finding-4b1ac2ba

Persisted proactive/update_finding output from 2026-05-31T00:35:56.693Z

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

### fg-surface-persisted-update_finding-f3c0b62b

Persisted proactive/update_finding output from 2026-05-31T00:33:51.644Z

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

### fg-surface-persisted-update_finding-c11b8710

Persisted proactive/update_finding output from 2026-05-31T00:33:46.625Z

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

### fg-surface-persisted-update_finding-f77a3888

Persisted proactive/update_finding output from 2026-05-31T00:33:41.614Z

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

### fg-surface-persisted-update_finding-d12e6ba2

Persisted proactive/update_finding output from 2026-05-31T00:33:36.528Z

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

### fg-surface-persisted-update_finding-0ea227aa

Persisted proactive/update_finding output from 2026-05-31T00:33:31.506Z

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

### fg-surface-persisted-update_finding-0ad60b32

Persisted proactive/update_finding output from 2026-05-31T00:32:41.956Z

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

### fg-surface-persisted-update_finding-cb9fe362

Persisted proactive/update_finding output from 2026-05-31T00:32:36.941Z

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

### fg-surface-persisted-update_finding-8740d479

Persisted proactive/update_finding output from 2026-05-31T00:32:31.925Z

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

### fg-surface-persisted-create_finding-1a9798c5

Persisted proactive/create_finding output from 2026-05-31T00:32:31.837Z

Visible copy:

> Blocked: [FleetGraph Reviewer] Human unblock path 2026-05-31T00:32:26.765Z · Waiting on reviewer proof unblock decision · Week 7 · Ask FleetGraph Reviewer to confirm owner and next step for Week 7.

Status: fail (repetitionBudget, duplicateFactControl, uiProofSeparation)

| Dimension | Score |
| --- | ---: |
| actionability | 4 |
| groundedness | 4 |
| specificity | 4 |
| brevity | 4 |
| repetitionBudget | 2 |
| informationDensity | 4 |
| cavemanCopy | 4 |
| duplicateFactControl | 2 |
| uncertaintyHonesty | 4 |
| missingDataUsefulness | 4 |
| uiProofSeparation | 1 |

Notes:
- Loaded from fleetgraph_runs.output_snapshot.
- This is the report path that tracks real persisted FleetGraph outputs over time.

Human review:
- TBD

### fg-surface-persisted-update_finding-9dfa7868

Persisted proactive/update_finding output from 2026-05-31T00:31:26.467Z

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

### fg-surface-persisted-update_finding-ddf21005

Persisted proactive/update_finding output from 2026-05-31T00:31:21.452Z

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

### fg-surface-persisted-update_finding-d4766b4a

Persisted proactive/update_finding output from 2026-05-31T00:31:16.435Z

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

### fg-surface-persisted-update_finding-5b2b1a0e

Persisted proactive/update_finding output from 2026-05-31T00:31:11.344Z

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

### fg-surface-persisted-update_finding-118ee819

Persisted proactive/update_finding output from 2026-05-31T00:31:06.011Z

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

### fg-surface-persisted-update_finding-03f938b1

Persisted proactive/update_finding output from 2026-05-31T00:27:06.162Z

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

### fg-surface-persisted-update_finding-3f6b41db

Persisted proactive/update_finding output from 2026-05-31T00:27:01.150Z

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

### fg-surface-persisted-update_finding-d5021cf7

Persisted proactive/update_finding output from 2026-05-31T00:26:56.130Z

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
