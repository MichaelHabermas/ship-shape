# Runtime OpenAPI Validation Plan

## Recommendation

Use test-time response validation first. Do not add production OpenAPI middleware yet.

Production middleware would sit on every API request, compete with existing handwritten route logic, and create noisy failures while the contract is still catching up to runtime behavior. The cheaper path is to make integration tests prove that selected runtime responses match the same Zod schemas that generate OpenAPI.

## What exists now

- OpenAPI is generated from Zod schemas via `@asteasolutions/zod-to-openapi`.
- `scripts/check-openapi-routes.mjs` compares Express routes with generated OpenAPI paths.
- `api/src/test/openapi-response.ts` adds an opt-in Vitest helper:
  - asserts the operation exists in the generated OpenAPI document
  - asserts the status code is declared
  - asserts `application/json` content is declared
  - validates the runtime response body with the Zod schema used by OpenAPI
- `api/src/routes/openapi-contract.test.ts` covers `GET /api/auth/session` as the first passing smoke test.

## Current drift boundary

`POST /api/auth/login` now returns the same wrapped auth context shape advertised by `LoginResponseSchema`:

```json
{
  "success": true,
  "data": {
    "user": {},
    "currentWorkspace": {},
    "workspaces": [],
    "pendingAccountabilityItems": []
  }
}
```

That earlier auth-login drift is no longer the blocker. The current blocker is broader contract coverage: `pnpm openapi:check` is still report-only and currently reports 195 runtime routes, 121 OpenAPI operations, 82 runtime routes missing from OpenAPI, and 8 stale OpenAPI operations.

## Rollout

1. Fix high-traffic schema drift and coverage gaps first: auth errors, remaining file/document responses, and intentionally public route families.
2. Add one contract assertion per route family in existing integration tests, using `expectOpenApiResponse`.
3. Flip `scripts/check-openapi-routes.mjs --strict` in CI after intentional internal-route exclusions are documented.
4. Add production middleware only for a narrow debug mode, such as `OPENAPI_VALIDATE_RESPONSES=1` in staging, after test-time validation is clean.

## 10x option

Generate a typed route wrapper that accepts `{ requestSchema, responseSchema }` once, registers OpenAPI, validates test responses, and optionally validates production responses behind an environment flag. That deletes the current split-brain pattern where route handlers and OpenAPI schemas can drift independently.
