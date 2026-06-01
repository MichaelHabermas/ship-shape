# FleetGraph Product Surface Eval

Generated: 2026-06-01T02:10:34.570Z

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

### fg-surface-persisted-update_finding-3d0d67a9

Persisted proactive/update_finding output from 2026-05-31T23:34:35.787Z

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

### fg-surface-persisted-update_finding-b34cbe83

Persisted proactive/update_finding output from 2026-05-31T23:34:35.783Z

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

### fg-surface-persisted-update_finding-12b3c31e

Persisted proactive/update_finding output from 2026-05-31T23:34:35.779Z

Visible copy:

> Blocked: FG-MULTI-07 Security console deploy readiness is blocked and aging · FG-MULTI-07 Security console deploy readiness is blocked and aging still needs an unblock decision. · Ask Riley Builder to confirm owner and next step for Week 7.

Status: fail (repetitionBudget)

| Dimension | Score |
| --- | ---: |
| actionability | 4 |
| groundedness | 3 |
| specificity | 3 |
| brevity | 3 |
| repetitionBudget | 1 |
| informationDensity | 3 |
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

### fg-surface-persisted-update_finding-6be0b551

Persisted proactive/update_finding output from 2026-05-31T23:34:35.711Z

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

### fg-surface-persisted-update_finding-6c268340

Persisted proactive/update_finding output from 2026-05-31T23:34:35.704Z

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

### fg-surface-persisted-update_finding-47073ae7

Persisted proactive/update_finding output from 2026-05-31T23:32:35.664Z

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

### fg-surface-persisted-update_finding-bb2d71ac

Persisted proactive/update_finding output from 2026-05-31T23:32:35.661Z

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

### fg-surface-persisted-update_finding-deca1482

Persisted proactive/update_finding output from 2026-05-31T23:32:35.656Z

Visible copy:

> Blocked: FG-MULTI-07 Security console deploy readiness is blocked and aging · FG-MULTI-07 Security console deploy readiness is blocked and aging still needs an unblock decision. · Ask Riley Builder to confirm owner and next step for Week 7.

Status: fail (repetitionBudget)

| Dimension | Score |
| --- | ---: |
| actionability | 4 |
| groundedness | 3 |
| specificity | 3 |
| brevity | 3 |
| repetitionBudget | 1 |
| informationDensity | 3 |
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

### fg-surface-persisted-update_finding-fbcdbedf

Persisted proactive/update_finding output from 2026-05-31T23:32:35.578Z

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

### fg-surface-persisted-update_finding-2f1e72e7

Persisted proactive/update_finding output from 2026-05-31T23:32:35.566Z

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

### fg-surface-persisted-update_finding-d926fcac

Persisted proactive/update_finding output from 2026-05-31T23:30:35.510Z

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

### fg-surface-persisted-update_finding-e1625e3a

Persisted proactive/update_finding output from 2026-05-31T23:30:35.500Z

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

### fg-surface-persisted-update_finding-63023d62

Persisted proactive/update_finding output from 2026-05-31T23:30:35.495Z

Visible copy:

> Blocked: FG-MULTI-07 Security console deploy readiness is blocked and aging · FG-MULTI-07 Security console deploy readiness is blocked and aging still needs an unblock decision. · Ask Riley Builder to confirm owner and next step for Week 7.

Status: fail (repetitionBudget)

| Dimension | Score |
| --- | ---: |
| actionability | 4 |
| groundedness | 3 |
| specificity | 3 |
| brevity | 3 |
| repetitionBudget | 1 |
| informationDensity | 3 |
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

### fg-surface-persisted-update_finding-0b8ac197

Persisted proactive/update_finding output from 2026-05-31T23:30:35.419Z

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

### fg-surface-persisted-update_finding-e91a4458

Persisted proactive/update_finding output from 2026-05-31T23:30:35.408Z

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

### fg-surface-persisted-update_finding-9301ba0e

Persisted proactive/update_finding output from 2026-05-31T23:28:35.354Z

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

### fg-surface-persisted-update_finding-f39ced43

Persisted proactive/update_finding output from 2026-05-31T23:28:35.349Z

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

### fg-surface-persisted-update_finding-56606193

Persisted proactive/update_finding output from 2026-05-31T23:28:35.345Z

Visible copy:

> Blocked: FG-MULTI-07 Security console deploy readiness is blocked and aging · FG-MULTI-07 Security console deploy readiness is blocked and aging still needs an unblock decision. · Ask Riley Builder to confirm owner and next step for Week 7.

Status: fail (repetitionBudget)

| Dimension | Score |
| --- | ---: |
| actionability | 4 |
| groundedness | 3 |
| specificity | 3 |
| brevity | 3 |
| repetitionBudget | 1 |
| informationDensity | 3 |
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

### fg-surface-persisted-update_finding-436fb819

Persisted proactive/update_finding output from 2026-05-31T23:28:35.268Z

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

### fg-surface-persisted-update_finding-63bbd803

Persisted proactive/update_finding output from 2026-05-31T23:28:35.257Z

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
