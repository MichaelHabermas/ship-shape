# FleetGraph Product Surface Eval

Generated: 2026-05-28T23:32:12.231Z

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

### fg-surface-persisted-refine_draft-9818fc2c

Persisted on_demand/refine_draft output from 2026-05-28T23:31:09.988Z

Visible copy:

> Blocked: FG Demo - SSO cert rotation blocked · The FleetGraph Demo is currently blocked due to the pending approval of the SSO certificate rotation window by the designated dependency owner, Casey. This approval is critical to proceed with the certificate update necessary for secure single sign-on functionality during the demo scheduled in Week 7. Without this approval, the demo cannot move forward as planned. · Ask Riley Builder to confirm owner and next step for Week 7.

Status: fail (brevity, repetitionBudget, informationDensity, cavemanCopy)

| Dimension | Score |
| --- | ---: |
| actionability | 4 |
| groundedness | 3 |
| specificity | 3 |
| brevity | 1 |
| repetitionBudget | 1 |
| informationDensity | 1 |
| cavemanCopy | 1 |
| duplicateFactControl | 3 |
| uncertaintyHonesty | 4 |
| missingDataUsefulness | 4 |
| uiProofSeparation | 4 |

Notes:
- Loaded from fleetgraph_runs.output_snapshot.
- This is the report path that tracks real persisted FleetGraph outputs over time.

Human review:
- TBD

### fg-surface-persisted-explain-522f949a

Persisted on_demand/explain output from 2026-05-28T23:31:06.200Z

Visible copy:

> Blocked: FG Demo - SSO cert rotation blocked · The FleetGraph Demo is currently blocked due to the pending approval of the SSO certificate rotation window by the designated dependency owner, Casey. This approval is critical to proceed with the certificate update necessary for secure single sign-on functionality during the demo scheduled in Week 7. Without this approval, the demo cannot move forward as planned. · Ask Riley Builder to confirm owner and next step for Week 7.

Status: fail (brevity, repetitionBudget, informationDensity, cavemanCopy)

| Dimension | Score |
| --- | ---: |
| actionability | 4 |
| groundedness | 3 |
| specificity | 3 |
| brevity | 1 |
| repetitionBudget | 1 |
| informationDensity | 1 |
| cavemanCopy | 1 |
| duplicateFactControl | 3 |
| uncertaintyHonesty | 4 |
| missingDataUsefulness | 4 |
| uiProofSeparation | 4 |

Notes:
- Loaded from fleetgraph_runs.output_snapshot.
- This is the report path that tracks real persisted FleetGraph outputs over time.

Human review:
- TBD

### fg-surface-persisted-create_finding-b39e08dd

Persisted proactive/create_finding output from 2026-05-28T23:31:05.136Z

Visible copy:

> Blocked: FG Demo - SSO cert rotation blocked · The FleetGraph Demo is currently blocked due to the pending approval of the SSO certificate rotation window by the designated dependency owner, Casey. This approval is critical to proceed with the certificate update necessary for secure single sign-on functionality during the demo scheduled in Week 7. Without this approval, the demo cannot move forward as planned. · Ask Riley Builder to confirm owner and next step for Week 7.

Status: fail (brevity, repetitionBudget, informationDensity, cavemanCopy)

| Dimension | Score |
| --- | ---: |
| actionability | 4 |
| groundedness | 3 |
| specificity | 3 |
| brevity | 1 |
| repetitionBudget | 1 |
| informationDensity | 1 |
| cavemanCopy | 1 |
| duplicateFactControl | 3 |
| uncertaintyHonesty | 4 |
| missingDataUsefulness | 4 |
| uiProofSeparation | 4 |

Notes:
- Loaded from fleetgraph_runs.output_snapshot.
- This is the report path that tracks real persisted FleetGraph outputs over time.

Human review:
- TBD

### fg-surface-persisted-refine_draft-7790a81e

Persisted on_demand/refine_draft output from 2026-05-28T22:46:35.244Z

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

### fg-surface-persisted-explain-aa3811b6

Persisted on_demand/explain output from 2026-05-28T22:46:30.729Z

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

### fg-surface-persisted-create_finding-88cbfcd4

Persisted proactive/create_finding output from 2026-05-28T22:46:26.014Z

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

### fg-surface-persisted-refine_draft-6ac7be80

