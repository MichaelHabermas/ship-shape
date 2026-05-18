# Ship Worktree Preflight Checklist

Run this at the start of EVERY session on a worktree to ensure the dev environment is ready before making code changes.

## Trigger

- User starts working in a git worktree
- User mentions "worktree" or "preflight"
- Before any development work on a non-main worktree

## Checklist

Execute these steps in order:

```bash
# 1. Check PostgreSQL is running
pg_isready -h localhost || brew services restart postgresql@16

# 2. Install dependencies (worktrees don't share node_modules)
pnpm install

# 3. Build shared package (required for type-checking)
pnpm build:shared

# 4. Create database if it doesn't exist (dev.sh creates .env.local but NOT the DB)
source api/.env.local 2>/dev/null
DB_NAME=$(echo $DATABASE_URL | sed 's/.*\///')
createdb $DB_NAME 2>/dev/null || echo "Database exists"

# 5. Run migrations
pnpm db:migrate

# 6. Verify tests pass
pnpm test
```

## Common Issues

| Error | Fix |
|-------|-----|
| `pg_isready` fails | PostgreSQL not in PATH: `export PATH="/opt/homebrew/opt/postgresql@16/bin:$PATH"` |
| `Cannot find module @ship/shared` | Run `pnpm build:shared` first |
| `database "X" does not exist` | Run the `createdb` command above |
| vendor/@fpki missing | Create symlink: `mkdir -p vendor/@fpki && ln -sf /path/to/main/repo/vendor/@fpki/auth-client vendor/@fpki/auth-client` |

## Usage

```
/ship-worktree-preflight
```

Or manually run the checklist steps when starting work in a new worktree.
