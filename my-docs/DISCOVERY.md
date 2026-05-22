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

## Discovery 1: Realtime identity must be server-canonical

### Where I found it

- `api/src/collaboration/index.ts` lines 99-102 (`docs`, `awareness`, and `conns` keyed by collaboration room name)
- `api/src/collaboration/index.ts` lines 651-679 (upgrade handler resolves `document_type` and builds the canonical room)
- `shared/src/collab-protocol.ts` lines 17-47 (room parsing, canonical room building, and legacy prefix matching)

### What it does

The collaboration server keeps live Yjs documents, awareness, and sockets under an in-memory room key, but persistence ultimately belongs to a row in the unified `documents` table. The current upgrade path accepts a requested room, extracts the UUID, checks access, resolves the authoritative `document_type` from PostgreSQL, and then uses `buildCollaborationRoomName(documentType, docId)` as the server room key.

### Why it matters

In a unified document model, a URL prefix can look cosmetic while still becoming operational identity in realtime state. If `issue:<id>` and `wiki:<id>` are allowed to create different live rooms for one persisted row, collaborators can split across separate CRDT states. The transferable lesson is that realtime namespace and persistence identity have to collapse to the same server-owned key.

### How I would apply it in a future project

Treat realtime namespace and persistence primary keys as one design decision. If the URL or client prefix can vary, either validate against authoritative metadata on connect or canonicalize server-side before loading CRDT state.

## Discovery 2: Typed route ownership does not have to break legacy contracts

### Where I found it

- `api/src/openapi/define-route.ts` lines 25-49 (typed route config and parsed request contract)
- `api/src/openapi/define-route.ts` lines 132-170 (OpenAPI registration, request parsing, and validation-error handling)
- `api/src/routes/feedback.ts` lines 66-150 (`POST /api/feedback` using `defineRoute` with legacy validation errors)
- `api/src/routes/feedback.ts` lines 154-200 (`GET /api/feedback/program/:programId` preserving the public `{ error }` shape)

### What it does

`defineRoute` registers the OpenAPI operation and parses request inputs once before the handler runs. Public feedback now uses it for `POST /api/feedback` and `GET /api/feedback/program/:programId`, but with a small `validationError` hook so the public endpoints keep their older flat `{ error }` response shapes instead of switching to the newer standard error envelope.

### Why it matters

I expected route/spec consolidation to force contract churn. This showed the better pattern: make the default path stricter, then encode legacy exceptions explicitly and test them. The API contract improves without breaking public feedback forms.

### How I would apply it in a future project

When migrating old routes into a typed route wrapper, separate "who owns the schema" from "what exact response shape exists today." Give legacy behavior a named escape hatch, keep the default modern, and require tests for each exception.

## Discovery 3: Authorization tests need real foreign records

### Where I found it

- `e2e/fixtures/isolated-env.ts` lines 70-84 (worker/test fixture types expose `dbPool`)
- `e2e/fixtures/isolated-env.ts` lines 95-137 (fresh PostgreSQL container per worker)
- `e2e/authorization.spec.ts` lines 43-153 (owned and foreign workspaces, users, documents, and issues seeded directly)
- `e2e/authorization.spec.ts` lines 247-290 (UI/API assertions against real foreign document and issue IDs)

### What it does

The isolated E2E fixture starts a fresh PostgreSQL container per worker. Exposing a `dbPool` fixture lets a spec seed owned and foreign workspace records directly, then verify UI/API behavior against real inaccessible IDs. The authorization spec now uses that to prove real foreign document/issue reads are blocked and mixed bulk issue updates mutate only the owned record.

### Why it matters

Fake UUIDs only prove "missing row returns not found." They do not prove workspace isolation. Ship Shape's unified document model makes this especially important because wiki docs, issues, projects, and people all share the same `documents` table; isolation has to be tested with existing rows that differ only by authorization boundary.

### How I would apply it in a future project

For authorization tests, create both sides of the boundary in the test fixture. The useful assertion is not "unknown ID fails"; it is "known foreign ID exists, is valid, and still cannot be read or mutated by this actor."
