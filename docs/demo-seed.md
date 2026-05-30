# Demo Seed

Use this when you need a stable workspace for local, dev, shadow, or deployed verification.

## FleetGraph Demo World

Run:

```bash
pnpm demo:seed
```

This attaches the stable reviewer to the loaded app workspace (`Ship Workspace`) when it exists, then adds or refreshes FleetGraph blocker/control records in that same workspace. If no loaded app workspace exists, it falls back to creating `FleetGraph Demo Workspace`.

- stable login: `fleetgraph.reviewer@ship.local` / `admin123`
- FleetGraph reviewer, engineer, PM, program lead, and dependency-owner users
- person, program, project, active week, inactive week, dependency note, and issue documents
- blocked issue attention sources with and without blocker evidence
- negative-control issues for unblocked, done, duplicate, private-source, stale, and at-risk policy cases
- one duplicate-control FleetGraph finding
- reviewer URLs and detector summary output

The seeder is idempotent: rerunning it refreshes the same demo records and resets the reviewer password to `admin123`; it is not wired into app startup or login.

Render deploys run migrations only. Seed or repair deployed demo data explicitly:

```bash
DATABASE_URL="postgresql://..." \
FLEETGRAPH_DEMO_ALLOW_NONLOCAL_DB=1 \
FLEETGRAPH_DEMO_PASSWORD="..." \
pnpm demo:seed
```

Use this after deploys or database resets for intentional demo environments. Do not add the generic database seed back to the Render build.

## Non-Local Databases

The command refuses non-local databases unless you opt in:

```bash
DATABASE_URL="postgresql://..." \
FLEETGRAPH_DEMO_ALLOW_NONLOCAL_DB=1 \
pnpm demo:seed
```

Use the opt-in only for an intentional demo/dev/shadow/deployed database. Do not run it against customer data.