Persisted on_demand/refine_draft output from 2026-05-28T22:44:39.887Z

Visible copy:

> Blocked: FG Demo - SSO cert rotation blocked · The FleetGraph Demo is currently blocked due to the pending approval of the SSO certificate rotation window by the designated dependency owner, Casey. This approval is critical to proceed with the certificate update necessary for secure single sign-on functionality during the demo week. · Ask Riley Builder to confirm owner and next step for Week 7.

Status: fail (brevity, repetitionBudget, informationDensity, cavemanCopy)

| Dimension | Score |
| --- | ---: |
| actionability | 4 |
| groundedness | 3 |
| specificity | 3 |
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

### fg-surface-persisted-explain-22eedd10

Persisted on_demand/explain output from 2026-05-28T22:44:36.559Z

Visible copy:

> Blocked: FG Demo - SSO cert rotation blocked · The FleetGraph Demo is currently blocked due to the pending approval of the SSO certificate rotation window by the designated dependency owner, Casey. This approval is critical to proceed with the certificate update necessary for secure single sign-on functionality during the demo week. · Ask Riley Builder to confirm owner and next step for Week 7.

Status: fail (brevity, repetitionBudget, informationDensity, cavemanCopy)

| Dimension | Score |
| --- | ---: |
| actionability | 4 |
| groundedness | 3 |
| specificity | 3 |
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

### fg-surface-persisted-create_finding-7cd7bba3

Persisted proactive/create_finding output from 2026-05-28T22:44:35.516Z

Visible copy:

> Blocked: FG Demo - SSO cert rotation blocked · The FleetGraph Demo is currently blocked due to the pending approval of the SSO certificate rotation window by the designated dependency owner, Casey. This approval is critical to proceed with the certificate update necessary for secure single sign-on functionality during the demo week. · Ask Riley Builder to confirm owner and next step for Week 7.

Status: fail (brevity, repetitionBudget, informationDensity, cavemanCopy)

| Dimension | Score |
| --- | ---: |
| actionability | 4 |
| groundedness | 3 |
| specificity | 3 |
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

### fg-surface-persisted-refine_draft-bb642cf1

Persisted on_demand/refine_draft output from 2026-05-28T22:22:47.589Z

Visible copy:

> Blocked: FG Demo - SSO cert rotation blocked · The FleetGraph Demo is currently blocked due to the pending approval of the SSO certificate rotation window by the designated dependency owner, Casey. This approval is critical to proceed with the certificate update and ensure uninterrupted authentication during the demo week. · Ask Riley Builder to confirm owner and next step for Week 7.

Status: fail (brevity, repetitionBudget, informationDensity, cavemanCopy)

| Dimension | Score |
| --- | ---: |
| actionability | 4 |
| groundedness | 3 |
| specificity | 3 |
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

### fg-surface-persisted-explain-bc8168fe

Persisted on_demand/explain output from 2026-05-28T22:22:43.657Z

Visible copy:

> Blocked: FG Demo - SSO cert rotation blocked · The FleetGraph Demo is currently blocked due to the pending approval of the SSO certificate rotation window by the designated dependency owner, Casey. This approval is critical to proceed with the certificate update and ensure uninterrupted authentication during the demo week. · Ask Riley Builder to confirm owner and next step for Week 7.

Status: fail (brevity, repetitionBudget, informationDensity, cavemanCopy)

| Dimension | Score |
| --- | ---: |
| actionability | 4 |
| groundedness | 3 |
| specificity | 3 |
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

### fg-surface-persisted-create_finding-00316f16

Persisted proactive/create_finding output from 2026-05-28T22:22:42.662Z

Visible copy:

> Blocked: FG Demo - SSO cert rotation blocked · The FleetGraph Demo is currently blocked due to the pending approval of the SSO certificate rotation window by the designated dependency owner, Casey. This approval is critical to proceed with the certificate update and ensure uninterrupted authentication during the demo week. · Ask Riley Builder to confirm owner and next step for Week 7.

Status: fail (brevity, repetitionBudget, informationDensity, cavemanCopy)

| Dimension | Score |
| --- | ---: |
| actionability | 4 |
| groundedness | 3 |
| specificity | 3 |
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

### fg-surface-persisted-refine_draft-e461c6fd

Persisted on_demand/refine_draft output from 2026-05-28T22:12:51.474Z

