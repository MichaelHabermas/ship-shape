# shipshape-security

ShipShape **Category 8** security audit tool: live probe harness, findings SoT (`security-findings.json`), CLI, and reviewer **Security Console** (dashboard tab + `pnpm security:console`).

Source brief: `my-docs/SOURCE-OF-TRUTH/Shipshape-Security-Audit.txt`

## Install

From repo root (after `pnpm install`):

```bash
pnpm exec shipshape-security --help
```

Optional global link:

```bash
pnpm link --global --filter @ship/shipshape-security
shipshape-security --help
```

## Reviewer Security Console

Regenerate the dashboard, then run the local console server:

```bash
pnpm submission:render-dashboard
pnpm security:console   # http://127.0.0.1:9876/
```

Open the **Security Console** tab (or use the console URL directly). The console supports:

- **Run probe** / **Findings check** (subprocess — does not kill the server on probe failure)
- **Run CI gate** (mirrors `pnpm security:probe:ci` with confirmation; uses `ship_test_audit` + port 3099)
- **WebSocket** job logs, **hot payload** reload (`GET /api/payload`), optional auto-refresh after runs
- SS-FIND drawer: focus trap, filter persistence, copy buttons, inline narrative edit (when linked)

Requires `pnpm dev` for live probes (CI gate starts its own API).

Build optional Vite bundle: `pnpm --filter @ship/shipshape-security build:console-ui`

## Grader one-liner

With API running (`pnpm dev`):

```bash
pnpm exec shipshape-security run
```

Full fresh-instance gate (CI equivalent):

```bash
pnpm exec shipshape-security ci
```

Deployed Render site (safe remote mode — write/stress probes skipped unless opted in):

```bash
pnpm security:probe:deployed
# or: ./scripts/security-probe/run-deployed-probe.sh
```

## Commands

| Command | Purpose |
|---------|---------|
| `run` | Live probe (default 5 surfaces; `--cat8-perimeter` for 4) |
| `ci` | Migrate/seed DB, API, tests, probe `--fail-on=new`, findings check |
| `findings` | List/show/status/render/check SS-FIND rows |
| `baseline deps` | pnpm audit before/after |
| `baseline deliverable` | Rebuild `cat8-audit-deliverable.json` |
| `compliance` | Print audit table vs latest probe |
| `tui` | Deprecated — exits 1; use `pnpm security:console` |

## Evidence

Writes under `my-docs/evidence/security-audit/`:

- `latest.json` / `runs/<run-id>/report.json`
- `security-findings.json` (authoritative workflow status)
- `security-findings-ledger.md` (generated — use `findings render`)

## Tests

```bash
pnpm --filter @ship/shipshape-security test
```
