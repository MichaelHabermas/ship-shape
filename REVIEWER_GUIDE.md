# Reviewer Guide

Start here if you are reviewing the ShipShape submission.

## Fast Path

1. Open `my-docs/reviewer-dashboard.html`.
   - This is the reviewer packet: category summary, evidence links, security view, and appendix.
   - For the deployed static packet, use `https://ship-shape-reviewer-evidence.onrender.com/`.

2. Open `my-docs/SUBMISSION_CHECKLIST.md`.
   - This is the human-readable index of deliverables, exact artifact paths, deployed URLs, final verification status, and known blockers.
   - The Category Proof Map is the shortest way to check all category claims.

3. Use `my-docs/evidence/submission-ledger.json` as the claim source of truth.
   - If a narrative doc and the ledger disagree, trust the ledger.
   - Generated views come from the ledger: `my-docs/reviewer-dashboard.html` and the Current Ledger Truth block in `my-docs/IMPROVEMENT_REPORT.md`.

## What To Check

| Question | Go To |
| --- | --- |
| Did every category hit the source target? | `my-docs/SUBMISSION_CHECKLIST.md` -> Category Proof Map |
| What is the canonical status for each category? | `my-docs/evidence/submission-ledger.json` |
| What changed and why? | `my-docs/IMPROVEMENT_REPORT.md` |
| What were the audit baselines? | `my-docs/AUDIT_REPORT.md` |
| What was the original Week 4 assignment? | `my-docs/SOURCE-OF-TRUTH/GFA-Week-4-ShipShape.txt` |
| What was the Category 8 security assignment? | `my-docs/SOURCE-OF-TRUTH/Shipshape-Security-Audit.txt` |
| What did the codebase orientation cover? | `my-docs/Codebase-Orientation-Checklist.md` |
| What discoveries were made? | `my-docs/discovery-research-log.md` |
| What did AI cost and help with? | `my-docs/AI_COST_ANALYSIS.md` |
| How do I run the app? | `README.md` |

## Category Proof

Use `my-docs/SUBMISSION_CHECKLIST.md` first. It maps each category to:

- source target
- before artifact
- after artifact or proof
- validation command
- caveat or non-claim

Current expected status: Categories 1-8 are `proven` in `my-docs/evidence/submission-ledger.json`.

## Security Review

For Category 8, start with the Security tab in `my-docs/reviewer-dashboard.html`.

Then check:

- Source brief: `my-docs/SOURCE-OF-TRUTH/Shipshape-Security-Audit.txt`
- Latest report: `my-docs/evidence/security-audit/latest.json`
- Findings ledger: `my-docs/evidence/security-audit/security-findings-ledger.md`
- Runnable probe: `pnpm security:probe:ci`

Boundary: Category 8 proves the runnable probe, required attack surfaces, manual review, and named before/after fixes. It does not claim remote production penetration testing, FedRAMP/NIST certification, or that every historical security backlog item is closed.

## Verification Commands

Run the submission gates first:

```bash
pnpm submission:validate
pnpm submission:render
pnpm submission:check
```

Then use category-specific commands from `my-docs/SUBMISSION_CHECKLIST.md` only when you want to reproduce a specific claim.

For Category 8 changes or skepticism:

```bash
pnpm security:probe:ci
pnpm security:findings:check
pnpm security:findings:render
```

Known local caveat: final checklist notes one standalone API Vitest blocker when PostgreSQL is not listening on `localhost:5432`. That is an environment availability issue, not a category claim.

## Claim Boundaries

- Category 2 proves initial-entry/code-splitting improvement, not total bundle reduction.
- Category 4 proves app-shell query consolidation, not a blanket N+1 fix.
- Category 7 proves axe Critical/Serious closeout on the source-backed page set, not full manual screen-reader certification.
- Category 8 proves runnable-probe security evidence and named fixes, not generic dependency hygiene or remote production penetration testing.

## If Something Looks Off

Use this order of authority:

1. `my-docs/evidence/submission-ledger.json`
2. `my-docs/SUBMISSION_CHECKLIST.md`
3. `my-docs/reviewer-dashboard.html`
4. `my-docs/IMPROVEMENT_REPORT.md`
5. Raw evidence files linked from the above

Do not infer stronger claims from older notes, work logs, scratch evidence, or broad narrative sections.
