#!/bin/bash
#
# Watch test progress in real-time
#
# Reads ${E2E_RESULTS_DIR:-test-results}/summary.json and displays:
#   Passed: 45 | Failed: 3 | Pending: 72 | Last: 2s ago
#
# Usage:
#   ./scripts/watch-tests.sh           # Watch until all tests complete
#   ./scripts/watch-tests.sh --once    # Show current status and exit
#

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RESULTS_DIR="${E2E_RESULTS_DIR:-test-results}"
if [[ "${RESULTS_DIR}" != /* ]]; then
    RESULTS_DIR="${ROOT_DIR}/${RESULTS_DIR}"
fi
SUMMARY_FILE="${RESULTS_DIR}/summary.json"
ERRORS_DIR="${RESULTS_DIR}/errors"

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

show_status() {
    if [ ! -f "$SUMMARY_FILE" ]; then
        echo -e "${YELLOW}Waiting for tests to start...${NC}"
        return 1
    fi

    local summary_json
    summary_json=$(node "${ROOT_DIR}/scripts/lib/e2e-summary.mjs" status-line "$SUMMARY_FILE" 2>/dev/null) || {
        echo -e "${YELLOW}Waiting for valid test summary...${NC}"
        return 1
    }

    local total passed failed skipped pending ts_ms
    read -r total passed failed skipped pending ts_ms <<< "$summary_json"

    # Calculate time since last update (convert ms to seconds)
    local now_s=$(date +%s)
    local ts_s=$((ts_ms / 1000))
    local diff_s=$((now_s - ts_s))

    # Build status line
    local status_line=""
    status_line="${GREEN}Passed: ${passed}${NC}"

    if [ "$failed" -gt 0 ]; then
        status_line="${status_line} | ${RED}Failed: ${failed}${NC}"
    else
        status_line="${status_line} | Failed: ${failed}"
    fi

    if [ "$pending" -gt 0 ]; then
        status_line="${status_line} | ${YELLOW}Pending: ${pending}${NC}"
    else
        status_line="${status_line} | Pending: ${pending}"
    fi

    status_line="${status_line} | ${BLUE}Total: ${total}${NC}"
    status_line="${status_line} | Last update: ${diff_s}s ago"

    echo -e "$status_line"

    # Check if all tests are done
    local completed=$((passed + failed + skipped))
    if [ "$completed" -eq "$total" ] && [ "$total" -gt 0 ]; then
        return 0  # Done
    else
        return 1  # Still running
    fi
}

show_failures() {
    if [ -d "$ERRORS_DIR" ] && [ "$(ls -A "$ERRORS_DIR" 2>/dev/null)" ]; then
        echo ""
        echo -e "${RED}--- Failed Tests ---${NC}"
        for f in "$ERRORS_DIR"/*.log; do
            if [ -f "$f" ]; then
                echo -e "${RED}$(basename "$f" .log)${NC}"
            fi
        done
    fi
}

# Main
if [ "$1" = "--once" ]; then
    show_status
    exit $?
fi

# Clear screen and watch
echo "Watching test progress... (Ctrl+C to stop)"
echo ""

while true; do
    # Move cursor up and clear line for in-place update
    tput cuu1 2>/dev/null || true
    tput el 2>/dev/null || true

    if show_status; then
        echo ""
        echo -e "${GREEN}All tests completed!${NC}"
        show_failures
        exit 0
    fi

    sleep 1
done
