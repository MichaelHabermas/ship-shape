#!/usr/bin/env bash
set -euo pipefail

cat >&2 <<'EOF'
Raw Playwright E2E runs are disabled because they can flood Codex output and hide failures.

Use:
  pnpm test:e2e:run

For direct Playwright access, use:
  pnpm test:e2e:raw -- <playwright args>
EOF

exit 1
