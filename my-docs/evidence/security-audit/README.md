# Category 8 security evidence — where everything is

All paths are under `my-docs/evidence/security-audit/` in the **ship-shape** repo only.

## One aligned table (start here)

**`cat8-audit-deliverable.json`** — every row from `Shipshape-Security-Audit.txt` with **baseline (BASELINE branch) → current (master)** values.

Plain language: an **empty findings list** means the probe **ran and found zero issues**, not that we skipped the check.

## Dependency CVEs (before vs after)

| | Number | File |
| --- | ---: | --- |
| **Before** (BASELINE branch, commit `072818c`) | **33** high/critical | `runs/baseline-before/summary.json` |
| **After** (current master) | **0** | `runs/baseline-after/summary.json` |

Each vulnerable package in the baseline list includes **application_features** (brief lines 20–21).

Short write-up: **`baseline-measurements.md`**

## Live security probe (BASELINE vs current)

| | File |
| --- | --- |
| **BASELINE** live probe (22 probes merged, 8 findings) | `runs/baseline-before-probe/report.json` |
| **Current** full probe (v1 closeout: 25 probes, 0 perimeter findings) | **`runs/cat8-final/report.json`** (immutable) |
| **Probe v2** baseline (40 probes, authorization + triage) | **`runs/probe-v2-baseline-unfixed/report.json`** |
| Latest run pointer | **`latest.json`** / `latest.md` |
| Finding fingerprints (dedupe open vs new) | **`probe-finding-registry.json`** |

## Two fixes we proved (before / after)

| Fix | Before | After |
| --- | --- | --- |
| File upload size + headers | `runs/before-file-size/`, `runs/before-file-headers/` | `runs/after-file-size/`, `runs/after-file-headers-2/` |
| WebSocket malformed frames | `runs/before-ws-malformed/` | `runs/after-ws-malformed/`, `runs/after-ws-oversized/` |

## Deep review backlog (not dependency CVEs)

34 open app-security items from manual code review: **`security-findings-ledger.md`**

## Submission ledger + HTML dashboard

- Category 8 in **`../submission-ledger.json`** (synced from `cat8-audit-deliverable.json`)
- Reviewer HTML: **`../../reviewer-dashboard.html`** — run `pnpm submission:render-dashboard` after ledger changes

## Re-run commands

```bash
pnpm security:baseline:deps      # pnpm audit before/after (clone BASELINE once)
pnpm security:baseline:probe     # full live probe on BASELINE clone (phased + merge)
pnpm security:baseline:deliverable  # rebuild cat8-audit-deliverable.json + sync ledger
pnpm security:probe              # current-code live probe → latest.json + runs/<run-id>/
pnpm security:probe:sync-registry
pnpm submission:render-dashboard
```

Raw audit JSON, stderr logs, and probe merge partials are **gitignored** (regenerate with the commands above). Only summaries and final reports are committed.
