**Description**

`GET /api/team/grid` filters issue visibility but LEFT JOINs program without visibility filter — exposes `program_name`, emoji, color for private programs linked to visible issues.

**Affected code**

- `api/src/routes/team.ts` (~L161–171)

**Recommended fix**

Add `VISIBILITY_FILTER_SQL` on program join alias.
