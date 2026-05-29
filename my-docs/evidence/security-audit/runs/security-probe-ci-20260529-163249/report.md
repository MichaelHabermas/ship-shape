# Security Probe security-probe-ci-20260529-163249

- API URL: http://127.0.0.1:3099
- Web URL: http://localhost:5199
- Mode: local-active
- Attack surfaces measured: 5/5
- Findings: 1
- Triage: known-open=0, new=1, resolved=0, regression=0

## Finding triage

### New this run (not in registry)

- High or critical dependency CVEs found (cat8-dependency-high-critical-cves)

## Findings

### HIGH: High or critical dependency CVEs found
- ID: cat8-dependency-high-critical-cves
- Probe: dependency-pnpm-audit
- Expected: No high/critical CVEs, or each is listed with reachability and feature mapping.
- Observed: 1 high/critical advisory item(s) parsed from pnpm audit.
- Fix candidate: Upgrade, override, remove, or document reachability for affected packages.
- Reproduction:
  - Run pnpm security:probe -- --probe dependency-pnpm-audit

## Probe Results

- auth-session-unauthenticated-api: passed
- auth-session-invalid-bearer: passed
- auth-session-cookie-flags: passed
- auth-session-cookie-shape-expiry: passed
- auth-session-csrf-mutating-request: passed
- auth-session-api-token-super-admin-boundary: passed
- auth-session-member-audit-logs-denied: passed
- auth-session-member-impersonation-denied: passed
- authorization-governance-properties-injection: passed
- authorization-governance-accountable-self-assign: passed
- authorization-governance-week-status-bypass: passed
- authorization-weekly-plan-idor-documents: passed
- authorization-weekly-plan-idor-websocket: passed
- authorization-websocket-origin-reject: passed
- authorization-file-upload-hijack-denied: passed
- authorization-bulk-issue-foreign-target: passed
- authorization-dashboard-private-metadata: passed
- authorization-file-document-scope: passed
- websocket-no-cookie-denied: passed
- websocket-nonexistent-doc-denied: passed
- websocket-malformed-frame: passed
- websocket-unknown-message-type: passed
- websocket-oversized-frame: passed
- websocket-events-malformed-message: passed
- websocket-events-unknown-message-type: passed
- input-stored-xss-document-title: passed
- input-search-payloads: passed
- input-long-field-validation: passed
- input-issue-payloads: passed
- input-comment-payloads: passed
- input-file-upload-size-mismatch: passed
- input-file-serve-headers: passed
- input-governance-mass-assignment: passed
- dependency-pnpm-audit: failed
- manual-cors-csp: passed
- manual-secrets: passed
- manual-rate-limits: passed
- manual-verbose-errors: passed
- abuse-login-rate-limit: passed
- abuse-public-feedback-rate-limit: passed
