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

## 8. Clear ESLint Categories Before Tackling `no-unsafe-*`

When a repo enables type-aware `@typescript-eslint/no-unsafe-*` rules, total warning count is dominated by those rules—not by `no-unused-vars`, `max-lines`, or `restrict-template-expressions`. Fix whole categories first: delete unused imports/destructures, turn param validators into type guards (`id is string`), and replace test `any` with `z.infer`, `unknown`, or shared mock types. Defer `seed.ts` non-null assertions and file splits until mechanical wins are exhausted.

ShipShape example (2026-05-31): four unused-vars and four template-expression warnings cleared in minutes; ~45 `no-explicit-any` fixes in four API test files removed most of that category; non-null assertions in tests/e2e dropped ~41 while `api/src/db/seed.ts` stayed untouched for a later pass.

## 9. Route Tests Should Prove The OpenAPI Contract, Not Just Parse JSON

Integration tests that read `res.body.foo` without a schema catch lint noise at best. Tests that call `expectOpenApiResponse` with the same Zod schema registered in OpenAPI catch contract drift: missing fields, wrong nullability, and bulk/list shape mismatches before production or codegen do.

ShipShape example (2026-05-31): migrating `api/src/routes/*.test.ts` surfaced that POST/PATCH issues omitted `assignee_name` while GET included it, and bulk updates returned explicit `null` for optional list fields. Fixing mappers (`extractIssueFromRow`, `mapIssueListItem` in bulk) aligned runtime JSON with the documented contract and cleared ~700 route-test `no-unsafe-*` warnings.

## 10. E2E Needs Typed Boundaries Too — `readJsonAs` Alone Is Not Enough

Playwright specs that call `readJsonAs` but still define loose inline types, or mix in raw `.json()`, keep most `no-unsafe-*` warnings. The fix is the same three-layer pattern as API routes: one parse helper (`typed-json.ts`), shared assertion-minimal types (`e2e-api-types.ts`), and typed SQL rows for Testcontainers seed code (`e2e-seed-rows.ts` in `isolated-env.ts`).

ShipShape example (2026-05-31): Tier 3 cleared ~487 E2E warnings. Top file `weekly-accountability.spec.ts` had both `readJsonAs` and 27 raw `.json()` calls; migrating every parse site and deduplicating `PersonDocument` / weekly-plan types dropped it from 95 warnings to zero.

## 11. Do Not Encode Product Chat As A Regex Template Router

If users expect conversation, a deterministic intent classifier will feel robotic no matter how many branches you add. Tests that lock exact greeting strings, force `modelCalls: 0` on chat, or add a flag that disables the chat model will green-light a broken product. Separate concerns: keep detection, workers, and auth deterministic; use the model for PM chat when key and model name are configured; when unconfigured, fail honestly; assert outcomes (grounding, gates, no hallucination) instead of canned copy.

ShipShape example (2026-06): FleetGraph `POST /api/fleetgraph/chat` fell back to an 800+ line template router whenever `OPENAI_API_KEY` was unset, while docs and evals treated zero-token chat as success. We removed the product router and the chat-deterministic env flag, return unavailable text without a key, and mock `@langchain/openai` in tests on the real `generateContextChatText` path.

## 12. Seeded Tokens Can Hide A Missing Front Door

Tests that insert bearer tokens directly prove token validation, not credential issuance. For auth platforms, keep a separate proof that starts where users and clients start: authorization request, consent, credential exchange, and one real protected API call. Otherwise every downstream feature can accidentally build on a fictional login path.

ShipShape example (2026-06): `/api/v1/me` accepted OAuth access tokens, but the first tests seeded those tokens directly. The route was real; the platform entrance was not. The fix was to add Authorization Code + PKCE, browser consent, one-time code exchange, refresh rotation, and a Playwright flow that mints the token before calling `/api/v1/me`.

## 13. A Packed Install Is A Different Product Than A Workspace Link

