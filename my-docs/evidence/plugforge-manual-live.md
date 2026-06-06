# PlugForge Manual Live Proof Log

Manual checks performed against the deployed Week 6 PlugForge surfaces.

This file is a raw evidence artifact for `my-docs/project-weeks-sot/week-6/proof-ledger.yaml`, not a second source of truth. The ledger remains authoritative for status; this file preserves manual screenshots, pasted command output, and reviewer-observable facts that YAML should only reference.

Do not record raw OAuth `client_secret` values in this file.

## 2026-06-05

### W6-SUBMIT-001 - Public GitHub repository

Status: proven.

Evidence:

- URL: `https://github.com/MichaelHabermas/ship-shape`
- Screenshot shows repository `MichaelHabermas / ship-shape` with GitHub `Public` badge.
- Repository is visible while signed out of GitHub.
- Default branch shown as `master`; file listing and About panel are visible.
- About panel links deployed web app `ship-shape-web.onrender.com/`.
- Latest visible commit row: `feat: add PlugForge Manual Live Proof Log for Week 6`, commit `7f9bc09`, shown about `52 minutes ago`.

### W6-SUBMIT-007 - README reviewer instructions

Status: proven.

Evidence:

- Public GitHub README shows heading `Week 6 PlugForge Evidence`.
- README links `REVIEWER_GUIDE.md` as the reviewer entry index and `plugforge-reviewer-packet.html` as the deployed walkthrough.
- README names `pnpm plugforge:submission` as the only closure target and links `.github/workflows/plugforge-submission.yml`.
- README visible surfaces table includes public OpenAPI route, API reference UI, generated public OpenAPI artifact, browser SDK demo, Developer portal, device verification, TTFE drill, final submission gate, proof pack, Slack reference integration/live drill, and GitLab reference integration/live drill.
- README lists demo login `dev@ship.local` / `admin123` for live gate proofs.
- README states graders receive a pre-registered read-only OAuth app with scopes `documents:read`, `issues:read`, `sprints:read`, while `client_secret` is delivered only through the private submission channel for `W6-SUBMIT-006`.
- README states Slack/GitLab unit checks are contract proof only and live drills require real provider credentials plus validator-shaped evidence under `my-docs/evidence/plugforge-integrations/`.

### W6-SUBMIT-005 - Static OpenAPI JSON artifact

Status: proven.

Evidence:

- Public GitHub URL: `https://github.com/MichaelHabermas/ship-shape/blob/master/docs/openapi.json`
- GitHub file path shows `ship-shape / docs / openapi.json`.
- File is visible in the public repository while signed out.
- Top-level JSON shows `openapi`: `3.1.0`.
- `info.title`: `Ship Public API`
- `info.version`: `1.0.0`
- `servers[0].url`: `/api/v1`
- `components.securitySchemes.oauthBearerAuth` is visible with HTTP bearer token configuration for `/api/v1`.

### W6-SUBMIT-006 - Pre-registered grader OAuth app

Status: proven.

Evidence:

- Deployed portal: `https://ship-shape-web.onrender.com/settings?tab=developer`
- App name: `Gauntlet Grader Read-Only`
- `client_id`: `ship_app_4a876f9a4916ad6857346ccad84cc628`
- Displayed scopes: `documents:read`, `issues:read`, `sprints:read`
- Raw `client_secret`: shown once and retained by project owner for private Gauntlet submission; value intentionally not recorded.
- Active secret ID prefix shown in portal: `4f04be51`
- Secret created timestamp shown in portal: `6/5/2026, 4:02:47 PM`
- Redirect URI entered during creation: `https://ship-shape-web.onrender.com/sdk-demo`
- Portal does not display saved redirect URIs after creation; SDK demo OAuth round trip remains the redirect validation.
- Private secret delivery confirmed by project owner on `2026-06-06`; raw secret intentionally not recorded in repository evidence.

### Deployed API health

Status: proven.

Evidence:

- URL: `https://ship-shape-api.onrender.com/health`
- Response: `{"status":"ok","plugforge":true}`

### W6-SUBMIT-004 - Live OpenAPI URL

Status: proven.

Evidence:

- URL: `https://ship-shape-api.onrender.com/api/v1/openapi.json`
- `openapi`: `3.1.0`
- `info.title`: `Ship Public API`
- `info.version`: `1.0.0`

### Public API unauthenticated rejection

Status: proven.

Evidence:

- URL: `https://ship-shape-api.onrender.com/api/v1/documents`
- Response: `{"code":"unauthorized","message":"Missing bearer token","request_id":"42573688-2a77-4f7d-8da3-23e5a6323155"}`

