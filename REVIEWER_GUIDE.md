# Reviewer Guide — PlugForge Final Submission (Week 6)

This file is the **entry index** for human reviewers: preflight, URLs, and the full 10-gate matrix. The primary walkthrough is on the deployed site:

**https://ship-shape-web.onrender.com/plugforge-reviewer-packet.html**

Open that packet first. **Path A** (MVP gates) takes ~8–12 min on the live site. **Path B** (six reference integrations + TTFE) is a ~5 min read in the packet’s [integrations section](https://ship-shape-web.onrender.com/plugforge-reviewer-packet.html#integrations). Use the sections below for curl preflight, gate-by-gate checks, grader OAuth delivery (spec gate 10), and CI closure.

Verify the **10 hard gates** from [`Plugforge-specs.txt`](./my-docs/project-weeks-sot/week-6/w6-specs/Plugforge-specs.txt) on the **deployed** site. No local setup.

**Closure target:** `pnpm plugforge:submission` must pass on `master` ([CI workflow](https://github.com/MichaelHabermas/ship-shape/actions/workflows/plugforge-submission.yml)).

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
| 5 | Consistent ApiError on public failures | Use the 401 bodies from gate 3 | Body includes `code`, `message`, and `request_id`. Fitness test in CI: `api/src/platform/api/v1/public-api-fitness.test.ts` |
| 6 | ScopeRegistry; 403 names missing scope | Create a **second** OAuth app with **only** `documents:read`. On SDK demo, connect with that client_id, then click **Create** | Error/status names missing scope (e.g. `documents:write`), not generic forbidden. CI: `api/src/platform/api/v1/middleware.test.ts` |
| 7 | OpenAPI 3.1 generated at `/api/v1/openapi.json` | [Live OpenAPI on API host](https://ship-shape-api.onrender.com/api/v1/openapi.json) (not the static web copy) | JSON loads; `openapi` is **3.1.x**; includes `/api/v1/documents` paths |
| 8 | SDK: `new ShipClient({ token }).me()` | Step 4 above (lists load after connect) | Authenticated SDK calls succeed; `.me()` covered by CI (`e2e/oauth-auth-code.spec.ts`) |
| 9 | Regression suite + perf within +10% | Not runnable from the deployed site alone | CI and local: `pnpm plugforge:submission` ([workflow](https://github.com/MichaelHabermas/ship-shape/actions/workflows/plugforge-submission.yml)). Includes Playwright regression, the proof pack, and automated +10% checks via `scripts/plugforge-metrics/baseline-comparator.mjs` (P95 latency, per-route query counts, SDK bundle size vs Part 1 baseline). |
| 10 | Deployed + published OpenAPI + pre-registered grader OAuth | [API /health](https://ship-shape-api.onrender.com/health) shows `plugforge:true`; grader app metadata in README / [`FINAL_SUBMISSION_CHECKLIST.md`](./my-docs/project-weeks-sot/week-6/FINAL_SUBMISSION_CHECKLIST.md) / private submission channel | Public web + API + live OpenAPI; **pre-registered** read-only grader OAuth app per [`Plugforge-specs.txt`](./my-docs/project-weeks-sot/week-6/w6-specs/Plugforge-specs.txt) (lines 65–66, 606–608): `client_id`, redirect URI, and scopes in the submission packet; `client_secret` delivered privately (`W6-SUBMIT-006`). Demo login + Developer tab still prove gates 1–8 interactively. |

---

## Integrations proof (beyond MVP gates) — Path B

The spec requires at least five integration flows; this submission ships six (CLI/TTFE, Slack, browser SDK, GitLab, refresh-token theft, idempotency replay). The deployed packet section is **generated** from committed evidence JSON — run `pnpm plugforge:render-reviewer` after evidence changes.

| Flow | Quick reviewer check |
|------|----------------------|
| **Matrix rollup** | Packet shows run id and six rows all passed |
| **CLI / TTFE** | Total ms &lt; 60 s in [`ttfe-timing.json`](./my-docs/evidence/plugforge-metrics/ttfe-timing.json) |
| **Browser SDK** | [SDK demo](https://ship-shape-web.onrender.com/sdk-demo) — same as gate 2 |
| **Slack** | Screenshot + signed webhook delivery ids in packet; live posts to Slack channel |
| **GitLab** | [Live MR on labs.gauntletai.com](https://labs.gauntletai.com/michaelhabermas/plugforge-live-proof/-/merge_requests/1) — **not** gitlab.com |
| **Security drills** | CI proof pack only (refresh-theft + idempotency tests) |

**GitLab proof issue in Ship:** open [proof issue](https://ship-shape-web.onrender.com/documents/2b7000ba-ef72-4900-ba01-49f27db7956f) after login — external link chip should show the GitLab MR.

**Grader API readback** (pre-registered read-only token from submission channel):

```bash
curl -s -H "Authorization: Bearer $GRADER_TOKEN" \
  https://ship-shape-api.onrender.com/api/v1/issues/2b7000ba-ef72-4900-ba01-49f27db7956f
```

**Pass if:** JSON includes `external_links` with `provider: "gitlab"` and the MR URL.

Evidence paths: [`my-docs/evidence/plugforge-integrations/live/`](./my-docs/evidence/plugforge-integrations/live/) (`matrix.json`, `slack.json`, `gitlab.json`, `browser-sdk.json`).

---

## Automated closure

Everything in the proof ledger, evidence files, deployed URLs, live integrations, and TTFE/webhook drills must pass:

```bash
pnpm plugforge:submission
```

Pre-handoff only while the private grader OAuth secret delivery note is still pending:

```bash
pnpm plugforge:submission -- --allow-manual-pending
```

---

## Spec source

Canonical MVP wording: [`my-docs/project-weeks-sot/week-6/w6-specs/Plugforge-specs.txt`](./my-docs/project-weeks-sot/week-6/w6-specs/Plugforge-specs.txt) (lines 43–66).
