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
| **Current** full probe | **`latest.json`** / `latest.md` |
| **Probe v2** baseline and triage | **`security-findings.json`** / `security-findings-ledger.md` |
| Latest run pointer | **`latest.json`** / `latest.md` |
| Security findings SoT (status, probes, verifications) | **`security-findings.json`** |
| Generated human ledger (do not edit) | **`security-findings-ledger.md`** |
| Long-form narratives | **`security-findings/narratives/SS-FIND-NNN.md`** |

## Two fixes we proved (before / after)

| Fix | Before | After |
| --- | --- | --- |
| File upload size + headers | Finding history in `security-findings.json` | Latest status in `latest.json` |
| WebSocket malformed frames | Finding history in `security-findings.json` | Latest status in `latest.json` |

## Deep review backlog (not dependency CVEs)

34 app-security items from manual code review: **`security-findings.json`** (workflow status via `pnpm exec shipshape-security findings status`; ledger is generated)

## Submission ledger + HTML dashboard

- Category 8 in **`../submission-ledger.json`** (synced from `cat8-audit-deliverable.json`)
- Reviewer HTML: **`../../reviewer-dashboard.html`** — **Security Console** tab (full deliverable table, probes, SS-FIND backlog, verified fixes). Regenerate with `pnpm submission:render-dashboard` after ledger changes.
- Interactive runs: **`pnpm security:console`** → open `http://127.0.0.1:9876/`, use **Run probe** / **Findings check** (requires `pnpm dev` API for probe).

## Re-run commands

```bash
pnpm exec shipshape-security --help
pnpm security:console                  # dashboard + runnable probe (local)
pnpm exec shipshape-security run       # live probe → latest.json + runs/<run-id>/
pnpm exec shipshape-security ci        # full CI gate
pnpm exec shipshape-security findings check
pnpm security:console                  # Security Console (primary); tui deprecated
pnpm exec shipshape-security baseline deps
pnpm exec shipshape-security baseline deliverable
pnpm submission:render-dashboard
```

(`pnpm security:*` scripts are aliases to the same binary.)

Raw audit JSON, stderr logs, and probe merge partials are **gitignored** (regenerate with the commands above). Only summaries and final reports are committed.
