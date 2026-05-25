# Category 8 Security Audit Runbook

Source of truth: `my-docs/project-weeks-sot/week-4/Shipshape-Security-Audit.txt`.

Category 8 is delivered as **`shipshape-security`** (`@ship/shipshape-security` in this monorepo): a runnable CLI + TUI that probes the live app and manages the findings SoT.

```bash
pnpm install
pnpm dev
pnpm exec shipshape-security --help
pnpm exec shipshape-security run
pnpm security:console                     # primary interactive UX (probe / CI mirror / SS-FIND)
# shipshape-security tui is deprecated (exits 1)
pnpm security:console                    # reviewer dashboard + runnable probe
```

`pnpm security:*` scripts are thin aliases to the same binary.

### Grader / fresh instance

```bash
pnpm exec shipshape-security ci
```

Or with a running dev API:

```bash
pnpm exec shipshape-security run
```

### Probe v2 (authorization + unified findings store)

Default **`run`** measures **five** attack surfaces (Cat 8’s four required surfaces plus **authorization**). Use **`run --cat8-perimeter`** for historical 4-surface mode.

Reports use `schemaVersion: 2` and triage against [`security-findings.json`](evidence/security-audit/security-findings.json) (authoritative; [`security-findings-ledger.md`](evidence/security-audit/security-findings-ledger.md) is generated):

- **known-open** — tracked vulnerability, probe still fails
- **new** — probe failed, fingerprint not in store yet
- **resolved** — store marked open, probe now passes (confirm status via CLI before closing SS-FIND)
- **regression** — store marked fixed/control, probe failed again

```bash
pnpm exec shipshape-security run --run-id probe-v2-baseline-unfixed
pnpm exec shipshape-security run --fail-on=new
pnpm exec shipshape-security ci
pnpm exec shipshape-security findings list
pnpm exec shipshape-security findings status SS-FIND-008 open --note "document scope still open"
pnpm exec shipshape-security findings check
pnpm exec shipshape-security compliance
```

Historical Cat 8 closeout remains a perimeter-only scope concept (25/25 passed in the original closeout); use `latest.*` or existing immutable run directories for current reviewer links because the old `runs/cat8-final/` path is no longer present in-tree.

The default local credentials are the seeded dev accounts:

- Admin: `dev@ship.local` / `admin123`
- Member: `bob.martinez@ship.local` / `admin123`

The runner discovers `.ports` from `pnpm dev`, accepts `--api-url` and `--web-url`, and writes both stable latest reports and immutable run reports:

- `my-docs/evidence/security-audit/latest.json`
- `my-docs/evidence/security-audit/latest.md`
- `my-docs/evidence/security-audit/security-findings.json` — workflow status, probe bindings, verifications
- `my-docs/evidence/security-audit/security-findings-ledger.md` — generated human ledger
- `my-docs/evidence/security-audit/runs/<run-id>/report.json`
- `my-docs/evidence/security-audit/runs/<run-id>/report.md`

Final closeout run:

```bash
pnpm exec shipshape-security run --run-id cat8-final --cat8-perimeter
```

Retroactive dependency CVE baselines:

```bash
pnpm exec shipshape-security baseline deps
```

Before: **33** (BASELINE branch). After: **0**. Files: `runs/baseline-before/`, `runs/baseline-after/`. Index: `README.md` in this folder.

**Historical closeout (perimeter scope):** 4/4 required attack surfaces measured, 25/25 probes passed, 0 findings.

**Probe v2 baseline (`probe-v2-baseline-unfixed`):** 5/5 surfaces measured; authorization probes detect open SS-FIND items. See `runs/probe-v2-baseline-unfixed/report.md` for triage buckets.

Covered surfaces (v1 + v2):

- Auth/session: unauthenticated API rejection, invalid bearer rejection, session cookie flags, session ID shape/browser expiry, CSRF rejection, API-token super-admin boundary.
- WebSocket validation: unauthenticated collaboration rejection, missing document rejection, malformed frame handling, unknown message handling, oversized frame handling, malformed `/events` message handling, unknown `/events` message type handling.
- Input sanitization: stored XSS-shaped document title, reflected/search payloads, SQL-shaped search strings, long field validation, issue payloads, comment payloads, file upload size/header smoke checks.
- Dependency CVEs: `pnpm audit --json` high/critical count, including dev/transitive advisories.
- Assisted review: CORS/CSP, secret/env exposure, API/WS rate-limit map, verbose malformed-request leakage.
- Authorization (v2): governance field injection, RACI self-assign, week status bypass, weekly-plan IDOR (REST + WS), cross-origin WS, pending-upload hijack, file serve scope, bulk-issue foreign IDs, dashboard metadata leak; abuse surfaces for login/public-feedback rate limits.

Verified fixes:

1. Local upload validation and serving headers.
   Before reports: `runs/before-file-size/report.json`, `runs/before-file-headers/report.json`.
   After reports: `runs/after-file-size/report.json`, `runs/after-file-headers-2/report.json`.
   Fix: `api/src/routes/files.ts` rejects mismatched declared byte lengths and serves user uploads as attachments with sanitized filenames while retaining `X-Content-Type-Options: nosniff`.

2. WebSocket malformed/oversized frame resilience.
   Before report: `runs/before-ws-malformed/report.json`.
   After reports: `runs/after-ws-malformed/report.json`, `runs/after-ws-oversized/report.json`.
   Fix: `api/src/collaboration/index.ts` catches collaboration decode failures, closes unsupported/invalid collaboration and events messages with `1003`, and handles oversized frames with `1009` without crashing the API process.

Additional hardening found by the probe: malformed JSON no longer falls through to Express default stack output; `api/src/app.ts` now returns a generic 400 JSON response for body-parser parse failures.

Remote mode remains safe by default. Any remote write or stress probe requires explicit `--allow-write` or `--allow-stress`.

Package README: `packages/shipshape-security/README.md`

## Open findings (post–Cat 8 deep review)

Probe closeout for the 4-surface perimeter covered **perimeter** controls. A separate deep authorization review on **2026-05-22** recorded **34 open business-logic findings** in the backlog — governance bypasses, weekly-plan IDOR, metadata leaks, and abuse surfaces.

**Canonical backlog:** `security-findings.json` (CLI: `shipshape-security findings`)

When a finding is fixed:

1. Set status: `pnpm exec shipshape-security findings status SS-FIND-NNN fixed --note "..."`
2. Move a short summary into **Verified fixes** above (same pattern as file upload / WebSocket hardening).
3. Add regression probes under `packages/shipshape-security/src/probes/` where applicable.
