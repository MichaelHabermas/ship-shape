# Security Probe cat8-2026-06-01T02-20-34-693Z

- API URL: http://localhost:3000
- Web URL: http://localhost:5173
- Mode: local-active
- Attack surfaces measured: 5/5
- Findings: 1
- Triage: known-open=0, new=1, resolved=0, regression=0

## Finding triage

### New this run (not in registry)

- Expected API or WebSocket rate-limit marker was absent (cat8-manual-rate-limit-gap)

## Findings

### MEDIUM: Expected API or WebSocket rate-limit marker was absent
- ID: cat8-manual-rate-limit-gap
- Probe: manual-rate-limits
- Expected: API, login, WebSocket connection, and WebSocket message limiters are present.
- Observed: {"apiLimiter":true,"loginLimiter":true,"websocketConnectionLimiter":false,"websocketMessageLimiter":false}
- Reproduction:
  - Run pnpm security:probe -- --probe manual-rate-limits

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
- dependency-pnpm-audit: passed
- manual-cors-csp: passed
- manual-secrets: passed
- manual-rate-limits: failed
- manual-verbose-errors: passed
- abuse-login-rate-limit: passed
- abuse-public-feedback-rate-limit: passed
