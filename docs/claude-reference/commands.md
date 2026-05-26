# Ship Commands Reference

Complete reference for all pnpm scripts and shell scripts in the Ship codebase.

## Development Commands

### `pnpm dev`
Runs both API and Web servers in parallel with automatic port selection.

**What it does:**
1. Creates `api/.env.local` with DATABASE_URL if missing
2. Creates database (e.g., `ship_auth_jan_6`) if it doesn't exist
3. Runs migrations and seeds on fresh databases
4. Finds available ports (API: 3000+, Web: 5173+) for multi-worktree development
5. Writes `.ports` file showing which ports are in use
6. Starts both servers in parallel

**Requires:** PostgreSQL running locally

### `pnpm dev:api`
Runs only the Express API server (via `tsx watch`).
- Default port: 3000
- Hot-reloading enabled

### `pnpm dev:web`
Runs only the Vite dev server for the React frontend.
- Default port: 5173
- Hot-reloading enabled

### `pnpm dev:shared`
Runs TypeScript compiler in watch mode for the shared package.
- Use when actively modifying shared types

### `pnpm dev:raw`
Runs all packages in parallel without the port-finding logic.
- Use only if `pnpm dev` has issues

---

## Build Commands

### `pnpm build`
Builds all packages recursively (shared, api, web).

### `pnpm build:shared`
Builds only the shared types package.
- **Must run first** before api or web builds
- Output: `shared/dist/`

### `pnpm build:api`
Builds shared types, then builds the API.
- Copies `schema.sql` and migrations to `api/dist/db/`
- Output: `api/dist/`

### `pnpm build:web`
Builds shared types, then builds the frontend.
- Sets `VITE_API_URL=` (empty for relative paths in production)
- Output: `web/dist/`

---

## Database Commands

### `pnpm db:migrate`
Runs database migrations.
- Applies `api/src/db/schema.sql` on fresh databases
- Runs numbered migrations from `api/src/db/migrations/`
- Tracks applied migrations in `schema_migrations` table

### `pnpm db:seed`
Seeds the database with test data.
- Idempotent: safe to run multiple times
- Script: `api/src/db/seed.ts`

### `pnpm fleetgraph:detector -- --workspace-id <uuid> [--today YYYY-MM-DD] [--limit N]`
Runs the deterministic FleetGraph detector manually without enabling the worker.
- Read-only: does not create findings, record runs, mutate Ship source records, or call a model
- Use against a migrated database; missing FleetGraph tables means migrations have not run
- `--workspace-id` must be a UUID; `--today` is parsed as a strict UTC calendar date for repeatable active-week checks

---

## Test Commands

### `pnpm test`
Runs API unit tests via Vitest.
- **Requires:** PostgreSQL running locally (uses `DATABASE_URL` from `api/.env.local`; not Testcontainers)

### `/e2e-test-runner` (preferred for E2E)
**Use this skill for E2E tests when available.** If unavailable, use `pnpm test:e2e:run`. Never run bare `pnpm test:e2e` (it exits with guidance).

Why: Direct Playwright runs can flood agent output. The skill or `pnpm test:e2e:run` handles:
- Background execution
- Progress polling via `test-results/summary.json`
- `--last-failed` flag for iterative fixing

### `pnpm test:e2e` (DO NOT USE DIRECTLY)
Prints guidance and exits. Use `/e2e-test-runner` or `pnpm test:e2e:run` instead.

### `pnpm test:e2e:ui`
Opens Playwright UI for interactive test debugging.

---

## Type Checking

### `pnpm type-check`
Runs TypeScript type checking across all packages.
- Does not emit files (`--noEmit`)
- Use to verify types before commits

### `pnpm lint`
Runs linting across all packages.

---

## Deployment Commands

### `./scripts/deploy.sh <dev|shadow|prod>`
Deploys the API to Elastic Beanstalk.

**Steps performed:**
1. Syncs Terraform config from SSM
2. Builds shared and api packages
3. Verifies SQL files are present
4. Tests Docker build locally (catches production-only issues)
5. Creates deployment bundle
6. Uploads to S3 and deploys to EB

**Usage:**
```bash
./scripts/deploy.sh dev     # Deploy to dev environment
./scripts/deploy.sh shadow  # Deploy to shadow (UAT)
./scripts/deploy.sh prod    # Deploy to production
```

### `./scripts/deploy-web.sh <dev|shadow|prod>`
Deploys the frontend to S3 + CloudFront.

**Steps performed:**
1. Syncs Terraform config from SSM
2. Builds the frontend
3. Syncs to S3 bucket
4. Invalidates CloudFront cache
5. Waits for invalidation to complete

**Usage:**
```bash
./scripts/deploy-web.sh dev     # Deploy frontend to dev
./scripts/deploy-web.sh shadow  # Deploy frontend to shadow
./scripts/deploy-web.sh prod    # Deploy frontend to production
```

### `./scripts/deploy-infrastructure.sh`
Deploys Terraform infrastructure (interactive).
- Requires manual confirmation before applying
- Creates VPC, Aurora, S3, CloudFront, Elastic Beanstalk resources

---

## Worktree Commands

### `pnpm worktree:init`
Initializes a git worktree for parallel development.

**What it does:**
1. Generates unique port offsets based on worktree path hash
2. Creates `api/.env.local` if missing (see `scripts/dev.sh`)
3. Creates worktree-specific database
4. Installs dependencies if needed
5. Builds shared package
6. Seeds database

---

## Database Management Scripts

### `./scripts/init-database.sh`
Initializes remote database (fetches credentials from SSM).
- Runs the migration runner against AWS Aurora
- Optionally seeds with test data

### `./scripts/copy-db-to-shadow.sh`
Copies dev database to shadow environment for UAT testing.

**Options:**
```bash
--skip-dump        # Skip dumping dev database
--skip-restore     # Skip restore step
--skip-migrations  # Skip running migrations
--use-dump FILE    # Use existing dump file
--verify-only      # Only verify data counts
```

### `./scripts/copy-db-via-ssm.sh`
Copies database between environments via SSM Session Manager.

---

## Infrastructure Scripts

### `./scripts/terraform.sh`
Wrapper for Terraform operations with environment selection.

### `./scripts/sync-terraform-config.sh`
Syncs Terraform configuration from SSM Parameter Store (source of truth).

### `./scripts/configure-caia.sh`
Configures CAIA OAuth credentials in AWS Secrets Manager.

---

## Utility Scripts

### `./scripts/check-empty-tests.sh`
Pre-commit hook that catches tests with only TODO comments.
- Tests with only comments pass silently (footgun)
- Use `test.fixme()` for unimplemented tests

### `./scripts/check-api-coverage.sh`
Checks API test coverage.

### `./scripts/watch-tests.sh`
Runs tests in watch mode.

---

## Clean Commands

### `pnpm clean`
Removes all build artifacts and node_modules across all packages.

---

## Quick Reference

| Task | Command |
|------|---------|
| Start development | `pnpm dev` |
| Run unit tests | `pnpm test` |
| Run E2E tests | `/e2e-test-runner` skill or `pnpm test:e2e:run` |
| Type check all | `pnpm type-check` |
| Build everything | `pnpm build` |
| Deploy API | `./scripts/deploy.sh <env>` |
| Deploy Frontend | `./scripts/deploy-web.sh <env>` |
| Seed database | `pnpm db:seed` |
| Run migrations | `pnpm db:migrate` |
| Init worktree | `pnpm worktree:init` |
