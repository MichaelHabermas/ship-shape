# Category 8 Security Probe cat8-final

- API URL: http://localhost:3000
- Web URL: http://localhost:5173
- Mode: local-active
- Attack surfaces measured: 4/4
- Findings: 0

## Findings

No security findings were confirmed by this run.

## Probe Results

- auth-session-unauthenticated-api: passed
- auth-session-invalid-bearer: passed
- auth-session-cookie-flags: passed
- auth-session-cookie-shape-expiry: passed
- auth-session-csrf-mutating-request: passed
- auth-session-api-token-super-admin-boundary: passed
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
- dependency-pnpm-audit: passed
- manual-cors-csp: passed
- manual-secrets: passed
- manual-rate-limits: passed
- manual-verbose-errors: passed
