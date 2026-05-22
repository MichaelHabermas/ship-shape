# Discovery

This write-up documents three things I learned by studying the Ship Shape codebase. Each discovery is a transferable lesson from the code, not just a defect or improvement result.

> Find 3 things in this codebase that you did not know before. These can be TypeScript features, architectural patterns, libraries, design decisions, or engineering practices that were new to you.
>
> For each discovery:
>
> 1. Name the thing you discovered
> 2. Where you found it in the codebase (file path and line range)
> 3. What it does and why it matters
> 4. How you would apply this knowledge in a future project

## Discovery 1: Server-canonical realtime room identity

### Where I found it

- `api/src/collaboration/index.ts` (upgrade handler, in-memory `docs` map keyed by full room string)
- `shared/src/collab-protocol.ts` (`buildCollaborationRoomName`, `roomPrefixMatchesDocumentType`)
- `discovery-research-log.md` Discovery 2 (room prefix vs UUID persistence)

### What it does

The collaboration server used to accept any `{prefix}:{uuid}` room name while persisting only the UUID to PostgreSQL. That let two clients join different in-memory Yjs documents for the same row. The deepening pass resolves `document_type` from the database on upgrade and always uses `{document_type}:{uuid}` as the room key, with shared protocol constants for message types and close codes.

### Why it matters

In a unified document model, the prefix feels cosmetic but the realtime layer treated it as primary identity. This is a sharp example of **server truth**: the database row is one document, so the collaboration cache must have one room per row.

### How I would apply it in a future project

Treat realtime namespace and persistence primary keys as one design decision. If the URL or client prefix can vary, either validate against authoritative metadata on connect or canonicalize server-side before loading CRDT state.

## Discovery 2: OpenAPI ownership can preserve legacy public contracts

### Where I found it

- `api/src/openapi/define-route.ts` lines 25-45 and 121-150
- `api/src/routes/feedback.ts` lines 67-190

### What it does

`defineRoute` registers the OpenAPI operation and parses request inputs once before the handler runs. Public feedback now uses it for `POST /api/feedback` and `GET /api/feedback/program/:programId`, but with a small `validationError` hook so the public endpoints keep their older flat `{ error }` response shapes instead of switching to the newer standard error envelope.

### Why it matters

I expected route/spec consolidation to force contract churn. This showed the better pattern: make the default path stricter, then encode legacy exceptions explicitly and test them. The API contract improves without breaking public feedback forms.

### How I would apply it in a future project

When migrating old routes into a typed route wrapper, separate "who owns the schema" from "what exact response shape exists today." Give legacy behavior a named escape hatch, keep the default modern, and require tests for each exception.

## Discovery 3: Real isolation tests need real foreign records

### Where I found it

- `e2e/fixtures/isolated-env.ts` lines 70-84 and 95-137
- `e2e/authorization.spec.ts` lines 35-114 and 214-279

### What it does

The isolated E2E fixture starts a fresh PostgreSQL container per worker. Exposing a `dbPool` fixture lets a spec seed owned and foreign workspace records directly, then verify UI/API behavior against real inaccessible IDs. The authorization spec now uses that to prove real foreign document/issue reads are blocked and mixed bulk issue updates mutate only the owned record.

### Why it matters

Fake UUIDs only prove "missing row returns not found." They do not prove workspace isolation. Ship Shape's unified document model makes this especially important because wiki docs, issues, projects, and people all share the same `documents` table; isolation has to be tested with existing rows that differ only by authorization boundary.

### How I would apply it in a future project

For authorization tests, create both sides of the boundary in the test fixture. The useful assertion is not "unknown ID fails"; it is "known foreign ID exists, is valid, and still cannot be read or mutated by this actor."
