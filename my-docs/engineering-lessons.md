# Engineering Lessons

Portable engineering lessons learned while building projects in this repo.

Use this file for principles that should transfer to the next project, not for project-specific runbooks, status updates, or implementation notes. Write the general lesson first, then use a short anecdote from this repo only as evidence. A good entry should help a future human or agent avoid the same class of mistake in a different codebase.

Add a lesson here when a bug, incident, or hard-won fix reveals a reusable engineering rule. Do not add narrow facts like file paths, command names, service IDs, or temporary decisions unless they clarify the broader point.

## 1. Treat Durable Demo Data As Product Data, Not Deploy Debris

If demo, fixture, evaluation, or reviewer data must persist across deploys and background automation, make it first-class data with explicit ownership, metadata, idempotent creation, and repair semantics.

The failure mode is subtle: one part of the system creates data to prove behavior, while another part correctly treats that same data as stale, invalid, duplicated, or repairable. Both parts can be locally reasonable and still produce global data drift. The fix is not to disable the automation. The fix is to encode intent so automation can distinguish real production state from intentional fixtures.

The transferable rules:

- Do not seed important demo data as a generic deploy side effect.
- Give intentional fixtures stable IDs, names, or metadata that say who owns them and why they exist.
- Make fixture seeders idempotent and safe to rerun.
- Make repair/reconciliation jobs aware of fixture intent when the fixture is supposed to survive.
- Keep real user/customer data outside the repair blast radius.
- Test the fixture against the same worker, repair, cleanup, or reconciliation loop that runs in production.
- Verify local and deployed data with direct data checks after repair, not just successful command output.

ShipShape example: FleetGraph demo findings were originally seeded like ordinary data while the FleetGraph worker kept running its normal stale-finding cleanup. As deploys and worker ticks progressed, mixed blocked/stale/at-risk demo findings disappeared or collapsed because the worker had no way to know they were intentional reviewer fixtures. We fixed it by moving the demo data into a dedicated idempotent demo seeder, marking demo findings with explicit metadata, teaching cleanup to preserve open demo fixtures, and adding regression tests that run the worker after seeding.

## 2. Green Health Checks Do Not Prove The New Code Is Live

A healthy deployment only proves that something is serving traffic. It does not prove the latest artifact, route, migration, feature flag, worker, or frontend bundle is the thing currently serving users.

For any meaningful release, verify the changed behavior directly. Check a route that only exists in the new build, a response shape that only the new code can produce, a migration-dependent query, a UI path that exercises the new bundle, or a version marker tied to the shipped artifact. Treat generic health checks as infrastructure smoke, not product proof.

The transferable rules:

- Verify the exact behavior that changed, not only `/health`.
- Compare deployed artifact shape against local expectations when behavior is missing.
- Check deploy status, logs, and live route inventory when health and behavior disagree.
- Remember that many platforms keep serving the previous successful deploy after a failed update.
- Record the deploy proof in terms a future reviewer can re-run.

ShipShape example: the public API health check was green, but FleetGraph routes were missing. The real issue was that the newest API deploy had failed and Render kept serving the previous successful build. Route-specific verification exposed the truth: `/api/fleetgraph/...` returned Express 404, while the new build should have reached auth or validation.

## 3. Bootstrap Schemas And Migrations Are Different Tools

Bootstrap schema is for creating a new empty database. Migrations are for evolving an existing database. Mixing those jobs makes deployments fragile because an existing database may be between historical shapes that the bootstrap file no longer represents.

A bootstrap file can be useful as a snapshot, but it must not become an every-deploy migration runner for production-like databases. Existing databases should move through ordered, repeatable migrations that encode each evolution step.

The transferable rules:

- Run bootstrap DDL only when creating an empty database.
- Run numbered migrations for existing databases.
- Do not assume the latest schema snapshot can safely apply to every historical database shape.
- Make the migration runner decide whether the database is empty before applying bootstrap.
- Test migration behavior against an existing database, not only a fresh one.

ShipShape example: a deploy failed because the migrator applied the bootstrap schema before numbered migrations. The bootstrap schema tried to create an index on a column that a later migration would have added, so the deploy failed before the app could start. The fix was to treat bootstrap schema as empty-database setup and let existing databases evolve through migrations.

## 4. Background Workers Need A Stricter Safety Model Than Request Handlers

