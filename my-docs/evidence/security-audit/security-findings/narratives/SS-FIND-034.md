**Description**

`GET /api/openapi.json` and Swagger UI document the full API surface without auth — aids attackers mapping approval bypass and IDOR paths.

**Affected code**

- `api/src/swagger.ts` / `setupSwagger` in app bootstrap

**Recommended fix**

Accept for dev; gate or redact sensitive paths in production if threat model requires; never rely on obscurity for authorization.


## Remediation plan (draft — not started)

Phased approach for when fixes begin. **Do not implement until explicitly approved.**

### Phase 1 — Governance integrity (Critical)

| Finding | Action |
| --- | --- |
| SS-FIND-001 | Property denylist on document PATCH; block governance keys |
| SS-FIND-002 | Admin-gate RACI field mutations |
| SS-FIND-003 | Remove ungoverned `status` from generic PATCH; lifecycle-only |

**Exit criteria:** New probes for approval injection, accountable_id self-assign, status bypass — all pass.

### Phase 2 — Accountability documents & WebSocket auth (High)

| Finding | Action |
| --- | --- |
| SS-FIND-004, SS-FIND-005 | Person ownership on weekly_plan/weekly_retro (REST + WS) |
| SS-FIND-006 | Fix `changed_by` in collaboration history |
| SS-FIND-025 | Require `uploaded_by` on file complete paths |
| SS-FIND-026 | Validate `Origin` on WS upgrade |
| SS-FIND-027 | Cap in-memory Y.Doc cache and per-user WS connections |

**Exit criteria:** Member cannot read/write peer weekly plan via documents API or WS; cross-origin WS rejected; file hijack denied.

### Phase 3 — Data exposure hardening (Medium)

| Finding | Action |
| --- | --- |
| SS-FIND-007 | Bulk issue visibility on association targets |
| SS-FIND-008 | Document-linked file authorization |
| SS-FIND-009 | Filter incomplete-children query |
| SS-FIND-010, SS-FIND-011 | Visibility on dashboard/team joins |

### Phase 4 — Abuse surfaces & defense in depth

| Finding | Action |
| --- | --- |
| SS-FIND-012 | Public feedback rate limit / CAPTCHA |
| SS-FIND-013, SS-FIND-014 | S3 confirm + extension hardening |
| SS-FIND-015, SS-FIND-017, SS-FIND-028 | WS session re-validation; session binding; uniform secure session IDs |
| SS-FIND-016, SS-FIND-033 | Token scoping + admin-only token minting |
| SS-FIND-018–024, SS-FIND-029–034 | Deploy-hardening, break-glass, recon, and lower-priority items |

### Probe extensions needed

When fixing, add probes under `packages/shipshape-security/src/probes/`. Phase 1–2 probes are implemented in **`probes/authorization.mjs`** (see `probe-finding-registry.json`). Extend registry + probes when additional SS-FIND rows are remediated.

1. `governance-properties-injection` — member PATCH sprint with `plan_approval`
2. `governance-accountable-self-assign` — member sets own `accountable_id`
3. `governance-week-status-bypass` — member PATCH week to `completed`
4. `weekly-plan-idor-documents` — member reads peer plan via `/api/documents/:id`
5. `weekly-plan-idor-websocket` — member WS to peer plan room
6. `websocket-origin-reject` — cross-origin upgrade with valid cookie → 403
7. `file-upload-hijack-denied` — member B cannot complete member A pending upload


## Verified fixes (for comparison)

These were found and **fixed** during Category 8 probe work. Documented in `my-docs/project-weeks-sot/week-4/Cat-8-Sec-Audit-and-Tool-plan.md`:

| Issue | Before run | After run | Fix location |
| --- | --- | --- | --- |
| Local upload size mismatch | `before-file-size` | `after-file-size` | `api/src/routes/files.ts` |
| Unsafe file serve headers | `before-file-headers` | `after-file-headers-2` | `api/src/routes/files.ts` |
| WS malformed frame crash | `before-ws-malformed` | `after-ws-malformed` | `api/src/collaboration/index.ts` |
| WS oversized frame | — | `after-ws-oversized` | `api/src/collaboration/index.ts` |
| Verbose JSON parse errors | — | `after-verbose-errors` | `api/src/app.ts` |

Open findings in this ledger are **separate** from Cat 8 closeout — discovered by deeper authorization review after probes passed.


## Changelog

| Date | Change |
| --- | --- |
| 2026-05-22 | Ledger opened: SS-FIND-001…024 from deep OWASP / authorization review (probes already green at `cat8-final`) |
| 2026-05-22 | Same session: SS-FIND-025…034 added; related-finding clusters; removed mistaken duplicate `findings-ledger.md`; timeline metadata corrected (single session, not a second day) |
