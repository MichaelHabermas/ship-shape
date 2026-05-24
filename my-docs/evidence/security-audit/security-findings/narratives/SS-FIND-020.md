**Description**

Super-admin can set CAIA `issuer_url` to internal/metadata endpoints. Discovery validation performs outbound fetch.

**Affected code**

- `api/src/routes/admin-credentials.ts`
- `api/src/services/caia.ts` — `client.discovery(new URL(issuer_url))`

**Exploitability**

Requires compromised super-admin session.

**Recommended fix**

HTTPS only; block RFC1918/link-local/metadata IPs on save.
