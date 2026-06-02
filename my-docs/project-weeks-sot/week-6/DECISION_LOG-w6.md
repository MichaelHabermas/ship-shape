# Week 6 Decision Log

This document records Week 6 decisions that are not directly dictated by the PlugForge specs, so they can be referenced separately from canonical assignment requirements.

## 2026-06-02 — First Public API Vertical Slice

- OAuth app registration is a session-authenticated management route at `POST /api/platform/apps`, not a public `/api/v1` route and not an OAuth protocol endpoint.
- The first `/api/v1/me` slice validates real OAuth access tokens, but tests seed access tokens directly. `/oauth/token` issuance waits for the PKCE/device-flow slice.
- `/api/v1/me` is explicitly auth-only in public route metadata with `requiredScope: null`. Do not add `me:read` unless the canonical scope registry changes deliberately.
- Legacy `api_tokens` are not accepted for `/api/v1/*`; public API auth uses `oauth_access_tokens` tied to an OAuth app, user, workspace, granted scopes, and public audit row.
- OAuth `client_secret` values are stored with Argon2id hashes. OAuth access tokens are random high-entropy bearer tokens stored as SHA-256 hashes for lookup.
- Mounted platform/public routes are registered in existing OpenAPI artifacts and checked by route parity, even though standalone public OpenAPI generation is deferred.
- Public API rate limiting precedes audit inserts to avoid unauthenticated durable-write amplification. Public request IDs are capped at 128 characters before storage.
- Access-token creation requires current workspace membership; later membership removal remains a validation-time `membership_revoked` denial rather than cascading token deletion.
