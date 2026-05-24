**Description**

`GET /api/accountability/action-items` may return sprint `targetTitle` for sprints user participates in via assigned issues without sprint visibility check.

**Affected code**

- `api/src/services/accountability.ts` (~L210–221, ~L300–309, ~L506–527)

**Note**

Needs runtime confirmation with private sprint + visible issue fixture.
