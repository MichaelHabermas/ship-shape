# Evidence Run codex-integration-check

- Phase: integration
- Started: 2026-05-20T22:02:57.346Z
- Completed: 2026-05-20T22:02:58.001Z
- Collectors: 4 passed, 0 failed, 0 not measured
- Failed claims: 1

## Collector Results

- repo-metadata: passed - Captured 3 workspace packages and 15 top-level docs.
- openapi-validation: passed - Validated api/openapi.json with 84 paths.
- bundle-stats: passed - Measured 334 built files totaling 3441306 bytes.
- optional-artifacts: passed - Captured 1 optional artifact(s); 1 prerequisite(s) missing.

## Failed Claims

- openapi.prettier.json (openapi-validation): api/openapi.json prettier check is not clean.

## Files

- manifest.json
- environment.json
- git-status.txt
- claims.json
- collectors/*.json