Background automation runs without a human actively looking at the screen. That makes its safety boundary stricter than a normal request handler. Workers need explicit identity, ownership, locking, shutdown semantics, privacy rules, cost controls, and partial-failure accounting.

The danger is not only that a worker can fail. The bigger danger is that it can keep doing reasonable-looking work in the wrong context: duplicate work across replicas, spend money when nobody asked, leak context through traces, mutate data during shutdown, or erase useful failure evidence.

The transferable rules:

- Give workers a narrow system identity instead of pretending to be a human user.
- Make model/API spend opt-in for unattended runs.
- Use locking or job claiming when multiple processes can run the same work.
- Make shutdown wait for active work or record an honest partial failure.
- Preserve partial counts and errors instead of flattening failures to zero.
- Test no-user-present execution separately from manual/request-driven execution.

ShipShape example: FleetGraph worker review found several real issues: system-principal scope was too broad, scheduled worker runs could accidentally use real model behavior, advisory-lock handling was coupled to graph write transactions, and shutdown could race active DB work. The fix was to narrow the worker identity, force deterministic no-user-present runs, isolate locking from graph persistence, and record durable worker tick metadata.

## 5. Eval Headlines Must Separate Current Behavior From Historical Artifacts

An evaluation report should answer the first operational question clearly: "Is the current system passing?" Historical failures are useful, but they should not be mixed into the headline unless the report explicitly says it is measuring historical drift.

When old persisted outputs, replay logs, cached runs, or archived samples share the same score as fresh runtime cases, the report becomes misleading. Teams waste time fixing already-fixed bugs, or worse, learn to distrust the eval.

The transferable rules:

- Put fresh/current runtime cases in the headline.
- Put historical persisted samples in a separate section or trend appendix.
- Label whether failures are current, historical, or replay-only.
- Keep old failures visible when they teach something, but do not let them obscure present state.
- Add regression tests for report semantics, not just model or product behavior.

ShipShape example: the FleetGraph product-surface eval looked broken because old `fleetgraph_runs` snapshots from before a copy fix were counted with fresh runtime outputs. The current graph output passed, but the headline still showed failures. The fix was to split the report into current surface results and historical persisted samples, with the CLI headline based on current behavior.

## 6. Login Works Is Not The Same As Demo World Works

Authentication proves only that credentials are accepted. It does not prove the user lands in the right workspace, has the right permissions, sees representative data, or can exercise the workflow the demo is supposed to prove.

Demo accounts are product entry points, not just users in a table. They need a known landing context and enough realistic data behind them to support the intended test path. A sparse or wrong workspace can make a valid login feel like a broken product.

The transferable rules:

- Verify login, landing workspace, permissions, and representative data counts together.
- Seed the demo user into the workspace that actually contains the useful data.
- Add direct links or navigation targets for the workflows being demonstrated.
- Check local and deployed databases independently.
- Do not answer "yes, the demo exists" from authentication success alone.

ShipShape example: the FleetGraph reviewer login worked, but it initially landed in a tiny FleetGraph-only workspace instead of the dense seeded workspace. The account authenticated successfully but did not expose the useful projects, issues, weeks, and controls needed for testing. The fix was to point the canonical reviewer at the loaded workspace when it exists and seed the FleetGraph controls there.

## 8. Put Verifier Semantics On The Wire Once

When a dashboard and an API both interpret the same proof gates, duplicate pure helpers on the client will drift. The UI can format labels, but it should not maintain a second required-step list or product-path definition.

The transferable rules:

- Compute presentation flags on the authoritative server response.
- Share only pure selection/label helpers that both tiers import from one package.
- Add explicit wire fields (`productPath`, `missingLabels`, `preferredChainId`) instead of re-deriving status in React.
- Test the shared helper once; test the API boundary for enrichment.

ShipShape example: reviewer `productPathStatus` on web checked six steps while API `REQUIRED_STEP_KEYS` tracked eight. Moving enrichment into `shared/src/fleetgraph/reviewer-verifier.ts` and emitting `productPath` on each chain removed the split-brain metric.

For long-running reviewer operations, progress UI must read the same refreshed chain steps the API just wrote, not a cosmetic timer or a one-shot snapshot taken at start. While status is `running`, bind the drawer to live chain data; only freeze a snapshot after completion. Register OpenAPI from the shared wire factory—never duplicate finding/notification Zod beside the factory or codegen will drift from runtime validation.
