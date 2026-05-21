# OpenAPI Contract

Ship registers API operations from Zod schemas (`api/src/openapi/schemas/`). Runtime Express routes must stay aligned with the generated spec.

## Commands

```bash
pnpm openapi:generate          # Regenerate api/openapi.json + web client types
pnpm openapi:check             # Report runtime vs OpenAPI coverage
pnpm openapi:check:strict      # Fail on missing or stale routes (pre-commit)
```

## Path rules

- OpenAPI `path` values omit the `/api` prefix (`servers[0].url` is `/api`).
- Use `{param}` in OpenAPI; Express may use `:id` — the checker normalizes both.

## Test-time response validation

Use `expectOpenApiResponse` from `api/src/test/openapi-response.ts` in integration tests to assert:

1. The operation exists in the generated spec.
2. The status code is declared with `application/json`.
3. The response body matches the same Zod schema used for OpenAPI.

## Typed route wrapper (pilot)

`defineRoute` in `api/src/openapi/define-route.ts` registers OpenAPI and parses request inputs. Pilot: `api/src/routes/setup.ts`. Import side effects for generation: `api/src/openapi/index.ts` loads setup routes so `openapi:generate` includes defineRoute registrations.

Production response validation remains deferred.
