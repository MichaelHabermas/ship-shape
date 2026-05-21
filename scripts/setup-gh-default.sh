#!/bin/bash
# Pin GitHub CLI to this fork (origin), not the Treasury upstream fork.
#
# Without this, `gh pr create` and similar commands may target
# US-Department-of-the-Treasury/ship when an `upstream` remote exists.
#
# Usage: ./scripts/setup-gh-default.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$ROOT_DIR"

if ! command -v gh >/dev/null 2>&1; then
  echo "gh is not installed. Install GitHub CLI first." >&2
  exit 1
fi

if git remote get-url upstream &>/dev/null 2>&1; then
  echo "Renaming remote upstream → treasury (fetch-only reference fork)..."
  git remote rename upstream treasury
fi

if git remote get-url treasury &>/dev/null 2>&1; then
  git remote set-url --push treasury no_push 2>/dev/null \
    || git config remote.treasury.pushurl no_push
fi

if ! git remote get-url origin &>/dev/null 2>&1; then
  echo "Missing git remote: origin" >&2
  exit 1
fi

gh repo set-default origin
echo "GitHub CLI default repo: $(gh repo set-default --view)"
