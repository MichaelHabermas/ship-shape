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

## Discovery 2: [Name the thing learned]

### Where I found it

- `[file path]` lines `[start-end]`
- `[file path]` lines `[start-end]`

### What it does

[Explain the pattern, library, TypeScript feature, design decision, or engineering practice in concrete terms. Describe how it works in this codebase.]

### Why it matters

[Explain why this changed your understanding of the system. Tie it to Ship Shape's architecture, such as the unified document model, server-authoritative sync, TypeScript boundaries, testing infrastructure, or deployment workflow.]

### How I would apply it in a future project

[Explain the reusable lesson. This should be broader than this repo: what would you design, verify, avoid, or document differently next time?]

## Discovery 3: [Name the thing learned]

### Where I found it

- `[file path]` lines `[start-end]`
- `[file path]` lines `[start-end]`

### What it does

[Explain the pattern, library, TypeScript feature, design decision, or engineering practice in concrete terms. Describe how it works in this codebase.]

### Why it matters

[Explain why this changed your understanding of the system. Tie it to Ship Shape's architecture, such as the unified document model, server-authoritative sync, TypeScript boundaries, testing infrastructure, or deployment workflow.]

### How I would apply it in a future project

[Explain the reusable lesson. This should be broader than this repo: what would you design, verify, avoid, or document differently next time?]