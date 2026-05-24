**Description**

`POST /api/setup/initialize` is unauthenticated (CSRF only). Advisory lock prevents concurrent double-init, not attacker-vs-admin race on fresh deploy.

**Affected code**

- `api/src/routes/setup.ts` (~L53–104)
- `api/src/app.ts` (~L205)

**Exploitability**

High only when API is internet-reachable before legitimate bootstrap.

**Recommended fix**

Firewall setup routes until complete; or require one-time setup token.
