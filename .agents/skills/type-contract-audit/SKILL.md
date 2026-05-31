---
name: type-contract-audit
description: >-
  Audits Ship for type contract drift and redundant parallel definitions — local route/hook
  interfaces that should import, extend, or derive from @ship/shared, OpenAPI/Zod wire shapes,
  or shared row mappers;   passthrough type barrels; enum duplication; Pick/Omit/z.infer opportunities; ghost type aliases
  (type Foo = Bar with no narrowing); and literal clones (type Foo = { id: string } when the same
  shape already exists under another name); fake nominal labels (WeekId, ProjectId, etc. on
  structurally identical generic shapes — consolidate to one id type per layer). Use when the user says "this", asks for a type contract audit, SSOT pass, duplicate type hunt,
  shared type extraction, or points at an area to review for competing contracts and type safety.
---

# Type Contract Audit

Find **competing contracts**: parallel type definitions that type-check today but drift tomorrow.
This is not import line merging (`import-x/no-duplicates`) or union algebra
(`@typescript-eslint/no-redundant-type-constituents`).

**Default:** report-only. Fix only when the user asks. Scope to whatever path or feature they point at.

## Read first

1. `AGENTS.md` — document model, no passthrough type barrels
2. `docs/claude-reference/anti-patterns.md` — §8 Types in Route Files, §11 Passthrough barrels
3. `docs/openapi-contract.md` — Zod/OpenAPI contract layer
4. If touching document properties or routes: `docs/context-manifest.md` → `document-model` + `api` profiles

## SSOT ladder (prefer top to bottom)

When the same concept appears in multiple layers, truth flows **down** this stack:

1. **Zod schemas** in `api/src/openapi/schemas/` — HTTP contract source
2. **`z.infer<typeof Schema>`** or shared wire types promoted to `@ship/shared` when API **and** web need them
3. **Web HTTP aliases** in `web/src/api/schemas.ts` (from generated OpenAPI) — not hand-rolled duplicates
4. **Domain document model** in `shared/src/types/document.ts` and `shared/src/enums/document-enums.ts`
5. **DB row types** (`*Row`, snake_case) — API-local in `api/src/routes/route-query-rows.ts` or feature `types.ts`; never exported to web
6. **Runtime-only** types under `api/src/fleetgraph/` etc. — import at the defining module; no re-export barrels

**Rule:** derive or import; do not rewrite the same field set under a new name.

## Good patterns already in repo (extend, don't redo)

- `api/src/utils/document-properties.ts` — JSONB accessors typed against `@ship/shared` property interfaces
- `api/src/routes/route-query-rows.ts` — shared PostgreSQL row + response mappers
- `shared/src/types/document.ts` — canonical document property model
- `web/src/api/schemas.ts` — OpenAPI-derived aliases (not passthrough hubs)

## Hunt workflow

User may narrow scope ("routes only", "issues family", `web/src/hooks/`). Otherwise start with hot zones below.

```
- [ ] 1. Inventory local type declarations in scope
- [ ] 2. Match each against SSOT ladder
- [ ] 3. Classify + severity
- [ ] 4. Report with fix recipe per item
- [ ] 5. (If fixing) One family per slice; run gates
```

### Grep inventory (run in scope)

```bash
# Local interfaces/types in routes (§8 smell)
rg -n '^(export )?(interface|type) ' api/src/routes --glob '*.ts' --glob '!**/*.test.ts'

# Names that collide with domain model
rg -n 'IssueProperties|ProjectProperties|WeekProperties|ProgramProperties|SprintRouteProperties|BelongsTo|IssueState|DocumentType' \
  api/src/routes web/src --glob '!shared/**'

# Passthrough barrels (§11)
rg -n "export type \{.*\} from '@ship/shared'" api web shared
rg -n "export type \{.*\} from '@/api/schemas'" web/src

# Hand-rolled unions that should be shared enums
rg -n "'open' \| 'closed'|'issue' \| 'project'" api/src web/src --glob '!shared/**'

# Loose HTTP schemas (OpenAPI debt)
rg -n 'JsonObject|passthrough|z\.record\(z\.unknown' api/src/openapi api/src/routes

# Web hooks/components re-declaring API shapes
rg -n '^(export )?(interface|type) ' web/src/hooks web/src/components web/src/pages \
  --glob '*.{ts,tsx}' --glob '!**/*.test.*'

# Ghost alias — type renames another type with no narrowing or extension
rg -n 'export type \w+ = \w+;$' api web shared e2e --glob '*.{ts,tsx}'

# Literal clones — same minimal object type defined again (common: { id: string })
rg -n 'export type \w+ = \{ id: string \};' api web shared e2e --glob '*.{ts,tsx}'

# Fake nominal labels — domain-flavored names on generic id shapes
rg -n 'export type \w+(WithId|IdRow|IdResponse) = ' api web shared e2e --glob '*.{ts,tsx}'
rg -n 'export type (Week|Project|Program|Person|Document|Issue|File)\w* = \{ id: string \}' api web shared e2e --glob '*.{ts,tsx}'
```

