# Security Probe probe-v2-baseline-unfixed

- API URL: http://localhost:3001
- Web URL: http://localhost:5175
- Mode: local-active
- Attack surfaces measured: 5/5
- Findings: 10
- Triage: known-open=10, new=0, resolved=2, regression=0

## Finding triage

### Still open (known registry)

- Member forged plan_approval via documents PATCH (SS-FIND-001)
- Member self-assigned accountable_id on program (SS-FIND-002)
- Member bypassed week lifecycle via status PATCH (SS-FIND-003)
- Member accessed peer weekly plan via documents API (SS-FIND-004)
- Member joined peer weekly plan collaboration room (SS-FIND-005)
- Cross-origin WebSocket upgrade was accepted (SS-FIND-026)
- Member completed another user pending upload (SS-FIND-025)
- Member served file without parent document access (SS-FIND-008)
- Governance fields accepted via generic PATCH (SS-FIND-001)
- Public feedback endpoint lacks burst rate limiting (SS-FIND-012)

### Resolved since registry (probe passed)

- Bulk issue update rejects inaccessible target IDs (SS-FIND-007)
- Dashboard my-focus does not leak private project metadata (SS-FIND-010)

## Findings

### CRITICAL: Member forged plan_approval via documents PATCH
- ID: probe-governance-properties-injection
- Probe: authorization-governance-properties-injection
- Ledger: SS-FIND-001
- OWASP: A01
- Expected: PATCH /api/documents/:sprintId with plan_approval returns 400 or 403.
- Observed: Received HTTP 200.
- Fix candidate: Denylist governance keys on generic document PATCH merge paths.
- Reproduction:
  - pnpm security:probe -- --probe authorization-governance-properties-injection

### CRITICAL: Member self-assigned accountable_id on program
- ID: probe-governance-accountable-self-assign
- Probe: authorization-governance-accountable-self-assign
- Ledger: SS-FIND-002
- OWASP: A01
- Expected: Member PATCH accountable_id to self returns 403.
- Observed: Received HTTP 200.
- Fix candidate: Admin-gate RACI field mutations on programs and documents.
- Reproduction:
  - pnpm security:probe -- --probe authorization-governance-accountable-self-assign

### CRITICAL: Member bypassed week lifecycle via status PATCH
- ID: probe-governance-week-status-bypass
- Probe: authorization-governance-week-status-bypass
- Ledger: SS-FIND-003
- OWASP: A01
- Expected: Member PATCH sprint status to completed returns 403.
- Observed: Received HTTP 200.
- Fix candidate: Remove ungoverned status from generic PATCH; enforce lifecycle routes only.
- Reproduction:
  - pnpm security:probe -- --probe authorization-governance-week-status-bypass

### HIGH: Member accessed peer weekly plan via documents API
- ID: probe-weekly-plan-idor-documents
- Probe: authorization-weekly-plan-idor-documents
- Ledger: SS-FIND-004
- OWASP: A01
- Expected: Member GET/PATCH on another user weekly plan returns 403 or 404.
- Observed: GET HTTP 200, PATCH HTTP 200.
- Fix candidate: Enforce person ownership on weekly_plan via generic documents REST.
- Reproduction:
  - pnpm security:probe -- --probe authorization-weekly-plan-idor-documents

### HIGH: Member joined peer weekly plan collaboration room
- ID: probe-weekly-plan-idor-websocket
- Probe: authorization-weekly-plan-idor-websocket
- Ledger: SS-FIND-005
- OWASP: A01
- Expected: WebSocket upgrade to peer weekly_plan room returns 403.
- Observed: Upgrade result: {"upgraded":true,"closeCode":null,"dataAfterPayload":true,"status":101}
- Fix candidate: Apply person ownership checks in canAccessDocumentForCollab for weekly_plan.
- Reproduction:
  - pnpm security:probe -- --probe authorization-weekly-plan-idor-websocket

### HIGH: Cross-origin WebSocket upgrade was accepted
- ID: probe-websocket-origin-reject
- Probe: authorization-websocket-origin-reject
- Ledger: SS-FIND-026
- OWASP: A01
- Expected: WebSocket upgrade with attacker Origin and valid session returns 403.
- Observed: Upgrade result: {"upgraded":true,"closeCode":null,"dataAfterPayload":true,"status":101}
- Fix candidate: Validate Origin header on collaboration and events WebSocket upgrades.
- Reproduction:
  - pnpm security:probe -- --probe authorization-websocket-origin-reject

### HIGH: Member completed another user pending upload
- ID: probe-file-upload-hijack-denied
- Probe: authorization-file-upload-hijack-denied
- Ledger: SS-FIND-025
- OWASP: A01
- Expected: local-upload for pending file owned by another user returns 403.
- Observed: Received HTTP 200.
- Fix candidate: Require uploaded_by matches session user on complete/upload paths.
- Reproduction:
  - pnpm security:probe -- --probe authorization-file-upload-hijack-denied

### MEDIUM: Member served file without parent document access
- ID: probe-file-document-scope
- Probe: authorization-file-document-scope
- Ledger: SS-FIND-008
- OWASP: A01
- Expected: Member without private document access cannot GET /api/files/:id/serve.
- Observed: Serve returned HTTP 200.
- Fix candidate: Enforce document visibility when serving workspace files.
- Reproduction:
  - pnpm security:probe -- --probe authorization-file-document-scope

### CRITICAL: Governance fields accepted via generic PATCH
- ID: probe-governance-mass-assignment
- Probe: input-governance-mass-assignment
- Ledger: SS-FIND-001
- OWASP: A01
- Expected: Member PATCH with review_approval/submitted_at returns 400 or 403.
- Observed: Received HTTP 200.
- Reproduction:
  - pnpm security:probe -- --probe input-governance-mass-assignment

### MEDIUM: Public feedback endpoint lacks burst rate limiting
- ID: probe-public-feedback-rate-limit
- Probe: abuse-public-feedback-rate-limit
- Ledger: SS-FIND-012
- Expected: After 20 submissions, public feedback returns 429.
- Observed: Last status HTTP 201, no 429 observed.
- Reproduction:
  - pnpm security:probe -- --probe abuse-public-feedback-rate-limit

## Probe Results

- auth-session-unauthenticated-api: passed
- auth-session-invalid-bearer: passed
- auth-session-cookie-flags: passed
- auth-session-cookie-shape-expiry: passed
- auth-session-csrf-mutating-request: passed
- auth-session-api-token-super-admin-boundary: passed
- auth-session-member-audit-logs-denied: passed
- auth-session-member-impersonation-denied: passed
- authorization-governance-properties-injection: failed
- authorization-governance-accountable-self-assign: failed
- authorization-governance-week-status-bypass: failed
- authorization-weekly-plan-idor-documents: failed
- authorization-weekly-plan-idor-websocket: failed
- authorization-websocket-origin-reject: failed
- authorization-file-upload-hijack-denied: failed
- authorization-bulk-issue-foreign-target: passed
- authorization-dashboard-private-metadata: passed
- authorization-file-document-scope: failed
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
- input-governance-mass-assignment: failed
- dependency-pnpm-audit: passed
- manual-cors-csp: passed
- manual-secrets: passed
- manual-rate-limits: passed
- manual-verbose-errors: passed
- abuse-login-rate-limit: passed
- abuse-public-feedback-rate-limit: failed
