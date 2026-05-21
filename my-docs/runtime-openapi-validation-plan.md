# Runtime OpenAPI Validation Plan

**Status: completed 2026-05-21.** See `docs/openapi-contract.md` for ongoing conventions.

## Completed

1. Full route registration (195/195, including admin and public families).
2. Removed 8 stale OpenAPI operations (legacy team CRUD, `/weeks/all`, workspace create/patch).
3. Test-time `expectOpenApiResponse` on auth, setup, workspaces, files, feedback, bootstrap.
4. `pnpm openapi:check:strict` in Husky pre-commit.
5. `defineRoute` pilot on setup routes; production response middleware still deferred.

## Still deferred

- `OPENAPI_VALIDATE_RESPONSES=1` staging-only production validation.
- Broad `defineRoute` migration for files, auth, and remaining families.