Visible copy:

> Blocked: FG Demo - SSO cert rotation blocked · The FleetGraph Demo is currently blocked due to the pending approval of the SSO certificate rotation window by the designated dependency owner, Casey. This approval is critical to proceed with the certificate update and ensure uninterrupted authentication during the demo scheduled for Week 7. Without this approval, the demo cannot move forward as planned. · Ask Riley Builder to confirm owner and next step for Week 7.

Status: fail (brevity, repetitionBudget, informationDensity, cavemanCopy)

| Dimension | Score |
| --- | ---: |
| actionability | 4 |
| groundedness | 3 |
| specificity | 3 |
| brevity | 1 |
| repetitionBudget | 1 |
| informationDensity | 1 |
| cavemanCopy | 1 |
| duplicateFactControl | 3 |
| uncertaintyHonesty | 4 |
| missingDataUsefulness | 4 |
| uiProofSeparation | 4 |

Notes:
- Loaded from fleetgraph_runs.output_snapshot.
- This is the report path that tracks real persisted FleetGraph outputs over time.

Human review:
- TBD

### fg-surface-persisted-explain-a9fe23a9

Persisted on_demand/explain output from 2026-05-28T22:12:47.435Z

Visible copy:

> Blocked: FG Demo - SSO cert rotation blocked · The FleetGraph Demo is currently blocked due to the pending approval of the SSO certificate rotation window by the designated dependency owner, Casey. This approval is critical to proceed with the certificate update and ensure uninterrupted authentication during the demo scheduled for Week 7. Without this approval, the demo cannot move forward as planned. · Ask Riley Builder to confirm owner and next step for Week 7.

Status: fail (brevity, repetitionBudget, informationDensity, cavemanCopy)

| Dimension | Score |
| --- | ---: |
| actionability | 4 |
| groundedness | 3 |
| specificity | 3 |
| brevity | 1 |
| repetitionBudget | 1 |
| informationDensity | 1 |
| cavemanCopy | 1 |
| duplicateFactControl | 3 |
| uncertaintyHonesty | 4 |
| missingDataUsefulness | 4 |
| uiProofSeparation | 4 |

Notes:
- Loaded from fleetgraph_runs.output_snapshot.
- This is the report path that tracks real persisted FleetGraph outputs over time.

Human review:
- TBD

### fg-surface-persisted-create_finding-d6d834ee

Persisted proactive/create_finding output from 2026-05-28T22:12:46.522Z

Visible copy:

> Blocked: FG Demo - SSO cert rotation blocked · The FleetGraph Demo is currently blocked due to the pending approval of the SSO certificate rotation window by the designated dependency owner, Casey. This approval is critical to proceed with the certificate update and ensure uninterrupted authentication during the demo scheduled for Week 7. Without this approval, the demo cannot move forward as planned. · Ask Riley Builder to confirm owner and next step for Week 7.

Status: fail (brevity, repetitionBudget, informationDensity, cavemanCopy)

| Dimension | Score |
| --- | ---: |
| actionability | 4 |
| groundedness | 3 |
| specificity | 3 |
| brevity | 1 |
| repetitionBudget | 1 |
| informationDensity | 1 |
| cavemanCopy | 1 |
| duplicateFactControl | 3 |
| uncertaintyHonesty | 4 |
| missingDataUsefulness | 4 |
| uiProofSeparation | 4 |

Notes:
- Loaded from fleetgraph_runs.output_snapshot.
- This is the report path that tracks real persisted FleetGraph outputs over time.

Human review:
- TBD

### fg-surface-persisted-refine_draft-e40d5213

Persisted on_demand/refine_draft output from 2026-05-28T22:11:15.003Z

Visible copy:

> Blocked: FG Demo - SSO cert rotation blocked · The FleetGraph Demo is currently blocked due to the pending approval of the SSO certificate rotation window by the designated dependency owner, Casey. This approval is critical to proceed with the certificate update necessary for secure single sign-on functionality during the demo scheduled in Week 7. Without this approval, the demo cannot move forward as planned. · Ask Riley Builder to confirm owner and next step for Week 7.

Status: fail (brevity, repetitionBudget, informationDensity, cavemanCopy)

