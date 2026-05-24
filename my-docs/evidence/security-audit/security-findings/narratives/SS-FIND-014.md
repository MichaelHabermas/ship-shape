**Description**

`isAllowedFile` uses `filename.lastIndexOf('.')` — `malware.exe.txt` passes as `.txt`.

**Affected code**

- `api/src/routes/files.ts` (~L82–85)

**Mitigation in place**

Served as `Content-Disposition: attachment` + `X-Content-Type-Options: nosniff`.

**Recommended fix**

Scan all extensions or content-sniff; reject multi-extension executables.
