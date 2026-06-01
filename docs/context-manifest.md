# Context Manifest

Use this file to keep agent context small. Pick the smallest profile that covers the task, then load only the listed docs/tools unless the code forces a narrower follow-up.

## Profile Selection

| Profile | Use when | Required context |
| --- | --- | --- |
| `context-audit` | Auditing or reducing agent context | `AGENTS.md`, `docs/context-manifest.md`, current user request |
| `general` | Small edits, code reading, dependency-free fixes | `AGENTS.md`, target files |
| `bugfix` | Fixing a reported defect or regression | `AGENTS.md`, target files, nearby tests |
| `frontend` | React UI, editor layout, visual behavior, client routing | `docs/document-model-conventions.md`, target web files |
| `api-route` | REST endpoints, request/response shape, OpenAPI registration | `docs/application-architecture.md`, route files, OpenAPI registration files |
| `collaboration` | Yjs, WebSocket sync, document editor state, mentions in collaborative content | `docs/unified-document-model.md`, `docs/claude-reference/modules/collaboration.md`, related shared protocol files |
| `document-model` | Document types, associations, titles, properties, content model | `docs/unified-document-model.md`, `docs/document-model-conventions.md`, `docs/conventions/week-sprint-terminology.md` (when touching weeks/sprints) |
| `migration` | Database schema changes or data backfills | `docs/application-architecture.md`, existing migrations, affected query files |
| `e2e` | Adding/fixing Playwright coverage | `docs/claude-reference/testing.md`, `e2e/AGENTS.md`, affected fixtures |
| `deploy` | Production/shadow deployment, envs, verification | `docs/application-architecture.md`, `docs/shadow-env-testing.md`, deploy scripts |
| `security` | Auth, access control, session behavior, sensitive data | `docs/claude-reference/security.md`, `my-docs/evidence/auth-matrix.md`, `my-docs/CODE_QUALITY_REMEDIATION_PLAN.md` (checklist pointer), affected middleware/routes/services |
| `fleetgraph` | FleetGraph agent, reviewer proof, trace/cost evidence, reviewer dashboard | `FLEETGRAPH.md`, `PRESEARCH.md`, `REVIEWER_GUIDE.md`, `my-docs/project-weeks-sot/week-5/DECISION_LOG-w5.md`, target FleetGraph files |
| `docs` | Updating repo docs after behavior changes | Changed code, docs being updated |

## Profile Details

### `context-audit`

Use this when the user asks what context is active, how to reduce it, or how to restructure instructions.

Return:

- Always-on instructions.
- Selected profile and why.
- Files/docs planned for loading.
- Tools/skills planned for use.
- Context intentionally ignored.

Do not read implementation docs or source files unless the audit question names them.

### `general`

Default to this for small, local tasks. Do not read architecture docs unless the edit changes data model, routing, collaboration, deployment, auth, or UX conventions.

Useful commands:

```bash
pnpm type-check
pnpm test
```

### `bugfix`

Start from the failing behavior, then read the smallest local surface that can explain it. Prefer targeted tests over broad runs.

Load:

- The failing file and its direct collaborators.
- Existing tests for the same module or route.
- A broader profile only if the defect touches one of its boundaries.

### `frontend`

Use for `web/` changes, editor surfaces, navigation, sidebars, issue/project/program/sprint/person screens, and visual workflows.

Load:

- `docs/document-model-conventions.md`
- The affected component tree.
- Existing sibling components before adding a new pattern.

Rules:

- Preserve the 4-panel editor layout unless explicitly changing it.
- Use `"Untitled"` for new document placeholders.
- Reuse the shared `Editor` component for document editing surfaces.

Useful commands:

```bash
pnpm dev:web
pnpm type-check
```

### `api-route`

Use for `api/src/routes/**`, API contracts, OpenAPI, generated MCP exposure, and request validation.

Load:

- `docs/application-architecture.md`
- Existing route files with the same pattern.
- OpenAPI schema/registration files touched by the endpoint.

Rules:

- Register every API route with OpenAPI.
- Keep request/response types explicit and shared when the frontend consumes them.
- Use direct `pg` queries; do not introduce an ORM.

Useful commands:

```bash
pnpm type-check
pnpm test
```

### `collaboration`

Use for `api/src/collaboration/**`, `shared/src/collab-protocol.ts`, document mentions, document views, TipTap/Yjs state, and WebSocket protocol changes.

Load:

- `docs/unified-document-model.md`
- `docs/claude-reference/modules/collaboration.md`
- `api/src/collaboration/index.ts`
- Relevant shared protocol files.

Rules:

- Treat Yjs state as the collaboration source of truth.
- Keep REST document content and WebSocket collaboration behavior aligned.
- Verify protocol changes on both `api/` and `shared/` consumers.

### `document-model`

Use for new document behavior, associations, properties, titles, and cross-document references.

Load:

- `docs/unified-document-model.md`
- `docs/document-model-conventions.md`
- `docs/conventions/week-sprint-terminology.md` when changing week documents, `sprint_id` filters, or `/api/weeks` vs `/sprints` routes
- Current migrations if persistence changes.

Rules:

- Prefer adding document properties or associations over new content tables.
- Use `document_associations` for relationships.
- Keep all new document titles as `"Untitled"`.

### `migration`

Use for schema changes, data backfills, indexes, constraints, and persistence shape changes.

Load:

- `docs/application-architecture.md`
- Existing files in `api/src/db/migrations/`
- Affected query/service files.

Rules:

- Add a numbered migration file named `NNN_description.sql`.
- Do not edit `api/src/db/schema.sql` for existing tables.
- Migrations run in transactions; write them to be repeat-safe where practical.

Useful commands:

```bash
pnpm db:migrate
pnpm test
```

### `e2e`

Use for Playwright specs, browser workflows, fixtures, and test reliability.

Load:

- `docs/claude-reference/testing.md`
- `e2e/AGENTS.md`
- `e2e/fixtures/isolated-env.ts` when tests need seeded data.

Rules:

- Use `/e2e-test-runner`; fallback is `pnpm test:e2e:run`.
- Never use conditional `test.skip()` for missing seed data.
- Use `test.fixme()` for unimplemented tests.
- If a test needs N rows, fixtures should create at least N+2.

### `deploy`

Use for deployment scripts, shadow/prod releases, health checks, and environment setup.

Load:

- `docs/application-architecture.md`
- `docs/shadow-env-testing.md`
- `scripts/deploy.sh`
- `scripts/deploy-web.sh`

Useful commands:

```bash
./scripts/deploy.sh prod
./scripts/deploy-web.sh prod
./scripts/deploy.sh shadow      # AWS UAT
./scripts/deploy-web.sh shadow  # AWS UAT frontend
```

Verify production with browser, not only curl:

- Render API: `https://ship-shape-api.onrender.com/health`
- Render Web: `https://ship-shape-web.onrender.com`
- Reviewer evidence bundle: `https://ship-shape-reviewer-evidence.onrender.com/`
- AWS prod API: `http://ship-api-prod.eba-xsaqsg9h.us-east-1.elasticbeanstalk.com/health`
- AWS prod Web: `https://ship.awsdev.treasury.gov`

### `fleetgraph`

Use for FleetGraph runtime, detection, reviewer control room, proof scripts, observability, trace links, and cost evidence.

Load:

- `my-docs/fleetgraph-conversational-chat.md` (PM chat contract)
- `FLEETGRAPH.md`
- `REVIEWER_GUIDE.md` (reviewer/proof only)
- The specific FleetGraph API/web/proof files being changed.

Do not load `my-docs/project-weeks-sot/week-5/archive/submission-deterministic-chat/` for PM chat work.

Rules:

- PM chat is LLM conversation with chip/page context as topic; do not add regex template routers for chat.
- Keep proactive and on-demand behavior inside one graph/runtime boundary.
- Treat `web/public/fleetgraph-observability/proof/latest.*` as the canonical public proof snapshot; local-only packets under `my-docs/evidence/fleetgraph-proof/latest.*` are not deployed proof.
- Use `pnpm fleetgraph:proof:check` and `pnpm fleetgraph:proof:verify-traces` after proof or reviewer-doc changes.

Useful commands:

```bash
pnpm docs:check:fleetgraph-chat
pnpm fleetgraph:proof:check
pnpm fleetgraph:proof:verify-traces
pnpm fleetgraph:proof:test
```

### `security`

Use for auth, authorization, sessions, cookies, access control, dependency compliance, or sensitive data.

Load:

- `docs/claude-reference/security.md`
- `my-docs/evidence/auth-matrix.md` — production `authorize()` inventory and known gaps
- `my-docs/CODE_QUALITY_REMEDIATION_PLAN.md` — wave/epic checklist only; do not copy into other docs
- Affected middleware, route, and service files (`capabilities.ts`, `document-mutations.ts`, `setup-access.ts` when touching setup or mutations)
- Existing tests around the same permission boundary (`capabilities.test.ts`, `document-policy.test.ts`)

Rules:

- Never use `git commit --no-verify`.
- Preserve session timeout behavior unless the task is explicitly changing it.
- Prefer `authorize()` / `authorizeDocumentMutation()` over duplicating visibility SQL or local `canAccessDocument` helpers in routes.
- Runtime policy lives in `capabilities.ts`; `document-policy.ts` is seed/types only (no `decide*` at runtime).

### `docs`

Use for documentation changes that should match code behavior.

Load:

- The changed code first.
- The smallest doc that describes that behavior.

Rules:

- Do not update docs from memory when the code is easy to inspect.
- Prefer correcting specific stale claims over broad rewrites.
- After editing curated docs, run `pnpm docs:check:strict` (and `pnpm docs:facts:render` if `document-enums.ts` changed).
