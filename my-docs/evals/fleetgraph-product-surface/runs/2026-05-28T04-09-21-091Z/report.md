# FleetGraph Product Surface Eval

Generated: 2026-05-28T04:09:21.091Z

## Summary

- Pass: 3
- Fail: 3

| Dimension | Average |
| --- | ---: |
| actionability | 4.00 |
| groundedness | 2.33 |
| specificity | 2.67 |
| brevity | 3.67 |
| repetitionBudget | 2.67 |
| informationDensity | 3.33 |
| cavemanCopy | 3.50 |
| duplicateFactControl | 3.83 |
| uncertaintyHonesty | 3.67 |
| missingDataUsefulness | 3.67 |
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

> Blocked issue: Runtime issue clear blocker · Runtime issue clear blocker is blocked. Latest blocker: Waiting on API credentials. · Confirm the unblock path · FleetGraph sees a blocker signal, but a human must confirm the current unblock path.

Status: fail (groundedness, specificity, repetitionBudget)

| Dimension | Score |
| --- | ---: |
| actionability | 4 |
| groundedness | 2 |
| specificity | 2 |
| brevity | 3 |
| repetitionBudget | 1 |
| informationDensity | 3 |
| cavemanCopy | 3 |
| duplicateFactControl | 4 |
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

> Blocked issue: Runtime issue missing blocker · Runtime issue missing blocker is blocked. No blocker reason was recorded. · Confirm the unblock path · FleetGraph sees a blocker signal, but a human must confirm the current unblock path.

Status: fail (groundedness, specificity, repetitionBudget, informationDensity)

| Dimension | Score |
| --- | ---: |
| actionability | 4 |
| groundedness | 1 |
| specificity | 2 |
| brevity | 3 |
| repetitionBudget | 1 |
| informationDensity | 2 |
| cavemanCopy | 3 |
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

> Runtime existing finding · Runtime existing finding is blocked with a recorded blocker: Waiting on review. · Confirm the unblock path

Status: fail (groundedness, specificity, repetitionBudget, uncertaintyHonesty, missingDataUsefulness)

| Dimension | Score |
| --- | ---: |
| actionability | 4 |
| groundedness | 1 |
| specificity | 1 |
| brevity | 4 |
| repetitionBudget | 2 |
| informationDensity | 3 |
| cavemanCopy | 3 |
| duplicateFactControl | 3 |
| uncertaintyHonesty | 2 |
| missingDataUsefulness | 2 |
| uiProofSeparation | 4 |

Notes:
- Generated through runFleetGraph, not a hand-authored product-surface example.
- Failures here identify current runtime copy that needs product wording work.

Human review:
- TBD