### Ghost aliases, literal clones, and fake nominal labels (always flag, remove, prevent)

TypeScript structural typing makes these **zero-safety renames**. They look domain-specific; the compiler treats them as identical.

**What to call this (for reports):**

| Term | Meaning |
|------|---------|
| **Ghost alias** | `type Foo = Bar` — rename only |
| **Literal clone** | `type Foo = { id: string }` written again when an equivalent type exists |
| **Fake nominal label** | `WeekWithId`, `ProjectIdRow`, `TeamProgram` as separate types when each is **just an id** — domain flavor with no distinct structure |
| **Generic consolidation** (the fix) | One canonical name per layer for “only an id”: `ApiId`, `IdRow`, etc. |

**Ghost alias** — pure rename, no added information:

```typescript
export type ApiId = { id: string };
export type ApiDocument = ApiId; // DELETE — use ApiId (or a comment at the call site)
```

Flag any `type X = Y` where `Y` is a single identifier and the RHS is **not** `Pick`, `Omit`, `Extract`, `Partial`, `Required`, `Readonly`, a union/intersection, or `typeof` / `z.infer`. Those are narrowing or extension; bare `= OtherType` is not.

**Literal clone** — same object literal written twice under different names:

```typescript
export type ApiId = { id: string };
export type WeekWithId = { id: string }; // DELETE — use ApiId everywhere
```

Flag when the same property set already exists in the file or module under another type name. Do not define `{ id: string }` again as `TeamProgram`, `WeekWithId`, etc. when `ApiId` or `IdRow` already exists in scope.

**Fake nominal label** — multiple domain-specific names for the same generic shape:

```typescript
export type ApiId = { id: string };
export type WeekWithId = { id: string };   // same — not “week id”, just id
export type TeamProgram = { id: string }; // same — not “program id”, just id
```

If the type adds **only** a domain word in the alias but the structure is identical (`{ id: string }`, or a lone `id: string` field with nothing else), **generalize**. Week id and project id are both strings in `{ id: string }` — TypeScript will not keep them separate. Pick **one generic name for that layer** and use it everywhere:

| Layer | Prefer one canonical generic |
|-------|----------------------------|
| E2E JSON fixtures | `ApiId` in `e2e/fixtures/e2e-api-types.ts` |
| API query rows | `IdRow` in `api/src/routes/route-query-rows.ts` |
| API-local row (single file) | `IdRow` — not `WeekIdRow`, `ProjectIdRow`, … |

Use the **variable or parameter name** (`weekId`, `projectId`) for human context; the **type** stays generic unless you add real structure or **branded types** (explicit `string & { __brand: … }` — only when the team wants compile-time id separation).

**Fix:**

1. Delete the ghost alias, literal clone, or fake nominal label.
2. Replace all references with the **one generic canonical name** for that shape in that layer (`ApiId`, `IdRow`, …).
3. If the old name documented intent, use a **comment** or a **local variable name** (`const weekId = row.id`) — not another export.

**Prevent:** never introduce `type Foo = Bar`, a repeated `{ … }` literal, or a domain-labeled id type when a generic equivalent already exists. In reports, classify as **Class G** (ghost alias), **Class H** (literal clone), or **Class I** (fake nominal label — generalize to layer canonical), severity **P2** minimum — not optional cleanup.

**Not ghost alias (keep):** `type X = Pick<Y, 'a'>`, `type X = Y & { extra: string }`, OpenAPI `components['schemas']['Foo']` aliases, `Extract<Enum, 'a' | 'b'>`.

### Structural overlap heuristic

For each local `interface` / `type`, compare **property key sets** to the nearest canonical type:

- ≥80% key overlap + different type name → likely **duplicate** (P0/P1)
- Same name as shared type, different fields → **drift bomb** (P0)
- Subset of fields → **derive** with `Pick` / `Omit` / `Partial` (P2)
- snake_case DB columns vs camelCase wire → **row vs response** — keep separate, add mapper (Class C)

Do not flag intentional narrowing: `Extract<IssueState, 'open' | 'blocked'>`.

## Classification

| Class | Meaning | Action |
|-------|---------|--------|
| **A — Pure duplicate** | Same shape, no semantic difference | Delete local; import canonical |
| **B — Narrowing / extension** | Canonical plus or minus fields | `extends`, `Pick`, `Omit`, intersection |
| **C — Row vs wire** | DB shape vs API JSON | Keep `*Row` local; map to OpenAPI/shared response type |
| **D — OpenAPI gap** | Route returns shape not in Zod | Tighten schema → regenerate → use `@/api/schemas` |
| **E — Intentional local** | Test fixture, runtime-only, e2e helper | Note and skip |
| **F — Passthrough barrel** | `export type { X } from '…'` only | Remove; import from defining module |
| **G — Ghost alias** | `type Foo = Bar` — rename only, no `Pick`/`Omit`/`&`/union | Delete alias; use `Bar`; comment if intent needed |
| **H — Literal clone** | `type Foo = { … }` duplicates existing type in scope | Delete; use canonical name (`ApiId`, `IdRow`, …) |
| **I — Fake nominal label** | `WeekWithId`, `ProjectIdRow`, … — domain name, generic `{ id: string }` only | **Generalize:** one `ApiId` / `IdRow` per layer; context in variable names |