### W6-INT-003 through W6-INT-006 - Slack live proof drill

Status: proven.

Evidence:

- Command run from repo root: `pnpm plugforge:live:slack`
- Result: command exited `1` before running the drill.
- Script reported missing required env vars: `SHIP_API_URL`, `SHIP_ACCESS_TOKEN`, `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`, `SLACK_REDIRECT_URI`, `SLACK_CHANNEL_ID`.
- Follow-up repo-side env check found none of those variable names in `web/.env`, `web/.env.example`, `api/.env.local`, `api/.env`, or `api/.env.example`.
- Slack app admin page `https://api.slack.com/apps` shows an existing app named `Hermes` in workspace `Chazzwazza`, app id `A0APAPQUP4P`, app type `Modern`, distribution status `Not distributed`.
- Dedicated Slack app created for this proof: `PlugForge Live Proof`, app id `A0B8T4QDH9S`, created `June 5, 2026`, with client id visible and client/signing secrets present but intentionally not recorded.
- Dedicated Slack app OAuth redirect URL configured: `http://127.0.0.1:8080/slack/oauth/callback`.
- Dedicated Slack app Bot Token Scope configured: `chat:write`, described by Slack as sending messages as `@PlugForge Live Proof`.
- First live Slack OAuth install attempt failed in Slack before callback with `redirect_uri did not match any configured URIs`; passed URI was `http://127.0.0.1:8080/slack/oauth/callback`. This is setup mismatch evidence, not live integration proof.
- After redirect URL correction, Slack OAuth callback succeeded with response `{"ok":true,"team_id":"T06DAUEV831"}`.
- Same drill run then failed on Ship API access with `Bearer token expired`; no signed webhook or Slack message evidence was written by that run.
- Ship OAuth token was refreshed locally, but rerun only had `SHIP_ACCESS_TOKEN` in the shell environment; drill exited before running and reported missing `SHIP_API_URL`, `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`, `SLACK_REDIRECT_URI`, and `SLACK_CHANNEL_ID`.
- Full-env rerun completed Slack OAuth install, then timed out waiting for `real Slack document.created message`; no live Slack evidence JSON was written.
- Public API delivery log for that run shows Ship reached the Slack integration target for `document.created` but the integration returned `SLACK_POST_MESSAGE_FAILED`; delivery id `6fe89f77-ec72-452f-93ee-c30828fc279f` ended `dlq` after attempts with response statuses `500` then `408`.
- Follow-up rerun after channel invite still timed out. Latest delivery log row `7212c402-093f-43ba-9969-8c08a49072a8` for `document.created` went `dlq` on attempt 1 with `response_status` `408` and empty response. Direct check of `https://common-sites-kneel.loca.lt/health` also returned `HTTP/1.1 408 Request Timeout`, indicating the tunnel/receiver path was stale or unavailable.
- Local tunnel was restarted with fresh URL `https://vast-windows-beg.loca.lt`.
- Fresh-tunnel rerun completed Slack OAuth but again timed out waiting for the real Slack `document.created` message. Delivery log rows for idempotency key `document.created:be363275-3224-4c77-8fa1-f0fb2f2aa3cd` show initial attempts timing out after about `5000ms`, then `503 - Tunnel Unavailable`, then DLQ. This indicates the deployed Ship webhook dispatcher could not reliably reach the local receiver through localtunnel.
- Local-vs-public tunnel check isolated the latest failure: a temporary local receiver on `http://127.0.0.1:8080/health` returned `200`, while `https://vast-windows-beg.loca.lt/health` returned `503 - Tunnel Unavailable`. This confirms localtunnel transport failed independently of Slack OAuth, Slack channel membership, and Ship OAuth token setup.
- Cloudflare tunnel replacement was started at `https://darwin-the-arabic-lows.trycloudflare.com`.
- Successful drill command: `PLUGFORGE_LIVE_TIMEOUT_MS=240000 PLUGFORGE_OPEN_BROWSER=1 pnpm plugforge:live:slack`
- Successful drill stages:
  - Local receiver health passed at `http://127.0.0.1:8080/health`.
  - Public webhook target health passed at `https://darwin-the-arabic-lows.trycloudflare.com/health`.
  - Slack OAuth completed for team `T06DAUEV831`, bot user `U0B8HRQ73QT`.
  - Ship OAuth token was accepted for user `c2fc791d-d4fe-4480-93f0-4482a095502c`.
  - Webhook subscriptions were created for `document.created` and `issue.assigned`.
  - Drill wrote live evidence JSON to `my-docs/evidence/plugforge-integrations/live/slack.json`.
