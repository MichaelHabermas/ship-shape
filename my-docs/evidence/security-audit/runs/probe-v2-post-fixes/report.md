# Security Probe probe-v2-post-fixes

- API URL: http://localhost:3001
- Web URL: http://localhost:5175
- Mode: local-active
- Attack surfaces measured: 5/5
- Findings: 0
- Triage: known-open=0, new=0, resolved=12, regression=0

## Finding triage

### Resolved since registry (probe passed)

- Member cannot PATCH plan_approval on sprint via documents API (SS-FIND-001)
- Member cannot set accountable_id to self on program (SS-FIND-002)
- Member cannot PATCH sprint/week status to completed (SS-FIND-003)
- Member cannot read peer weekly plan via documents API (SS-FIND-004)
- Member cannot open peer weekly plan collaboration room (SS-FIND-005)
- Cross-origin WebSocket upgrade rejected (SS-FIND-026)
- Member cannot complete another user pending upload (SS-FIND-025)
- Public feedback endpoint rate limited (SS-FIND-012)
- Bulk issue update rejects inaccessible target IDs (SS-FIND-007)
- Dashboard my-focus does not leak private project metadata (SS-FIND-010)
- File serve respects parent document visibility (SS-FIND-008)
- Governance fields rejected on generic PATCH (input surface) (SS-FIND-001)

## Findings

No security findings were confirmed by this run.

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
- manual-rate-limits: passed
- manual-verbose-errors: passed
- abuse-login-rate-limit: passed
- abuse-public-feedback-rate-limit: passed
