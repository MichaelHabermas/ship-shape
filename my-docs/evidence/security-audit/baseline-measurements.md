# Dependency CVE baseline (Category 8)

Measured: 2026-05-23  
Tool: `pnpm audit --json` (high + critical only)

## How we measured “before”

We cloned the **entire ship-shape repo** into a **second folder** next to the original (`../ship-shape-baseline-measurement`), checked out the **BASELINE** branch (old code), ran `pnpm install` and `pnpm audit`, saved the JSON, then deleted the clone.

The saved results live in **this repo only** under `runs/baseline-before/`. We did not change the BASELINE branch.

## Results

| | High + critical CVEs |
| --- | ---: |
| **Before** (BASELINE branch, `072818c`) | **33** |
| **After** (current master) | **0** |

## Proof files

- Before: `runs/baseline-before/summary.json` (and `pnpm-audit-all.json`)
- After: `runs/baseline-after/summary.json`

## Re-run

```bash
pnpm security:baseline:deps
```

## Current probe (separate from dependency audit)

Live app security checks: `latest.json` (unchanged by this baseline work).