- Live evidence JSON details:
  - Run id: `slack-live-mq2i7qe0`
  - Generated at: `2026-06-06T15:24:50.181Z`
  - Integration target: `https://darwin-the-arabic-lows.trycloudflare.com/ship/webhooks`
  - `document.created` delivery id `e0acffdd-05b0-4a52-851d-57c497a69d69`, idempotency key `document.created:bad4f53c-d3a5-44b9-971d-6b626fb3f40c`, response status `200`, signature verified.
  - `issue.assigned` delivery id `ea507299-c195-466c-be82-0c7448780853`, idempotency key `issue.assigned:44afa793-e818-4c30-bf40-7622c499268c:2026-06-06T15:24:48.852Z`, response status `200`, signature verified.
  - Slack channel id `C0AMVV8UC14`.
  - Slack message timestamps `1780759487.789429` and `1780759488.998489`.
- User screenshot shows `PlugForge Live Proof` posting both messages in Slack channel `sb-inbox`:
  - `Document created: PlugForge live Slack slack-live-mq2i7qe0 (/documents/bad4f53c-d3a5-44b9-971d-6b626fb3f40c)`
  - `Issue assigned: PlugForge live Slack issue slack-live-mq2i7qe0 -> c2fc791d-d4fe-4480-93f0-4482a095502c (/documents/44afa793-e818-4c30-bf40-7622c499268c)`
- Slack target channel selected from `https://chazzwazza.slack.com/archives/C0AMVV8UC14`; channel name observed as `sb-inbox`, channel id `C0AMVV8UC14`.
- Slack workspace shows `PlugForge Live Proof` app was added to private channel `sb-inbox` by Michael Habermas.
- Dedicated Ship OAuth app created for live integration drills: `PlugForge Slack Live Proof`, client id `ship_app_653999d0a9745ee4e4007f374ec5d15a`, secret prefix `25fa3efd`, created `6/5/2026, 6:01:14 PM`.
- Ship app scopes shown: `documents:read`, `documents:write`, `issues:read`, `issues:write`, `sprints:read`, `sprints:write`, `webhooks:manage`.
- Ship device-code OAuth login completed for `ship_app_653999d0a9745ee4e4007f374ec5d15a` with scopes `documents:read documents:write issues:read issues:write webhooks:manage`; user code `UPGL-6V5X`; terminal reported `Logged in as dev@ship.local`. Token stored locally at `/tmp/plugforge-live-ship-token.json` and not recorded.
- Local tunnel established for Slack proof server: `https://common-sites-kneel.loca.lt`, forwarding to local port `8080`.
- Script explicitly reported: `Nothing was run. No evidence was written.`
- Ledger implication: `W6-INT-003`, `W6-INT-004`, `W6-INT-005`, and `W6-INT-006` can be marked proven with `behavior_live` evidence from `my-docs/evidence/plugforge-integrations/live/slack.json`.

### GitLab live proof setup note

Status: proven.

Evidence:

- The live GitLab target is the Gauntlet GitLab instance at `https://labs.gauntletai.com`, not `https://gitlab.com`.
- Personal access token validation failed against `https://gitlab.com/api/v4/user` with `401`.
- The same token validated successfully against `https://labs.gauntletai.com/api/v4/user`.
- Successful user response identified `username`: `michaelhabermas`, `id`: `99`, and `web_url`: `https://labs.gauntletai.com/michaelhabermas`.
- GitLab live drill must set `GITLAB_API_URL=https://labs.gauntletai.com/api/v4`.
- GitLab project check succeeded for `michaelhabermas/plugforge-live-proof`.
- Project id: `1241`; default branch: `master`; web URL: `https://labs.gauntletai.com/michaelhabermas/plugforge-live-proof`.
- Successful drill command: `PLUGFORGE_LIVE_TIMEOUT_MS=240000 pnpm plugforge:live:gitlab`
- Successful drill stages:
  - Local GitLab receiver health passed at `http://127.0.0.1:8081/health`.
  - Public GitLab webhook target health passed at `https://aaron-walks-headed-ram.trycloudflare.com/health`.
  - Ship proof issue was created.
  - GitLab project was read and project webhook was installed.
  - Proof branch, file, and merge request were created in `https://labs.gauntletai.com/michaelhabermas/plugforge-live-proof`.
  - Ship issue `2b7000ba-ef72-4900-ba01-49f27db7956f` received a GitLab external link.
  - Local receiver observed live GitLab merge request webhook `!1`.
