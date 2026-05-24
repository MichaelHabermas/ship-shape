**Description**

`/api/ai/analyze-plan` and `/analyze-retro` read raw `req.body.content` without Zod. Bounded downstream by `MAX_CONTENT_TEXT_LENGTH` (50KB) in `ai-analysis.ts`.

**Affected code**

- `api/src/routes/ai.ts` (~L30–77)
