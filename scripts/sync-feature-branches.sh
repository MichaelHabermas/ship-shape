#!/usr/bin/env bash
# Sync durable feature branches: fetch remotes, create local tracking branches,
# restore known deleted tips from reflog inventory, mirror origin -> gitlab.
#
# Does NOT touch Codex/agent worktrees (../ship-shape-baseline-measurement, /tmp/*).
# Run from repo root: ./scripts/sync-feature-branches.sh
# Dry-run: DRY_RUN=1 ./scripts/sync-feature-branches.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
DRY_RUN="${DRY_RUN:-0}"

run() {
  if [ "$DRY_RUN" = "1" ]; then
    echo "[dry-run] $*"
  else
    "$@"
  fi
}

echo "==> Fetching origin and gitlab (no prune — use sync-feature-branches:prune to drop stale remote-tracking refs)"
run git fetch origin
run git fetch gitlab

echo "==> Local tracking branches for every origin branch"
while IFS= read -r ref; do
  branch="${ref#origin/}"
  [ "$branch" = "HEAD" ] && continue
  if git show-ref --verify --quiet "refs/heads/$branch"; then
    echo "  keep local $branch"
  else
    echo "  create local $branch -> origin/$branch"
    run git branch "$branch" "origin/$branch"
  fi
  if [ "$DRY_RUN" != "1" ]; then
    git branch --set-upstream-to="origin/$branch" "$branch" 2>/dev/null || true
  fi
done < <(git for-each-ref --format='%(refname:short)' refs/remotes/origin | rg -v '^origin/HEAD$' | sort)

echo "==> Restore deleted feature branches (tips from my-docs/evidence/branch-inventory.txt)"
# shellcheck disable=SC2016
restore_branches=(
  'audit-fail-open-paths:513d444ddab31cae89f905b707edec419576a3ee'
  'cat-1-fixes-nn-as:1bd50f751f71e7915512dea8a293eba0ba536c63'
  'cat-8-get-baselines:4c11bdc90644a38adc55a3b96be4d87d5503ac4e'
  'cat-8-init:e7208ed5f3d864fd47df89c69849330d7235dd70'
  'dashboard-updates-1:8f00d0279a2598380551aa893422775d9322beaf'
  'doc-and-script-sync-1:fe5df1152b3acfc068d5ac8118027ab71ddb0911'
  'easy-wins-to-fluff-the-numbers-1:8b297eeea684a8d09eb8a6b4f2e64f455484b8fe'
  'improve-arch-1:665acb7d18261df25e6d5e413558b48f9844738a'
  'openapi-typed-client:883cd81927929afa31d11bd8a73595cd66696159'
  'specs-polish-1:31095369a995ca70c47ca33180479c004d9b3ea2'
)

for entry in "${restore_branches[@]}"; do
  branch="${entry%%:*}"
  sha="${entry#*:}"
  if git show-ref --verify --quiet "refs/heads/$branch"; then
    echo "  skip restore $branch (local branch exists)"
    continue
  fi
  if ! git cat-file -e "$sha^{commit}" 2>/dev/null; then
    echo "  WARN: missing object for $branch ($sha) — fetch or recover before restore"
    continue
  fi
  echo "  restore $branch -> $sha"
  run git branch "$branch" "$sha"
done

echo "==> Push origin branches missing on gitlab"
while IFS= read -r branch; do
  [ "$branch" = "HEAD" ] && continue
  if git show-ref --verify --quiet "refs/remotes/gitlab/$branch"; then
    echo "  gitlab already has $branch"
  else
    echo "  push origin/$branch -> gitlab/$branch"
    run git push gitlab "origin/$branch:refs/heads/$branch"
  fi
done < <(git for-each-ref --format='%(refname:short)' refs/remotes/origin | sed 's|^origin/||' | rg -v '^HEAD$' | sort -u)

echo "==> Push restored / local-only branches to origin and gitlab (resurrect on GitHub)"
for entry in "${restore_branches[@]}"; do
  branch="${entry%%:*}"
  if ! git show-ref --verify --quiet "refs/heads/$branch"; then
    continue
  fi
  if ! git show-ref --verify --quiet "refs/remotes/origin/$branch"; then
    echo "  push local $branch -> origin"
    run git push origin "$branch:refs/heads/$branch"
  fi
  if ! git show-ref --verify --quiet "refs/remotes/gitlab/$branch"; then
    echo "  push local $branch -> gitlab"
    run git push gitlab "$branch:refs/heads/$branch"
  fi
done

echo "==> Done. Local branches:"
git branch -vv | sed 's/^/  /'
