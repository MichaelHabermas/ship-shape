# Reviewer Guide — Plugforge MVP (Week 6)

Verify the **10 MVP hard gates** from [`Plugforge-specs.txt`](./my-docs/project-weeks-sot/week-6/w6-specs/Plugforge-specs.txt) on the **deployed** site. No local setup. About 15 minutes.

**Styled copy (same content):** [plugforge-reviewer-packet.html](https://ship-shape-web.onrender.com/plugforge-reviewer-packet.html)

---

## Login and URLs

| | |
|---|---|
| **Web app** | https://ship-shape-web.onrender.com/ |
| **API base** | https://ship-shape-api.onrender.com |
| **API health** | https://ship-shape-api.onrender.com/health |
| **API docs viewer** | https://ship-shape-web.onrender.com/platform-docs.html |
| **OpenAPI JSON** | https://ship-shape-api.onrender.com/api/v1/openapi.json |
| **SDK demo (PKCE)** | https://ship-shape-web.onrender.com/sdk-demo |

**Demo admin login**

| Field | Value |
|---|---|
| Email | `dev@ship.local` |
| Password | `admin123` |

After login, open **Workspace Settings → Developer** (admin only).

---

## Do this first (gates 1, 2, 8)

1. Open the [web app](https://ship-shape-web.onrender.com/) and sign in with the credentials above.
2. Go to **Workspace Settings → Developer**. Click **Create app**. Pick scopes `documents:read`, `documents:write`, and `webhooks:manage`. Copy the **client_id** and the **client secret** when shown.
   - **Pass if:** the secret appears **once** on create; you cannot view it again afterward (only rotate/revoke).
3. Open [SDK demo](https://ship-shape-web.onrender.com/sdk-demo). Paste your **client_id**, click **Connect**, approve consent. After redirect, the page should show **Connected.** and load **Documents** / **Issues** lists (or “Loaded empty lists.”).
   - **Pass if:** redirect completes; lists load without auth errors. Try **Create** to add a document.
4. Confirm the demo loaded public API data after connect (proves bearer token works with the SDK).
   - **Pass if:** **Connected.** / **Loaded.** status and document or issue rows appear (or empty lists with no error). Automated `.me()` proof: [`e2e/oauth-auth-code.spec.ts`](./e2e/oauth-auth-code.spec.ts).

---

## MVP checklist (all 10 gates)

Each row: do the **live check**, then confirm **pass if**.

| # | Gate | Live check | Pass if |
|---|------|------------|---------|
| 1 | OAuth app registration; secret shown once | Steps 1–2 above | App created; raw secret shown exactly once, not recoverable |
| 2 | Authorization Code + PKCE end-to-end | Step 3 (SDK demo) | Full connect → consent → token → SDK calls succeed. Automated proof: [`e2e/oauth-auth-code.spec.ts`](./e2e/oauth-auth-code.spec.ts) in CI on `main` |
| 3 | Bearer middleware on every `/api/v1/*` | In a terminal: `curl -s https://ship-shape-api.onrender.com/api/v1/documents` (no header). Then: `curl -s -H "Authorization: Bearer bad" https://ship-shape-api.onrender.com/api/v1/documents` | Both return **401** JSON with `code` and `message` (ApiError shape) |
| 4 | Documents: GET list, GET :id, POST + scopes | Open [API docs viewer](https://ship-shape-web.onrender.com/platform-docs.html) → find **documents** | GET list/id require `documents:read`; POST requires `documents:write` |
| 5 | Consistent ApiError on public failures | Use the 401 responses from gate 3 | Body includes `code`, `message`, and `request_id`. Fitness test in CI: `api/src/platform/api/v1/route-metadata.test.ts` |
| 6 | ScopeRegistry; 403 names missing scope | Create a **second** OAuth app with **only** `documents:read`. On SDK demo, connect with that client_id, then click **Create** | Error/status names missing scope (e.g. `documents:write`), not generic forbidden. CI: `api/src/platform/api/v1/middleware.test.ts` |
| 7 | OpenAPI 3.1 generated at `/api/v1/openapi.json` | Open [OpenAPI JSON](https://ship-shape-api.onrender.com/api/v1/openapi.json) and [API docs viewer](https://ship-shape-web.onrender.com/platform-docs.html) | Spec loads (not empty/stub); viewer lists `/api/v1` operations; `openapi` field is **3.1.x** |
| 8 | SDK: `new ShipClient({ token }).me()` | Step 4 above (lists load after connect) | Authenticated SDK calls succeed; `.me()` covered by CI (`e2e/oauth-auth-code.spec.ts`) |
| 9 | Regression suite + perf within +10% | Not runnable from the deployed site alone | **CI on `main` passes** (Playwright + API tests). See [GitHub Actions](https://github.com/MichaelHabermas/ship-shape/actions) for latest green run |
| 10 | Deployed + published OpenAPI + grader OAuth | Confirm health: [API /health](https://ship-shape-api.onrender.com/health). Create an app with **read-only** scope `documents:read` in Developer tab (or reuse gate 1 app) | Web + API + OpenAPI URL public; grader can self-register a read-only OAuth app (no support ticket) |

---

## What this guide is not

- **Final submission bar** (TTFE webhook drill, full CLI story, agent rewire) lives in the packet’s “Beyond MVP” section and [`README.md` § Week 6](./README.md#week-6-plugforge-evidence)—not required for Tuesday MVP gates.

---

## Spec source

Canonical MVP wording: [`my-docs/project-weeks-sot/week-6/w6-specs/Plugforge-specs.txt`](./my-docs/project-weeks-sot/week-6/w6-specs/Plugforge-specs.txt) (lines 43–66).
