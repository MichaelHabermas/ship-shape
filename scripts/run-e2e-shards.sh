#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SHARDS="${E2E_SHARDS:-4}"
WORKERS="${PLAYWRIGHT_WORKERS:-2}"
BASE_RESULTS_DIR="${E2E_RESULTS_DIR:-test-results/e2e-shards}"
BUILD_ID="${E2E_BUILD_ID:-e2e-shards-$(date +%Y%m%d-%H%M%S)-$$}"
WORKTREE_ROOT=""
BALANCED=false
PLAYWRIGHT_ARGS=()

usage() {
  cat <<'EOF'
Usage: scripts/run-e2e-shards.sh [options] [-- Playwright args...]

Runs Playwright E2E shards in parallel with separate result directories.

Options:
  --shards N           Number of shards to run. Default: E2E_SHARDS or 4.
  --workers N          Playwright workers per shard. Default: PLAYWRIGHT_WORKERS or 2.
  --worktree-root DIR  Create detached git worktrees under DIR and run one shard per worktree.
  --balanced           Balance shards by spec size and fixed-wait budget instead of Playwright's test-level sharding.
  -h, --help           Show this help.

Examples:
  pnpm test:e2e:shards
  pnpm test:e2e:shards -- --grep "@smoke"
  pnpm test:e2e:shards -- --project=chromium
  pnpm test:e2e:shards -- --list
  pnpm test:e2e:shards --balanced
  pnpm test:e2e:shards --worktree-root ../ship-shape-e2e-shards
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --shards)
      SHARDS="${2:?Missing value for --shards}"
      shift 2
      ;;
    --workers)
      WORKERS="${2:?Missing value for --workers}"
      shift 2
      ;;
    --worktree-root)
      WORKTREE_ROOT="${2:?Missing value for --worktree-root}"
      shift 2
      ;;
    --balanced)
      BALANCED=true
      shift
      ;;
    --)
      shift
      PLAYWRIGHT_ARGS+=("$@")
      break
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      PLAYWRIGHT_ARGS+=("$1")
      shift
      ;;
  esac
done

if ! [[ "${SHARDS}" =~ ^[1-9][0-9]*$ ]]; then
  echo "Invalid shard count: ${SHARDS}" >&2
  exit 2
fi

if ! [[ "${WORKERS}" =~ ^[1-9][0-9]*$ ]]; then
  echo "Invalid worker count: ${WORKERS}" >&2
  exit 2
fi

if [[ "${BASE_RESULTS_DIR}" != /* ]]; then
  BASE_RESULTS_DIR="${ROOT_DIR}/${BASE_RESULTS_DIR}"
fi

mkdir -p "${BASE_RESULTS_DIR}"

declare -a PIDS=()
declare -a LABELS=()

terminate_runs() {
  local pid
  for pid in "${PIDS[@]:-}"; do
    if kill -0 "${pid}" >/dev/null 2>&1; then
      kill "${pid}" >/dev/null 2>&1 || true
    fi
  done
}

trap terminate_runs INT TERM

prepare_worktree() {
  local shard="$1"
  local target="$2"

  if [ -e "${target}" ]; then
    echo "Worktree path already exists: ${target}" >&2
    echo "Choose an empty --worktree-root or remove stale worktrees yourself." >&2
    exit 2
  fi

  git -C "${ROOT_DIR}" worktree add --detach "${target}" HEAD
  (
    cd "${target}"
    if [ ! -d node_modules ]; then
      pnpm install
    fi
  )

  echo "Prepared worktree for shard ${shard}: ${target}"
}

run_shard() {
  local shard="$1"
  local cwd="$2"
  local results_dir="$3"
  local command=("${cwd}/scripts/run-e2e.sh")

  if [ "${BALANCED}" = true ]; then
    local shard_specs=()
    while IFS= read -r spec; do
      if [ -n "${spec}" ]; then
        shard_specs+=("${spec}")
      fi
    done < <(node "${cwd}/scripts/e2e-balance-shards.mjs" --shards "${SHARDS}" --bucket "${shard}")
    command+=("${shard_specs[@]}")
  else
    command+=("--shard=${shard}/${SHARDS}")
  fi

  if [ "${#PLAYWRIGHT_ARGS[@]}" -gt 0 ]; then
    command+=("${PLAYWRIGHT_ARGS[@]}")
  fi

  (
    cd "${cwd}"
    E2E_RESULTS_DIR="${results_dir}" \
      E2E_BUILD_ID="${BUILD_ID}" \
      E2E_SHARD_INDEX="${shard}" \
      E2E_SHARD_TOTAL="${SHARDS}" \
      PLAYWRIGHT_WORKERS="${WORKERS}" \
      "${command[@]}"
  ) &

  PIDS+=("$!")
  LABELS+=("shard ${shard}/${SHARDS}")
}

echo "Starting ${SHARDS} E2E shard(s), ${WORKERS} worker(s) per shard."
echo "Results: ${BASE_RESULTS_DIR}"
if [ "${BALANCED}" = true ]; then
  echo "Shard mode: balanced spec buckets"
else
  echo "Shard mode: Playwright test-level shards"
fi

for shard in $(seq 1 "${SHARDS}"); do
  shard_results="${BASE_RESULTS_DIR}/shard-${shard}"

  if [ -n "${WORKTREE_ROOT}" ]; then
    if [[ "${WORKTREE_ROOT}" != /* ]]; then
      WORKTREE_ROOT="${ROOT_DIR}/${WORKTREE_ROOT}"
    fi
    shard_cwd="${WORKTREE_ROOT}/shard-${shard}"
    prepare_worktree "${shard}" "${shard_cwd}"
  else
    shard_cwd="${ROOT_DIR}"
  fi

  run_shard "${shard}" "${shard_cwd}" "${shard_results}"
done

status=0
for i in "${!PIDS[@]}"; do
  pid="${PIDS[$i]}"
  label="${LABELS[$i]}"
  if wait "${pid}"; then
    echo "${label} passed."
  else
    echo "${label} failed."
    status=1
  fi
done

trap - INT TERM

if [ "${status}" -ne 0 ]; then
  echo ""
  echo "One or more shards failed. Inspect logs under ${BASE_RESULTS_DIR}/shard-*/e2e-run.log."
fi

exit "${status}"
