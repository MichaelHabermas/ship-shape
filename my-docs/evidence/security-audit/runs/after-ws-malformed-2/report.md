# Category 8 Security Probe after-ws-malformed-2

- API URL: http://localhost:3000
- Web URL: http://localhost:5173
- Mode: local-active
- Attack surfaces measured: 1/4
- Findings: 1

## Findings

### HIGH: Malformed WebSocket message was not handled safely
- ID: cat8-ws-malformed-frame
- Probe: websocket-malformed-frame
- Expected: Malformed binary messages are rejected or dropped and /health remains available.
- Observed: WebSocket result {"upgraded":true,"closeCode":null,"dataAfterPayload":true}, health HTTP 200.
- Fix candidate: Wrap collaboration message decoding in try/catch and close with a protocol/policy code.
- Reproduction:
  - Run pnpm security:probe -- --probe websocket-malformed-frame

## Probe Results

- websocket-malformed-frame: failed
