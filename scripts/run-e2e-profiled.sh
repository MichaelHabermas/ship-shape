#!/usr/bin/env bash
# Runs Playwright E2E specs through resource-profiled normal, realtime, and isolated lanes.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BASE_RESULTS_DIR="${E2E_RESULTS_DIR:-test-results/e2e-profiled}"
if [[ "${BASE_RESULTS_DIR}" != /* ]]; then
  BASE_RESULTS_DIR="${ROOT_DIR}/${BASE_RESULTS_DIR}"
fi

RUN_E2E="${ROOT_DIR}/scripts/run-e2e.sh"

if [ "$#" -gt 0 ]; then
  E2E_RESULTS_DIR="${BASE_RESULTS_DIR}" "${RUN_E2E}" "$@"
  exit "$?"
fi

run_lane() {
  local lane="$1"
  local workers="$2"
  shift 2

  echo ""
  echo "== E2E lane: ${lane} (${workers} worker(s)) =="
  E2E_RESULTS_DIR="${BASE_RESULTS_DIR}/${lane}" PLAYWRIGHT_WORKERS="${workers}" "${RUN_E2E}" "$@"
}

lane_workers() {
  local lane_var="$1"
  local default_workers="$2"
  printf '%s' "${!lane_var:-${PLAYWRIGHT_WORKERS:-${default_workers}}}"
}

normal_specs=(
  e2e/accessibility-remediation.spec.ts
  e2e/accessibility.spec.ts
  e2e/accountability-banner-urgency.spec.ts
  e2e/accountability-owner-change.spec.ts
  e2e/accountability-standup.spec.ts
  e2e/accountability-week.spec.ts
  e2e/admin-workspace-members.spec.ts
  e2e/ai-analysis-api.spec.ts
  e2e/auth.spec.ts
  e2e/authorization.spec.ts
  e2e/backlinks.spec.ts
  e2e/check-aria.spec.ts
  e2e/context-menus.spec.ts
  e2e/critical-blockers.spec.ts
  e2e/debug-create.spec.ts
  e2e/docs-mode.spec.ts
  e2e/document-isolation.spec.ts
  e2e/document-workflows.spec.ts
  e2e/documents.spec.ts
  e2e/edge-cases.spec.ts
  e2e/error-handling.spec.ts
  e2e/existing-user-invite.spec.ts
  e2e/feedback-consolidation.spec.ts
  e2e/file-upload-api.spec.ts
  e2e/fleetgraph-attention-loop.spec.ts
  e2e/fleetgraph-chat.spec.ts
  e2e/icons.spec.ts
  e2e/issue-display-id.spec.ts
  e2e/issue-estimates.spec.ts
  e2e/issues-bulk-operations.spec.ts
  e2e/issues-inline-sprint.spec.ts
  e2e/issues.spec.ts
  e2e/manager-reviews.spec.ts
  e2e/pending-invites-allocation.spec.ts
  e2e/performance.spec.ts
  e2e/private-documents.spec.ts
  e2e/program-mode-week-ux.spec.ts
  e2e/programs.spec.ts
  e2e/project-weeks.spec.ts
  e2e/request-changes-api.spec.ts
  e2e/request-changes-ui.spec.ts
  e2e/search-api.spec.ts
  e2e/security.spec.ts
  e2e/spike-isolated.spec.ts
  e2e/status-colors-accessibility.spec.ts
  e2e/status-overview-heatmap.spec.ts
  e2e/team-mode.spec.ts
  e2e/tooltips.spec.ts
  e2e/weekly-accountability.spec.ts
  e2e/weeks.spec.ts
  e2e/workspaces.spec.ts
)

realtime_specs=(
  e2e/content-caching.spec.ts
  e2e/data-integrity.spec.ts
  e2e/drag-handle.spec.ts
  e2e/emoji.spec.ts
  e2e/features-real.spec.ts
  e2e/file-attachments.spec.ts
  e2e/images.spec.ts
  e2e/inline-code.spec.ts
  e2e/inline-comments.spec.ts
  e2e/mentions.spec.ts
  e2e/my-week-stale-data.spec.ts
  e2e/race-conditions.spec.ts
  e2e/real-integration.spec.ts
  e2e/syntax-highlighting.spec.ts
  e2e/tables.spec.ts
  e2e/toc.spec.ts
  e2e/toggle.spec.ts
)

isolated_specs=(
  e2e/autosave-race-conditions.spec.ts
  e2e/bulk-selection.spec.ts
  e2e/changes-requested-notifications.spec.ts
  e2e/manager-reviews-visual.spec.ts
  e2e/session-timeout.spec.ts
  e2e/wiki-document-properties.spec.ts
)

discovered_specs=()
while IFS= read -r spec; do
  discovered_specs+=("${spec}")
done < <(cd "${ROOT_DIR}" && find e2e -name "*.spec.ts" | sort)

classified_specs=("${normal_specs[@]}" "${realtime_specs[@]}" "${isolated_specs[@]}")
missing_specs=()
while IFS= read -r spec; do
  missing_specs+=("${spec}")
done < <(
  printf '%s\n' "${discovered_specs[@]}" "${classified_specs[@]}" |
    sort |
    uniq -u |
    sed '/^$/d'
)

if [ "${#missing_specs[@]}" -gt 0 ]; then
  echo "E2E profile classification is out of date. Classify these specs in scripts/run-e2e-profiled.sh:"
  printf '  %s\n' "${missing_specs[@]}"
  exit 1
fi

mkdir -p "${BASE_RESULTS_DIR}"

status=0
run_lane normal "$(lane_workers PLAYWRIGHT_NORMAL_WORKERS 4)" "${normal_specs[@]}" || status=1
run_lane realtime "$(lane_workers PLAYWRIGHT_REALTIME_WORKERS 1)" "${realtime_specs[@]}" || status=1
run_lane isolated "$(lane_workers PLAYWRIGHT_ISOLATED_WORKERS 1)" "${isolated_specs[@]}" || status=1

if [ "${status}" -ne 0 ]; then
  echo ""
  echo "One or more E2E lanes failed. Results are under ${BASE_RESULTS_DIR}."
fi

exit "${status}"
