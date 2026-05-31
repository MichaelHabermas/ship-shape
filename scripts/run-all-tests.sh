#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RESULTS_DIR="${TEST_ALL_RESULTS_DIR:-test-results/test-all}"
if [[ "${RESULTS_DIR}" != /* ]]; then
  RESULTS_DIR="${ROOT_DIR}/${RESULTS_DIR}"
fi
mkdir -p "${RESULTS_DIR}"

status=0
declare -a RESULTS=()

run_step() {
  local name="$1"
  shift
  local log="${RESULTS_DIR}/${name}.log"

  echo ""
  echo "== ${name} =="
  if "$@" >"${log}" 2>&1; then
    echo "PASS ${name}"
    RESULTS+=("PASS ${name}")
  else
    echo "FAIL ${name}"
    echo "Log: ${log}"
    tail -80 "${log}" || true
    RESULTS+=("FAIL ${name}")
    status=1
  fi
}

cd "${ROOT_DIR}"

run_step type-check pnpm type-check
run_step lint pnpm lint
run_step build pnpm build
run_step api-tests pnpm test:api
run_step web-tests pnpm --filter @ship/web test
run_step security-tests pnpm --filter @ship/shipshape-security test
run_step submission-tests pnpm submission:test
run_step fleetgraph-proof-tests pnpm fleetgraph:proof:test
run_step e2e-shards pnpm test:e2e:shards --shards "${E2E_SHARDS:-4}" --workers "${PLAYWRIGHT_WORKERS:-2}"

echo ""
echo "== Summary =="
printf '%s\n' "${RESULTS[@]}"
echo "Logs: ${RESULTS_DIR}"

exit "${status}"
