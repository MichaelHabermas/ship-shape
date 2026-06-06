# Scripts Traceability

Map of `scripts/` orchestration, ledgers, and gate closure for agents and reviewers.

## Ledgers (two systems — do not merge)

| Ledger | Path | Schema | Closure use |
|--------|------|--------|-------------|
| Week 4 submission (Cat 1–8) | `my-docs/evidence/submission-ledger.json` | JSON v2 | Reviewer dashboard, security Cat-8, historical Gauntlet |
| Week 6 PlugForge proof | `my-docs/project-weeks-sot/week-6/proof-ledger.yaml` | YAML v3 | Live PlugForge gates, atom inventory, `pnpm plugforge:submission` |

Week 6 work edits **proof-ledger.yaml**. Week 4 submission ledger stays frozen unless explicitly updating Cat 1–8 history.

## Gate closure hierarchy

```
pnpm plugforge:submission
  ├─ optional: pnpm submission:render + submission:check (legacy Week 4 drift warnings)
  ├─ pnpm plugforge:final
  │    └─ pnpm plugforge:verify
  │         ├─ pnpm plugforge:ledger
  │         ├─ node scripts/ci/run-plugforge-api-tests.mjs  (manifest SSOT)
  │         └─ SDK/CLI/integration boundary checks
  ├─ pnpm plugforge:oauth-e2e
  ├─ pnpm plugforge:gate-honesty
  └─ pnpm plugforge:ledger:enforce
```

API test inventory SSOT: `scripts/ci/plugforge-api-tests.manifest.json`.

## Shared `scripts/lib/` modules

| Module | Role |
|--------|------|
| `run-command.mjs` | Unified subprocess spawn (timeout, tail, throw/return) |
| `parse-args.mjs` | CLI flag parsing adapters |
| `net.mjs` | `freePort()` |
| `process-utils.mjs` | `sleep`, `onceExit`, tail collectors |
| `http-wait.mjs` | `waitForHttp()` |
| `database-url.sh` + `resolve-database-url.sh` | Postgres URL/port SSOT |
| `ttfe-server.mjs` | API (+ optional web) spawn for TTFE and integration drills |
| `e2e-summary.mjs` | Playwright `summary.json` parsing for E2E shells |
| `e2e-preflight.mjs` | Chromium launch probe |
| `plugforge-live-drill.mjs` | Live external integration proof helpers |
| `plugforge-ledger-validators.mjs` | Atom-specific live evidence JSON validators (used by ledger checker) |
| `parse-args.mjs` | Shared CLI parsing (`parseArgsFlat` for metrics, `parseArgsMap` for drills) |

## Shell conventions

Deploy scripts use `set -euo pipefail`. When adding `set -u`, initialize Terraform-derived variables to empty strings before conditional assignment (`deploy-api.sh` EB create path) so `${EB_VPC_ID:-$VPC_ID}` never expands an unbound name.

## Key entry points

- **Dev:** `scripts/dev.sh` → sources `database-url.sh`
- **API tests:** `scripts/run-api-tests.sh` → `resolve-database-url.sh`
- **TTFE:** `scripts/drill.mjs` → `ttfe-server.mjs`
- **PlugForge integrations:** `scripts/ci/plugforge-integrations.mjs`
- **FleetGraph proof:** `scripts/fleetgraph-proof/run.mjs` → `proof-collect.mjs`
- **Submission dashboard:** `scripts/submission/render-dashboard.mjs` → `ledger-projections.mjs`
