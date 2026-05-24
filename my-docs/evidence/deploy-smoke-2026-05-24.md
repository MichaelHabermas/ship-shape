# Deploy Smoke Evidence - 2026-05-24

## Target

- Web: `https://ship-shape-web.onrender.com/`
- Expected public behavior: unauthenticated users are redirected to the login page.

## Method

Browser smoke using the Codex Playwright browser:

```text
navigate https://ship-shape-web.onrender.com
wait for redirect and page render
capture accessibility snapshot
capture viewport screenshot in the Playwright MCP output
```

## Result

- Final URL: `https://ship-shape-web.onrender.com/login`
- Page title: `Ship - Project Management & Documentation`
- Visible UI:
  - Ship logo
  - `Sign in to Ship`
  - Email address field
  - Password field
  - Sign in button
- Console:
  - One unauthenticated `401` from `https://ship-shape-api.onrender.com/api/bootstrap`
  - This is expected before redirect/login and is not counted as an authenticated deploy validation failure.

## Boundary

This is a basic public smoke check only. It proves the public web deployment is reachable and renders the login page. It does not prove authenticated user flows, seeded data correctness, or production performance.
