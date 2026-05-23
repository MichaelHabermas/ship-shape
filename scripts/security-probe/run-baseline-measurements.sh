#!/usr/bin/env bash
# Measure dependency CVEs: BASELINE branch (before) vs current master (after).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
CLONE="${BASELINE_CLONE:-$(dirname "$ROOT")/ship-shape-baseline-measurement}"
PNPM="${PNPM:-pnpm}"
NODE="${NODE:-node}"
PARSE="$ROOT/scripts/security-probe/parse-audit-json.mjs"
EVIDENCE="$ROOT/my-docs/evidence/security-audit/runs"

measure() {
  local dir="$1"
  local cwd="$2"
  mkdir -p "$dir"
  (cd "$cwd" && $PNPM audit --json > "$dir/pnpm-audit-all.json" 2>"$dir/pnpm-audit-all.stderr") || true
  $NODE "$PARSE" "$dir/pnpm-audit-all.json" > "$dir/summary.json"
}

# After = this repo
measure "$EVIDENCE/baseline-after" "$ROOT"

# Before = clone entire repo, checkout BASELINE, audit, remove clone
if [ -d "$CLONE" ]; then
  git -C "$ROOT" worktree remove --force "$CLONE" 2>/dev/null || rm -rf "$CLONE"
fi
git -C "$ROOT" worktree add "$CLONE" BASELINE
(cd "$CLONE" && $PNPM install --frozen-lockfile 2>/dev/null) || (cd "$CLONE" && $PNPM install)
measure "$EVIDENCE/baseline-before" "$CLONE"
git -C "$ROOT" worktree remove --force "$CLONE"

$NODE "$ROOT/scripts/security-probe/generate-baseline-report.mjs"
echo "Done. Before: runs/baseline-before/summary.json  After: runs/baseline-after/summary.json"