- Drill wrote live evidence JSON to `my-docs/evidence/plugforge-integrations/live/gitlab.json`.
- Live evidence JSON details:
  - Run id: `gitlab-live-mq2k4y3z`
  - Generated at: `2026-06-06T16:18:31.874Z`
  - GitLab project URL: `https://labs.gauntletai.com/michaelhabermas/plugforge-live-proof`
  - Webhook hook id: `9`
  - Webhook target: `https://aaron-walks-headed-ram.trycloudflare.com/gitlab/webhook`
  - Observed webhook kind: `merge_request`; linked count: `1`; merge request iid: `1`
  - Merge request URL: `https://labs.gauntletai.com/michaelhabermas/plugforge-live-proof/-/merge_requests/1`
  - Ship issue id: `2b7000ba-ef72-4900-ba01-49f27db7956f`
  - External link: provider `gitlab`, external id `michaelhabermas/plugforge-live-proof!1`, kind `merge_request`, status `opened`
- Ledger implication: `W6-INT-010` and `W6-INT-011` can be marked proven with `behavior_live` evidence from `my-docs/evidence/plugforge-integrations/live/gitlab.json`.

### W6-INT-001 - Final integration matrix rollup

Status: proven.

Evidence:

- Command run from repo root: `pnpm plugforge:live:matrix`
- Drill wrote live evidence JSON to `my-docs/evidence/plugforge-integrations/live/matrix.json`.
- Live matrix run id: `matrix-live-mq2kc6wc`
- Generated at: `2026-06-06T16:24:04.332Z`
- Matrix status: `passed`; proof class: `live`.
- Matrix includes live CLI TTFE evidence from `my-docs/evidence/plugforge-metrics/ttfe-timing.json`.
- Matrix includes live Slack evidence from `my-docs/evidence/plugforge-integrations/live/slack.json`.
- Matrix includes deployed browser SDK evidence from `my-docs/evidence/plugforge-integrations/live/browser-sdk.json`.
- Matrix includes live GitLab evidence from `my-docs/evidence/plugforge-integrations/live/gitlab.json`.
- Matrix includes refresh-token theft proof `api/src/platform/oauth/refresh-theft-drill.test.ts` with command `./scripts/run-api-tests.sh -- src/platform/oauth/refresh-theft-drill.test.ts`.
- Matrix includes idempotency replay proof `api/src/platform/webhooks/service.test.ts` with command `./scripts/run-api-tests.sh -- src/platform/webhooks/service.test.ts`.
- Ledger checker revalidates the referenced live evidence files instead of trusting the matrix JSON alone.

### Public API reference UI

Status: proven.

Evidence:

- URL: `https://ship-shape-web.onrender.com/platform-docs.html`
- Viewer loads `https://ship-shape-api.onrender.com/api/v1/openapi.json`
- Header: `Ship Public API (1.0.0)`
- Description: `Versioned public API for OAuth-authenticated Ship platform integrations.`
- Visible operations include `GET /openapi.json` and `GET /fleetgraph/attention-contexts`; response samples include `200`, `400`, `401`, `403`, `404`, `429`, and `500`.

### Reviewer packet

Status: proven.

Evidence:

- URL: `https://ship-shape-web.onrender.com/plugforge-reviewer-packet.html`
- Header: `PlugForge Reviewer Walkthrough`
- Subtitle states the walkthrough proves the platform on the live deployed site in about `8-12 minutes`.
- Preflight section includes `curl -s https://ship-shape-api.onrender.com/health` and pass condition `plugforge":true`.
- Login section lists `dev@ship.local` / `admin123` and links `/settings?tab=developer`.
- Visible happy-path section begins with `Log in and open the Developer Portal`.

### W6-SUBMIT-008 - Developer portal URL

Status: proven.

Evidence:

- URL: `https://ship-shape-web.onrender.com/settings?tab=developer`
- User reached `Workspace Settings: Ship Workspace` with the `Developer` tab selected.
- Developer tab displayed app creation controls, existing app list, selected OAuth app details, client secrets, webhook subscriptions, delivery log, and public API audit.
- Selected apps observed include `Gauntlet Grader Read-Only` and `SDK Demo Read Write`.

### SDK demo pre-auth page

Status: proven reachable; OAuth round trip not yet proven.

Evidence:

- URL: `https://ship-shape-web.onrender.com/sdk-demo`
- User screenshot shows `SDK + PKCE Demo`, client ID input, `Connect (PKCE)` button, `Create via SDK` button, and pre-auth status `Connect to load public API resources.`
- First Connect attempt with `ship_app_4a876f9a4916ad6857346ccad84cc628` redirected to `https://ship-shape-web.onrender.com/docs` with the Action Items modal open; this does not prove PKCE consent or callback completion.
- User returned to `https://ship-shape-web.onrender.com/sdk-demo` with `ship_app_4a876f9a4916ad6857346ccad84cc628` populated and pre-auth status still `Connect to load public API resources.`
- Second Connect attempt again redirected to `https://ship-shape-web.onrender.com/docs` with the Action Items modal open; live PKCE proof remains failed/blocked.
- After logging out, Connect redirects to `https://ship-shape-web.onrender.com/login?returnTo=https%3A%2F%2Fship-shape-api.onrender.com%2Foauth%2Fauthorize...`; this proves the SDK starts the authorize request and preserves the return target before login.
- After login from that return URL, browser still landed on `https://ship-shape-web.onrender.com/docs` rather than `/oauth/consent` or `/sdk-demo`; live PKCE proof failed.
- Route fix for preserving `/login?returnTo=.../oauth/authorize` was reported pushed and deployed before retrying the manual SDK proof.
- After deployment, retry reached `/login?returnTo=.../oauth/authorize`, but sign-in entered a loop alternating `Loading...` and `Continuing...`; live PKCE proof remains blocked by OAuth/session redirect behavior.
- Retest in a second browser produced the same login/authorize behavior before the app mismatch was identified; this is not counted as browser-specific.
- Chrome retry reached deployed `/oauth/authorize` and returned `{"error":"invalid_scope","error_description":"Scope not registered for this app: documents:write"}`. This proves the read-only grader app is active and rejects the SDK demo's requested write scope; it does not prove the SDK demo success path.
- Repeated read-only grader app check after SDK success returned `{"error":"invalid_scope","error_description":"Scope not registered for this app: documents:write"}` for `ship_app_4a876f9a4916ad6857346ccad84cc628`, confirming write-scope enforcement.
- Separate SDK demo app created for the write-capable browser proof: `ship_app_8816909ca14c69e578bf0d2079ab9541`, redirect URI entered as `https://ship-shape-web.onrender.com/sdk-demo`, expected scopes `documents:read`, `documents:write`, `issues:read`, `sprints:read`.
- SDK demo app reached deployed OAuth consent screen for `SDK Demo Read Write` with `client_id` `ship_app_8816909ca14c69e578bf0d2079ab9541`, redirect URI `https://ship-shape-web.onrender.com/sdk-demo`, and scopes `documents:read`, `documents:write`, `issues:read`, `sprints:read`.
- After Authorize, browser returned to `https://ship-shape-web.onrender.com/sdk-demo` with status `Loaded.` and visible document/issue cards loaded via SDK for `ship_app_8816909ca14c69e578bf0d2079ab9541`. User noted the page could not scroll despite additional content being visible below the viewport.
- Clicking `Create via SDK` with title `hello` returned status `Created.` and inserted a visible `hello` document card with id `1bfcfaa4-dc50-45fd-b4f3-e68a25ddac63`; deployed app Documents page also shows `hello` at the top of the list.
- Developer tab Public API Audit for `SDK Demo Read Write` shows the SDK calls:
  - `POST /api/v1/documents`, status `201`, request `32142c77-7d24-42e6-bb86-51ad96e986fb`, scope `documents:write`, latency `58ms`, rate limited `No`, time `6/5/2026, 5:00:13 PM`
  - `GET /api/v1/documents`, status `200`, request `39070749-1de5-439b-af40-05593b7fc766`, scope `documents:read`, latency `154ms`, rate limited `No`, time `6/5/2026, 4:57:22 PM`
  - `GET /api/v1/issues`, status `200`, request `eeb092fa-46b8-405b-8093-b1d8d308650e`, scope `issues:read`, latency `16ms`, rate limited `No`, time `6/5/2026, 4:57:22 PM`

Follow-up notes:

- Browser note: Brave was initially suspected, but Chrome reproduced the same behavior before the read-only app mismatch was identified. Do not record this as a Brave-specific failure.
- Local-only fix prepared, not deployed during this proof pass: `web/src/pages/SdkDemo.tsx` now makes the SDK demo page its own scroll container and adds accessible labels to the two demo inputs.

### Final strict submission gate

Status: proven.

Evidence:

- Command run from repo root: `pnpm plugforge:submission`
- Result: `PlugForge final submission gate passed (strict final).`
- Gate honesty returned `ok: true` with no live proof gaps and no mock evidence problems.
- Proof ledger enforcement passed with `192` proven atoms, `13` covered-by atoms, `14` non-scope atoms, and `0` manual-pending atoms.
- OAuth Authorization Code + PKCE Playwright check passed with `2` tests.
- Legacy Week 4 submission scripts reported archived evidence drift, but Week 6 gate explicitly continued; this does not block PlugForge Week 6 strict final handoff.