Workspace links hide packaging mistakes. A CLI can import a sibling SDK perfectly in a monorepo and still fail for users when the packed tarball asks the package manager to fetch that private workspace dependency from a registry.

The transferable rules:

- Test developer tools from packed artifacts in a fresh temp project.
- Make CLI packages depend on public SDKs the way users will install them: usually peer dependency plus dev workspace dependency.
- Keep the demo path and test path on the same executable receiver whenever possible.
- Treat "works with workspace symlink" as local convenience, not release proof.

ShipShape example (2026-06): `ship webhooks tail` worked from the workspace, but `pnpm drill ttfe` failed because packed `@ship/cli` depended on `@ship/sdk` as `workspace:*` and fresh install tried npm. Moving `@ship/sdk` to a CLI peer dependency made the packed SDK+CLI drill real.

## 14. Retry Logic Needs Injectable Time And Transport

Backoff, timeout, retry, and dead-letter behavior cannot be tested well through real sleeps and real network calls. Those tests prove the wall clock moved, not that the retry state machine is correct. Put time, timers, transport, and persistence boundaries behind injectable seams; production uses real dependencies, tests advance fake time and return exact transport outcomes.

The transferable rules:

- Assert every retry class directly: success, retryable status, retryable transport error, terminal failure, and max-attempt DLQ.
- Keep delay constants visible and test them without sleeping.
- Capture outbound request metadata in tests so replay/idempotency behavior is observable.
- Do not let UI or route tests duplicate retry logic; they should drive the same service path.
- Atomically claim due work before side effects; "select then update" is enough to green tests and still double-send under two workers.
- Persist retry state and next work item in one transaction, then recover stale in-flight rows by age; otherwise crashes land between green-state transitions.
- Update bootstrap schema snapshots when retry/ops migrations must work in fresh isolated databases.

ShipShape example (2026-06): webhook tests originally waited for deliveries with `setTimeout` polling. Refactoring delivery around an injected clock and deliverer made 2xx, 429/5xx, timeout, 4xx DLQ, six-failure DLQ, and replay `Idempotency-Key` behavior deterministic in milliseconds.

## 15. Monorepos Should Not Type-Check Against Ignored Build Artifacts

If one workspace package exports `dist/` and another package imports it during development, the consumer can silently type-check against stale or missing generated files. That makes local success depend on whether someone happened to build the producer package first.

The transferable rules:

- Resolve workspace-to-workspace imports to source in dev, test, and type-check tooling.
- Keep published package exports pointed at build artifacts, but add monorepo aliases or references for sibling consumers.
- Treat ignored `dist/` as disposable output, not as a source of truth for local verification.
- Add a focused test or type-check after changing a public package surface so stale artifacts are caught immediately.

ShipShape example (2026-06): web `/sdk-demo` initially failed type-check after the SDK gained issue/sprint clients because `@ship/sdk` resolved to ignored `sdk/dist` from a previous build. Adding source aliases in web TypeScript/Vite/Vitest made the app consume the current SDK source during development while keeping package exports stable for packed installs.

## 16. Authorization Must Cover Related Data, Not Just The Primary Row

Public read models often assemble one authorized resource plus labels, counts, owners, parents, or rollups from neighboring records. If those joins do not repeat the same visibility and ownership predicates, a safe primary-resource endpoint becomes a metadata leak or relationship oracle.

The transferable rules:

- Treat every joined label, count, filter, and webhook payload field as data that needs its own read authorization.
- Apply same-tenant, non-deleted, visibility, and subject-specific predicates to related rows before they influence output or filters.
- Avoid unsafe casts from user-editable JSON/properties fields; validate first and join on safe representations.
- Do not fan out private resource webhooks through workspace-level subscriptions unless the subscription stores the read subject and scopes it was authorized with.

ShipShape example (2026-06): public issue/sprint routes correctly authorized the primary document-backed resource, but related programs, weekly plans, retros, and accountability targets needed the same visibility predicates. The fix filtered those joins and suppressed private issue webhook fanout until webhook subscriptions can carry an explicit read-context snapshot.
