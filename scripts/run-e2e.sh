#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
USING_DEFAULT_RESULTS_DIR=false
if [ -z "${E2E_RESULTS_DIR:-}" ]; then
  USING_DEFAULT_RESULTS_DIR=true
fi
RESULTS_DIR="${E2E_RESULTS_DIR:-test-results}"
if [[ "${RESULTS_DIR}" != /* ]]; then
  RESULTS_DIR="${ROOT_DIR}/${RESULTS_DIR}"
fi
export E2E_RESULTS_DIR="${RESULTS_DIR}"
RUN_LOG="${RESULTS_DIR}/e2e-run.log"
PLAYWRIGHT_OUTPUT_DIR="${RESULTS_DIR}/playwright"
RUN_ID="$(date +%Y%m%d-%H%M%S)-$$"
PLAYWRIGHT_ARGS=()
has_output_arg=false
for arg in "$@"; do
  if [ "${arg}" != "--" ]; then
    PLAYWRIGHT_ARGS+=("${arg}")
    if [ "${arg}" = "--output" ] || [[ "${arg}" == --output=* ]]; then
      has_output_arg=true
    fi
  fi
done

if [ "${has_output_arg}" = false ]; then
  PLAYWRIGHT_ARGS+=("--output" "${PLAYWRIGHT_OUTPUT_DIR}")
fi

cd "${ROOT_DIR}"

requires_docker=true
for arg in "${PLAYWRIGHT_ARGS[@]}"; do
  if [ "${arg}" = "--list" ]; then
    requires_docker=false
    break
  fi
done

if [ "${requires_docker}" = true ]; then
  # shellcheck source=scripts/e2e-preflight.sh
  source "${ROOT_DIR}/scripts/e2e-preflight.sh"
  e2e_preflight
fi

mkdir -p "${RESULTS_DIR}"

LOCK_DIR="${RESULTS_DIR}/.run-lock"
if [ "${USING_DEFAULT_RESULTS_DIR}" = true ]; then
  if ! mkdir "${LOCK_DIR}" 2>/dev/null; then
    echo "Another E2E run appears to be using ${RESULTS_DIR}."
    echo "Set E2E_RESULTS_DIR to a unique path for concurrent lanes or shards."
    exit 1
  fi
fi

cleanup_lock() {
  if [ "${USING_DEFAULT_RESULTS_DIR}" = true ]; then
    rmdir "${LOCK_DIR}" 2>/dev/null || true
  fi
}

terminate_tree() {
  local parent="$1"
  local child
  while read -r child; do
    if [ -n "${child}" ]; then
      terminate_tree "${child}"
    fi
  done < <(pgrep -P "${parent}" 2>/dev/null || true)
  kill "${parent}" >/dev/null 2>&1 || true
}

abort_on_infra_failure() {
  local failed="$1"
  local passed="$2"
  if [ "${failed}" -lt 2 ] || [ "${passed}" -gt 0 ]; then
    return 1
  fi
  if [ ! -f "${RUN_LOG}" ]; then
    return 1
  fi
  local sample
  sample="$(
    grep -m1 -E "Executable doesn't exist|browserType\.launch:|Refusing to truncate non-test database|Docker is required" "${RUN_LOG}" 2>/dev/null || true
  )"
  if [ -z "${sample}" ]; then
    return 1
  fi
  echo ""
  echo "Aborting E2E: ${failed} failures, 0 passes — same infrastructure error in the log."
  echo "${sample}"
  echo "Fix the environment (see AGENTS.md E2E guidance), then rerun."
  terminate_tree "${pid}"
  cleanup_lock
  trap - INT TERM EXIT
  exit 1
}

mkdir -p "${RESULTS_DIR}/archive/${RUN_ID}"

for path in summary.json progress.jsonl codex-e2e-run.log e2e-run.log errors playwright; do
  if [ -e "${RESULTS_DIR}/${path}" ]; then
    mv "${RESULTS_DIR}/${path}" "${RESULTS_DIR}/archive/${RUN_ID}/"
  fi
done

echo "Starting Playwright E2E suite in the background..."
echo "Log: ${RUN_LOG}"
echo "Progress: ${RESULTS_DIR}/summary.json"

pnpm test:e2e:raw "${PLAYWRIGHT_ARGS[@]}" > "${RUN_LOG}" 2>&1 &
pid="$!"

cleanup() {
  if kill -0 "${pid}" >/dev/null 2>&1; then
    echo ""
    echo "Stopping Playwright run..."
    terminate_tree "${pid}"
    wait "${pid}" >/dev/null 2>&1 || true
  fi
  cleanup_lock
}
trap cleanup INT TERM EXIT

while kill -0 "${pid}" >/dev/null 2>&1; do
  E2E_RESULTS_DIR="${RESULTS_DIR}" "${ROOT_DIR}/scripts/watch-tests.sh" --once || true
  if [ -f "${RESULTS_DIR}/summary.json" ]; then
    read -r watch_failed watch_passed <<EOF
$(node "${ROOT_DIR}/scripts/lib/e2e-summary.mjs" counts "${RESULTS_DIR}/summary.json" 2>/dev/null || echo "0 0")
EOF
    abort_on_infra_failure "${watch_failed}" "${watch_passed}" || true
  fi
  sleep 5
done

set +e
wait "${pid}"
status="$?"
set -e

echo ""
E2E_RESULTS_DIR="${RESULTS_DIR}" "${ROOT_DIR}/scripts/watch-tests.sh" --once || true

summary_failed_count=0
if [ -f "${RESULTS_DIR}/summary.json" ]; then
  summary_failed_count="$(
    node "${ROOT_DIR}/scripts/lib/e2e-summary.mjs" failed "${RESULTS_DIR}/summary.json" 2>/dev/null || echo 0
  )"
fi

if [ "${status}" -ne 0 ] || [ "${summary_failed_count}" -gt 0 ]; then
  if [ -d "${RESULTS_DIR}/errors" ] && [ "$(find "${RESULTS_DIR}/errors" -maxdepth 1 -type f | head -n 1)" ]; then
    echo ""
    echo "Failure logs:"
    find "${RESULTS_DIR}/errors" -maxdepth 1 -type f -print
  fi
fi

echo ""
echo "Playwright exited with status ${status}."
exit "${status}"
