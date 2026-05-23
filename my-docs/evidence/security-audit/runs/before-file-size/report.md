# Category 8 Security Probe before-file-size

- API URL: http://localhost:3000
- Web URL: http://localhost:5173
- Mode: local-active
- Attack surfaces measured: 1/4
- Findings: 1

## Findings

### MEDIUM: Local file upload accepted bytes that did not match declared size
- ID: cat8-input-file-size-mismatch
- Probe: input-file-upload-size-mismatch
- Expected: Local upload rejects body length that differs from pending file size_bytes.
- Observed: Upload returned HTTP 200.
- Fix candidate: Compare received buffer length with file.size_bytes before writing local upload.
- Reproduction:
  - Create pending upload with sizeBytes 2048.
  - POST a much shorter body to /api/files/:id/local-upload.

## Probe Results

- input-file-upload-size-mismatch: failed
