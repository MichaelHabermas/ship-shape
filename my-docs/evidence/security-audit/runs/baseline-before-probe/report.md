# Category 8 Security Probe baseline-before-probe

- API URL: http://localhost:3000
- Web URL: http://localhost:5173
- Mode: local-active
- Attack surfaces measured: 4/4
- Findings: 9

## Findings

### HIGH: Protected API route allowed unauthenticated access
- ID: cat8-auth-unauthenticated-api
- Probe: auth-session-unauthenticated-api
- Expected: Protected API routes return 401 without a session or bearer token.
- Observed: 1 protected route(s) did not return 401.
- Fix candidate: Ensure protected routes mount authMiddleware before handlers.
- Reproduction:
  - Run pnpm security:probe -- --probe auth-session-unauthenticated-api

### HIGH: API token could access a super-admin route
- ID: cat8-auth-api-token-super-admin
- Probe: auth-session-api-token-super-admin-boundary
- Expected: Bearer API tokens are denied from super-admin-only routes.
- Observed: Super-admin route returned HTTP 200 for a bearer token.
- Fix candidate: Reject req.isApiToken inside superAdminMiddleware unless scoped token support exists.
- Reproduction:
  - Log in as seeded admin.
  - Create an API token.
  - GET /api/admin/credentials/status with Authorization: Bearer <token>.

### MEDIUM: Local file upload accepted bytes that did not match declared size
- ID: cat8-input-file-size-mismatch
- Probe: input-file-upload-size-mismatch
- Expected: Local upload rejects body length that differs from pending file size_bytes.
- Observed: Upload returned HTTP 200.
- Fix candidate: Compare received buffer length with file.size_bytes before writing local upload.
- Reproduction:
  - Create pending upload with sizeBytes 2048.
  - POST a much shorter body to /api/files/:id/local-upload.

### MEDIUM: Uploaded HTML was served inline without nosniff protection
- ID: cat8-input-file-serve-headers
- Probe: input-file-serve-headers
- Expected: User uploads are served as attachments with X-Content-Type-Options: nosniff.
- Observed: Content-Disposition=inline; filename="_security-probe_baseline-input_-probe.html", X-Content-Type-Options=nosniff.
- Fix candidate: Serve local uploads as attachments, sanitize filenames, and set X-Content-Type-Options: nosniff.
- Reproduction:
  - Upload text/html content through local file upload.
  - GET /api/files/:id/serve and inspect response headers.

### CRITICAL: High or critical dependency CVEs found
- ID: cat8-dependency-high-critical-cves
- Probe: dependency-pnpm-audit
- Expected: No high/critical CVEs, or each is listed with reachability and feature mapping.
- Observed: 32 high/critical advisory item(s) parsed from pnpm audit.
- Fix candidate: Upgrade, override, remove, or document reachability for affected packages.
- Reproduction:
  - Run pnpm security:probe -- --probe dependency-pnpm-audit

### MEDIUM: Malformed request leaked verbose internals
- ID: cat8-manual-verbose-error-leakage
- Probe: manual-verbose-errors
- Expected: Malformed requests do not expose stack traces, SQL, filesystem paths, or secrets.
- Observed: Response matched verbose leakage pattern.
- Reproduction:
  - Run pnpm security:probe -- --probe manual-verbose-errors

### MEDIUM: Events WebSocket did not reject malformed message
- ID: cat8-ws-events-malformed-message
- Probe: websocket-events-malformed-message
- Expected: Malformed authenticated events messages close with 1003.
- Observed: WebSocket result {"upgraded":true,"closeCode":null,"dataAfterPayload":true,"status":101}.
- Reproduction:
  - Run pnpm security:probe -- --probe websocket-events-malformed-message

### MEDIUM: Events WebSocket did not reject unknown message type
- ID: cat8-ws-events-unknown-message-type
- Probe: websocket-events-unknown-message-type
- Expected: Unknown authenticated events messages close with 1003.
- Observed: WebSocket result {"upgraded":true,"closeCode":null,"dataAfterPayload":true,"status":101}.
- Reproduction:
  - Run pnpm security:probe -- --probe websocket-events-unknown-message-type

### HIGH: Malformed WebSocket message was not handled safely
- ID: cat8-ws-malformed-frame
- Probe: websocket-malformed-frame
- Expected: Malformed binary messages are rejected or dropped and /health remains available.
- Observed: WebSocket result {"upgraded":true,"closeCode":null,"dataAfterPayload":true}, health HTTP 200.
- Fix candidate: Wrap collaboration message decoding in try/catch and close with a protocol/policy code.
- Reproduction:
  - Run pnpm security:probe -- --probe websocket-malformed-frame

## Probe Results

- auth-session-unauthenticated-api: failed
- auth-session-invalid-bearer: passed
- auth-session-cookie-flags: passed
- auth-session-cookie-shape-expiry: passed
- auth-session-csrf-mutating-request: passed
- auth-session-api-token-super-admin-boundary: failed
- input-stored-xss-document-title: passed
- input-search-payloads: passed
- input-long-field-validation: passed
- input-issue-payloads: passed
- input-comment-payloads: passed
- input-file-upload-size-mismatch: failed
- input-file-serve-headers: failed
- dependency-pnpm-audit: failed
- manual-cors-csp: passed
- manual-secrets: passed
- manual-rate-limits: passed
- manual-verbose-errors: failed
- websocket-no-cookie-denied: passed
- websocket-nonexistent-doc-denied: passed
- websocket-events-malformed-message: failed
- websocket-events-unknown-message-type: failed
- websocket-malformed-frame: failed
