**Description**

Each collaboration room loads a full `Y.Doc` into process memory (`docs` Map). Per-IP connection rate limits exist (30/min) but there is no cap on total cached documents, concurrent connections per user, or distinct rooms per workspace.

**Affected code**

- `api/src/collaboration/index.ts` — `docs` Map, `getOrCreateDoc`, cleanup (~L100–263, ~L757–776)

**Attack scenario**

Authenticated attacker opens WebSockets to many distinct document rooms (UUIDs from list APIs). Memory and CPU pressure from loaded Yjs state + debounced `persistDocument` writes.

**Recommended fix**

Global LRU cap on cached `Y.Doc` instances; per-user concurrent connection limit; per-workspace WS budget.

**Verification plan**

- Load test with connection budget; assert 429 or graceful eviction under threshold.
