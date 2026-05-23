# Category 8 Security Probe before-file-headers

- API URL: http://localhost:3000
- Web URL: http://localhost:5173
- Mode: local-active
- Attack surfaces measured: 1/4
- Findings: 1

## Findings

### MEDIUM: Uploaded HTML was served inline without nosniff protection
- ID: cat8-input-file-serve-headers
- Probe: input-file-serve-headers
- Expected: User uploads are served as attachments with X-Content-Type-Options: nosniff.
- Observed: Content-Disposition=inline; filename="_security-probe_before-file-headers_-probe.html", X-Content-Type-Options=nosniff.
- Fix candidate: Serve local uploads as attachments, sanitize filenames, and set X-Content-Type-Options: nosniff.
- Reproduction:
  - Upload text/html content through local file upload.
  - GET /api/files/:id/serve and inspect response headers.

## Probe Results

- input-file-serve-headers: failed
