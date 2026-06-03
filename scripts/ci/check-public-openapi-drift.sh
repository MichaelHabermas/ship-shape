#!/usr/bin/env bash
# Public OpenAPI drift check fails when generation changes the checked-out artifact.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "${ROOT_DIR}"

before="$(mktemp)"
trap 'rm -f "${before}"' EXIT

cp docs/openapi.json "${before}"
pnpm --filter @ship/api public-openapi:generate >/dev/null

if ! cmp -s "${before}" docs/openapi.json; then
  echo "Public OpenAPI drift detected. Run pnpm --filter @ship/api public-openapi:generate and include docs/openapi.json."
  diff -u "${before}" docs/openapi.json || true
  exit 1
fi

node ./scripts/ci/validate-public-openapi.mjs
