# Feature branch policy

## Durable branches vs temporary worktrees

| Kind | Examples | Policy |
| --- | --- | --- |
| **Feature branches** | `BASELINE`, `improvements-1`, `cat-3-closeout-and-dashboard`, `sec-probe-juicing-1` | Keep on **GitHub (`origin`)** and **GitLab (`gitlab`)**. Do not delete after merge without an explicit archive decision. |
| **Temporary worktrees / clones** | `../ship-shape-baseline-measurement`, `/tmp/ship-cat1-baseline-*`, Codex sandboxes | OK to remove after evidence is captured. These are not the source of truth for branch lists. |

## Remotes

| Remote | URL | Role |
| --- | --- | --- |
| `origin` | `git@github.com:MichaelHabermas/ship-shape.git` | Primary; full branch list for review and CI |
| `gitlab` | `ssh://git@labs.gauntletai.com:22022/michaelhabermas/ship-shape.git` | Gauntlet course mirror; should match `origin` feature branches |

`treasury` is fetch-only (upstream). Do not push submission work there.

## Sync local + mirrors

From repo root:

```bash
./scripts/sync-feature-branches.sh
```

This will:

1. `git fetch origin` and `git fetch gitlab` (no prune by default).
2. Create a local tracking branch for every `origin/*` branch you do not already have.
3. Recreate known deleted feature branches from recorded tips in `my-docs/evidence/branch-inventory.txt`.
4. Push any `origin` branch missing on `gitlab`.
5. Push restored branches back to `origin` and `gitlab` if they were deleted on the server.

Dry run:

```bash
DRY_RUN=1 ./scripts/sync-feature-branches.sh
```

Optional prune of stale remote-tracking refs (only after confirming branches were intentionally deleted on GitHub):

```bash
git fetch origin --prune
```

## Baseline branch names

| Name | Commit (recorded) | Use |
| --- | --- | --- |
| `BASELINE` | `072818c` | Category 8 security “before” probe / dependency audit |
| Audit snapshot (not always a branch) | `5731a92` | 2026-05-19 audit report; tag or `audit-baseline-2026-05-19` optional |

## Inventory

Branch lists and recovery SHAs: `my-docs/evidence/branch-inventory.txt` (regenerate with fetch + `gh api` when in doubt).
