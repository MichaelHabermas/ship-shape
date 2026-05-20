#!/bin/bash
# Push the current branch (or a named branch) to GitHub (origin) and GitLab (gitlab).
#
# Usage:
#   ./scripts/push-all-remotes.sh              # push current branch
#   ./scripts/push-all-remotes.sh feat/foo     # push named branch
#   ./scripts/push-all-remotes.sh --tags       # push current branch + all tags
#   ./scripts/push-all-remotes.sh feat/foo --tags
#
# Remotes:
#   origin  → git@github.com:MichaelHabermas/ship-shape.git
#   gitlab  → ssh://git@labs.gauntletai.com:22022/michaelhabermas/ship-shape.git

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$ROOT_DIR"

REMOTES=(origin gitlab)
PUSH_TAGS=false
BRANCH=""

for arg in "$@"; do
  case "$arg" in
    --tags)
      PUSH_TAGS=true
      ;;
    -h|--help)
      sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    -*)
      echo "Unknown option: $arg" >&2
      exit 1
      ;;
    *)
      if [ -n "$BRANCH" ]; then
        echo "Unexpected extra argument: $arg" >&2
        exit 1
      fi
      BRANCH="$arg"
      ;;
  esac
done

if [ -z "$BRANCH" ]; then
  BRANCH="$(git branch --show-current)"
fi

if [ -z "$BRANCH" ]; then
  echo "Not on a branch (detached HEAD). Pass a branch name." >&2
  exit 1
fi

for remote in "${REMOTES[@]}"; do
  if ! git remote get-url "$remote" &>/dev/null; then
    echo "Missing remote: $remote" >&2
    exit 1
  fi
done

echo "Pushing branch '$BRANCH' to ${REMOTES[*]}..."
for remote in "${REMOTES[@]}"; do
  echo "→ $remote"
  git push -u "$remote" "$BRANCH"
done

if [ "$PUSH_TAGS" = true ]; then
  echo "Pushing tags to ${REMOTES[*]}..."
  for remote in "${REMOTES[@]}"; do
    echo "→ $remote (tags)"
    git push "$remote" --tags
  done
fi

echo "Done."