## Severity

- **P0 — Drift bomb:** local type **named like** domain model (`IssueProperties`, `WeekProperties`, …) but fields differ from `@ship/shared`
- **P1 — Cross-layer duplicate:** same wire shape in API route + web hook/component
- **P2 — Derivable or zero-value rename:** `Pick`/`Omit`/`z.infer` opportunity; **Class G/H/I** (ghost alias, literal clone, fake nominal label → generic consolidation)
- **P3 — Cleanup:** passthrough barrel, split import style

Prioritize **P0 → P1** in the report. Group findings by **family** (issues, weeks, workspaces, FleetGraph, admin, …) for reviewable slices.

## Import routing (fixes)

| Need | Import from |
|------|-------------|
| Cross-package domain / wire | `@ship/shared` |
| HTTP/OpenAPI component (web) | `@/api/schemas` |
| API runtime-only | Defining module (e.g. `api/src/fleetgraph/types.ts`) |
| DB row | `route-query-rows.ts` or local feature `types.ts` |

Never add `export type { X } from '…'` passthrough unless the file is the deliberate public boundary for a whole subtree (rare — see anti-patterns §11).

## Fix playbook (when user asks to implement)

1. **One family per slice** — e.g. all issue list properties, not routes + FleetGraph in one diff
2. **Prefer derive over move** when the local type is a subset:

   ```typescript
   type IssueListFields = Pick<IssueProperties, 'id' | 'title' | 'state'>;
   type ApiIssue = z.infer<typeof IssueSchema>;
   ```

3. **Move to `shared/`** only when API and web both consume the shape
4. **Row types stay API-local** unless multiple routes share them → consolidate in `route-query-rows.ts`
5. **OpenAPI first** when the shape is an HTTP response: tighten Zod, `pnpm openapi:generate`, wire web to `@/api/schemas`
6. **Mapper coupling check** (when touching mappers): consider `expectTypeOf(mapRowToIssue).returns.toMatchTypeOf<IssueListItem>()` in API tests if types are easy to wire — catches silent drift without a custom script
7. **Drift canary mindset:** after consolidating a family, one field removed from shared should break mappers at compile time — if it doesn't, the "fix" may still be parallel types
8. **Ghost aliases / literal clones / fake nominal labels:** delete extra types; use the **one generic canonical** per layer (`ApiId`, `IdRow`); put domain meaning in variable names, not type aliases

## defineRoute / OpenAPI debt

Routes still on `JsonObject` / `passthrough` are **Class D** backlog. When auditing a route family, note whether `defineRoute` + Zod exists (`docs/openapi-contract.md`). Rank by web consumption — hooks importing hand-rolled shapes are higher priority.

## False positives (skip)

- `*Row` / snake_case PostgreSQL columns (but consolidate duplicate `{ id: string }` and `WeekIdRow`-style fake nominals in the same module → Class H/I)
- Generated `web/src/api/generated/ship-openapi.d.ts`
- FleetGraph internal types not on the wire
- List vs detail shapes that intentionally omit fields
- OpenAPI `export type Foo = components['schemas']['Foo']` — wire to generated spec, not a ghost alias

## Report format

```markdown
# Type Contract Audit — [scope user gave, or default hot zones]

## Summary
- Findings: P0 n | P1 n | P2 n | P3 n
- **Recommended first slice:** [one family — smallest high-impact PR]

## P0 — Drift bombs
### [Short title]
- **Local:** `path:line` — `TypeName`
- **Canonical:** `shared/...` or OpenAPI component
- **Drift:** [field differences]
- **Fix:** [import / delete / derive — one sentence]

## P1 — Cross-layer duplicates
…

## P2 — Derivable, ghost aliases, literal clones, fake nominal labels
…

## P3 — Cleanup
…

## Suggested slice order
1. …
2. …

## Gates (after fixes)
pnpm type-check
pnpm check:affected-ts        # if TS/JS changed
pnpm openapi:check:strict     # if routes/schemas changed
pnpm test:api                 # if response shapes changed
```

## Operating rules

- **Do not** invent drift — every finding needs file path and evidence (keys, names, or grep hit).
- **Do not** refactor unrelated code during an audit.
- **Do not** create scripts, scanners, or new docs files unless the user asks.
- Separate **confirmed** findings from **needs manual confirmation** (similar names, partial overlap).
- When the user says **"this"** in a thread about type SSOT / duplicate types, run this workflow on their stated scope or default hot zones.
- **Never introduce** ghost aliases or literal clones when fixing other findings — that regresses the audit.

## Related commands (verification only)

```bash
pnpm type-check
pnpm check:affected-ts
pnpm openapi:check:strict
pnpm type-safety:report --brief
```
