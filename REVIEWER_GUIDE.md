# Reviewer Guide — PlugForge Final Submission (Week 6)

Verify the **10 hard gates** from [`Plugforge-specs.txt`](./my-docs/project-weeks-sot/week-6/w6-specs/Plugforge-specs.txt) on the **deployed** site. No local setup. About 15 minutes.

**Closure target:** `pnpm plugforge:submission` must pass on `main` ([CI workflow](https://github.com/MichaelHabermas/ship-shape/actions/workflows/plugforge-submission.yml)).

**Styled copy (same content):** [plugforge-reviewer-packet.html](https://ship-shape-web.onrender.com/plugforge-reviewer-packet.html)

---

## Preflight (do this before anything else)

The **API** must run the Plugforge build. The static web site alone is not enough.

```bash
curl -s https://ship-shape-api.onrender.com/health
```

**Pass if:** JSON includes `"status":"ok"` **and** `"plugforge":true`.

**Stop if not:** `ship-shape-api` on Render is outdated. Redeploy the API from the current branch, then re-run preflight. Without this, Workspace Settings → **Developer** will fail (you may see a flash of `?expired=true` in the URL).

Quick second check:

```bash
curl -s -o /dev/null -w "%{http_code}" https://ship-shape-api.onrender.com/api/v1/openapi.json
```

**Pass if:** `200` (not `404`).

---

## Login and URLs

| | |
|---|---|
| **Web app** | https://ship-shape-web.onrender.com/ |
| **API base** | https://ship-shape-api.onrender.com |
| **API health** | https://ship-shape-api.onrender.com/health |
| **API docs viewer** | https://ship-shape-web.onrender.com/platform-docs.html |
| **OpenAPI JSON (live)** | https://ship-shape-api.onrender.com/api/v1/openapi.json |
| **SDK demo (PKCE)** | https://ship-shape-web.onrender.com/sdk-demo |

**Demo admin login**

| Field | Value |
|---|---|
| Email | `dev@ship.local` |
| Password | `admin123` |

After login: click your workspace name (top) → **Workspace Settings** → **Developer** tab.

Direct link (after login): https://ship-shape-web.onrender.com/settings?tab=developer

---

## Do this first (gates 1, 2, 8)

1. Open the [web app](https://ship-shape-web.onrender.com/) and sign in with the credentials above.
2. Go to [**Workspace Settings → Developer**](https://ship-shape-web.onrender.com/settings?tab=developer). Click **Create app**. Pick scopes `documents:read`, `documents:write`, and `webhooks:manage`. Copy the **client_id** and the **client secret** when shown.
   - **Pass if:** the secret appears **once** on create; you cannot view it again afterward (only rotate/revoke).
   - **If you see a red error** about the API route not found: preflight failed — redeploy the API.
3. Open [SDK demo](https://ship-shape-web.onrender.com/sdk-demo). Paste your **client_id**, click **Connect**, approve consent. After redirect, the page should show **Connected.** and load **Documents** / **Issues** lists (or “Loaded empty lists.”).
   - **Pass if:** redirect completes; lists load without auth errors. Try **Create** to add a document.
4. Confirm the demo loaded public API data after connect (proves bearer token works with the SDK).
   - **Pass if:** **Connected.** / **Loaded.** status and document or issue rows appear (or empty lists with no error). Automated `.me()` proof: [`e2e/oauth-auth-code.spec.ts`](./e2e/oauth-auth-code.spec.ts).

---

## Checklist (all 10 gates)

Each row: do the **live check**, then confirm **pass if**.

| # | Gate | Live check | Pass if |
|---|------|------------|---------|
| 1 | OAuth app registration; secret shown once | Steps 1–2 above | App created; raw secret shown exactly once, not recoverable |
| 2 | Authorization Code + PKCE end-to-end | Step 3 (SDK demo) | Full connect → consent → token → SDK calls succeed. Automated proof: [`e2e/oauth-auth-code.spec.ts`](./e2e/oauth-auth-code.spec.ts) in CI on `main` |
| 3 | Bearer middleware on every `/api/v1/*` | `curl -s https://ship-shape-api.onrender.com/api/v1/documents` then `curl -s -H "Authorization: Bearer bad" https://ship-shape-api.onrender.com/api/v1/documents` | Both return **401** JSON with `code` and `message` (not HTML) |
| 4 | Documents: GET list, GET :id, POST + scopes | [API docs viewer](https://ship-shape-web.onrender.com/platform-docs.html) → documents | GET list/id require `documents:read`; POST requires `documents:write` |
| 5 | Consistent ApiError on public failures | Use the 401 bodies from gate 3 | Body includes `code`, `message`, and `request_id`. Fitness test in CI: `api/src/platform/api/v1/route-metadata.test.ts` |
| 6 | ScopeRegistry; 403 names missing scope | Create a **second** OAuth app with **only** `documents:read`. On SDK demo, connect with that client_id, then click **Create** | Error/status names missing scope (e.g. `documents:write`), not generic forbidden. CI: `api/src/platform/api/v1/middleware.test.ts` |
| 7 | OpenAPI 3.1 generated at `/api/v1/openapi.json` | [Live OpenAPI on API host](https://ship-shape-api.onrender.com/api/v1/openapi.json) (not the static web copy) | JSON loads; `openapi` is **3.1.x**; includes `/api/v1/documents` paths |
| 8 | SDK: `new ShipClient({ token }).me()` | Step 4 above (lists load after connect) | Authenticated SDK calls succeed; `.me()` covered by CI (`e2e/oauth-auth-code.spec.ts`) |
| 9 | Regression suite + perf within +10% | Not runnable from the deployed site alone | CI and local: `pnpm plugforge:submission` ([workflow](https://github.com/MichaelHabermas/ship-shape/actions/workflows/plugforge-submission.yml)). Perf: no automated +10% gate yet. |
| 10 | Deployed + published OpenAPI + grader OAuth | [API /health](https://ship-shape-api.onrender.com/health) shows `plugforge:true`; create read-only app in Developer tab | Public web + API + live OpenAPI; grader can self-register a read-only OAuth app |

---

## Automated closure

Everything in the proof ledger, evidence files, deployed URLs, live integrations, and TTFE/webhook drills must pass:

```bash
pnpm plugforge:submission
```

Pre-handoff (external attachments still pending):

```bash
pnpm plugforge:submission -- --allow-manual-pending
```

---

## Spec source

Canonical MVP wording: [`my-docs/project-weeks-sot/week-6/w6-specs/Plugforge-specs.txt`](./my-docs/project-weeks-sot/week-6/w6-specs/Plugforge-specs.txt) (lines 43–66).
