#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RESULTS_DIR="${ROOT_DIR}/test-results"
RUN_LOG="${RESULTS_DIR}/e2e-run.log"
RUN_ID="$(date +%Y%m%d-%H%M%S)"

cd "${ROOT_DIR}"

if ! docker info >/dev/null 2>&1; then
  echo "Docker is required for Playwright E2E tests because Testcontainers starts PostgreSQL per worker."
  echo "Start Docker, then run this again."
  exit 1
fi

mkdir -p "${RESULTS_DIR}/archive/${RUN_ID}"

for path in summary.json progress.jsonl e2e-run.log codex-e2e-run.log errors; do
  if [ -e "${RESULTS_DIR}/${path}" ]; then
    mv "${RESULTS_DIR}/${path}" "${RESULTS_DIR}/archive/${RUN_ID}/"
  fi
done

echo "Starting Playwright E2E suite in the background..."
echo "Log: ${RUN_LOG}"
echo "Progress: ${RESULTS_DIR}/summary.json"

pnpm test:e2e "$@" > "${RUN_LOG}" 2>&1 &
pid="$!"

cleanup() {
  if kill -0 "${pid}" >/dev/null 2>&1; then
    echo ""
    echo "Stopping Playwright run..."
    kill "${pid}" >/dev/null 2>&1 || true
  fi
}
trap cleanup INT TERM

while kill -0 "${pid}" >/dev/null 2>&1; do
  "${ROOT_DIR}/scripts/watch-tests.sh" --once || true
  sleep 5
done

set +e
wait "${pid}"
status="$?"
set -e

echo ""
"${ROOT_DIR}/scripts/watch-tests.sh" --once || true

if [ -d "${RESULTS_DIR}/errors" ] && [ "$(find "${RESULTS_DIR}/errors" -type f | head -n 1)" ]; then
  echo ""
  echo "Failure logs:"
  find "${RESULTS_DIR}/errors" -type f -maxdepth 1 -print
fi

echo ""
echo "Playwright exited with status ${status}."
exit "${status}"
