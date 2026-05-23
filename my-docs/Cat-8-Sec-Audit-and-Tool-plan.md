# Category 8 Security Audit Runbook

Source of truth: `my-docs/SOURCE-OF-TRUTH/Shipshape-Security-Audit.txt`.

Category 8 is implemented as a repo-aware, black-box-first probe harness:

```bash
pnpm dev
pnpm security:probe
pnpm security:probe -- --quick
pnpm security:probe -- --probe <probe-id>
pnpm security:probe:test
```

The default local credentials are the seeded dev accounts:

- Admin: `dev@ship.local` / `admin123`
- Member: `bob.martinez@ship.local` / `admin123`

The runner discovers `.ports` from `pnpm dev`, accepts `--api-url` and `--web-url`, and writes both stable latest reports and immutable run reports:

- `my-docs/evidence/security-audit/latest.json`
- `my-docs/evidence/security-audit/latest.md`
- `my-docs/evidence/security-audit/security-findings-ledger.md` — **open/deferred security findings** with full evidence (separate from probe pass/fail)
- `my-docs/evidence/security-audit/runs/<run-id>/report.json`
- `my-docs/evidence/security-audit/runs/<run-id>/report.md`
- `my-docs/evidence/security-audit/runs/<run-id>/suggested-ledger-update.json`

Final closeout run:

```bash
pnpm security:probe -- --run-id cat8-final
```

Retroactive dependency CVE baselines:

```bash
pnpm security:baseline:deps
```

Before: **33** (BASELINE branch). After: **0**. Files: `runs/baseline-before/`, `runs/baseline-after/`. Index: `README.md` in this folder.

Result: 4/4 required attack surfaces measured, 25/25 probes passed, 0 findings.

Covered surfaces:

- Auth/session: unauthenticated API rejection, invalid bearer rejection, session cookie flags, session ID shape/browser expiry, CSRF rejection, API-token super-admin boundary.
- WebSocket validation: unauthenticated collaboration rejection, missing document rejection, malformed frame handling, unknown message handling, oversized frame handling, malformed `/events` message handling, unknown `/events` message handling.
- Input sanitization: stored XSS-shaped document title, reflected/search payloads, SQL-shaped search strings, long field validation, issue payloads, comment payloads, file upload size/header smoke checks.
- Dependency CVEs: `pnpm audit --json` high/critical count, including dev/transitive advisories.
- Assisted review: CORS/CSP, secret/env exposure, API/WS rate-limit map, verbose malformed-request leakage.

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

## Open findings (post–Cat 8 deep review)

Probe closeout (`cat8-final`: 25/25 passed) covers **perimeter** controls. A separate deep authorization review on **2026-05-22** (same day, after probes) recorded **34 open business-logic findings** in the ledger — governance bypasses, weekly-plan IDOR, metadata leaks, and abuse surfaces.

**Canonical backlog:** [`my-docs/evidence/security-audit/security-findings-ledger.md`](evidence/security-audit/security-findings-ledger.md)

When a finding is fixed:

1. Update its status in the findings ledger and link before/after probe run IDs or tests.
2. Move a short summary into **Verified fixes** above (same pattern as file upload / WebSocket hardening).
3. Add regression probes under `scripts/security-probe/probes/` where applicable (see ledger *Probe extensions needed* section).