| Dimension | Score |
| --- | ---: |
| actionability | 4 |
| groundedness | 3 |
| specificity | 3 |
| brevity | 1 |
| repetitionBudget | 1 |
| informationDensity | 1 |
| cavemanCopy | 1 |
| duplicateFactControl | 3 |
| uncertaintyHonesty | 4 |
| missingDataUsefulness | 4 |
| uiProofSeparation | 4 |

Notes:
- Loaded from fleetgraph_runs.output_snapshot.
- This is the report path that tracks real persisted FleetGraph outputs over time.

Human review:
- TBD

### fg-surface-persisted-explain-08a6fbd6

Persisted on_demand/explain output from 2026-05-28T22:11:11.143Z

Visible copy:

> Blocked: FG Demo - SSO cert rotation blocked · The FleetGraph Demo is currently blocked due to the pending approval of the SSO certificate rotation window by the designated dependency owner, Casey. This approval is critical to proceed with the certificate update necessary for secure single sign-on functionality during the demo scheduled in Week 7. Without this approval, the demo cannot move forward as planned. · Ask Riley Builder to confirm owner and next step for Week 7.

Status: fail (brevity, repetitionBudget, informationDensity, cavemanCopy)

| Dimension | Score |
| --- | ---: |
| actionability | 4 |
| groundedness | 3 |
| specificity | 3 |
| brevity | 1 |
| repetitionBudget | 1 |
| informationDensity | 1 |
| cavemanCopy | 1 |
| duplicateFactControl | 3 |
| uncertaintyHonesty | 4 |
| missingDataUsefulness | 4 |
| uiProofSeparation | 4 |

Notes:
- Loaded from fleetgraph_runs.output_snapshot.
- This is the report path that tracks real persisted FleetGraph outputs over time.

Human review:
- TBD

### fg-surface-persisted-create_finding-1ecfafd7

Persisted proactive/create_finding output from 2026-05-28T22:11:10.312Z

Visible copy:

> Blocked: FG Demo - SSO cert rotation blocked · The FleetGraph Demo is currently blocked due to the pending approval of the SSO certificate rotation window by the designated dependency owner, Casey. This approval is critical to proceed with the certificate update necessary for secure single sign-on functionality during the demo scheduled in Week 7. Without this approval, the demo cannot move forward as planned. · Ask Riley Builder to confirm owner and next step for Week 7.

Status: fail (brevity, repetitionBudget, informationDensity, cavemanCopy)

| Dimension | Score |
| --- | ---: |
| actionability | 4 |
| groundedness | 3 |
| specificity | 3 |
| brevity | 1 |
| repetitionBudget | 1 |
| informationDensity | 1 |
| cavemanCopy | 1 |
| duplicateFactControl | 3 |
| uncertaintyHonesty | 4 |
| missingDataUsefulness | 4 |
| uiProofSeparation | 4 |

Notes:
- Loaded from fleetgraph_runs.output_snapshot.
- This is the report path that tracks real persisted FleetGraph outputs over time.

Human review:
- TBD

### fg-surface-persisted-refine_draft-c92462ce

Persisted on_demand/refine_draft output from 2026-05-28T21:53:19.087Z

Visible copy:

> Blocked: FG Demo - SSO cert rotation blocked · The FleetGraph Demo is currently blocked due to the pending approval of the SSO certificate rotation window by the designated dependency owner, Casey. This approval is critical to proceed with the certificate update necessary for secure single sign-on functionality during the demo week. · Ask Riley Builder to confirm owner and next step for Week 7.

Status: fail (brevity, repetitionBudget, informationDensity, cavemanCopy)

| Dimension | Score |
| --- | ---: |
| actionability | 4 |
| groundedness | 3 |
| specificity | 3 |
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

### fg-surface-persisted-explain-f0e65fc0

Persisted on_demand/explain output from 2026-05-28T21:53:15.371Z

Visible copy:

> Blocked: FG Demo - SSO cert rotation blocked · The FleetGraph Demo is currently blocked due to the pending approval of the SSO certificate rotation window by the designated dependency owner, Casey. This approval is critical to proceed with the certificate update necessary for secure single sign-on functionality during the demo week. · Ask Riley Builder to confirm owner and next step for Week 7.

Status: fail (brevity, repetitionBudget, informationDensity, cavemanCopy)

| Dimension | Score |
| --- | ---: |
| actionability | 4 |
| groundedness | 3 |
| specificity | 3 |
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
