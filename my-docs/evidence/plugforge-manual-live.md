# PlugForge Manual Live Proof Log

Manual checks performed against the deployed Week 6 PlugForge surfaces.

Do not record raw OAuth `client_secret` values in this file.

## 2026-06-05

### W6-SUBMIT-006 - Pre-registered grader OAuth app

Status: partially proven; private submission delivery remains external.

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
