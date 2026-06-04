# Invalidated mock integration evidence (2026-06-04)

These JSON artifacts recorded `status: passed` from `pnpm plugforge:integrations` while
**mocking Slack API calls**, **seeding OAuth tokens via SQL**, and **synthesizing GitLab webhooks**.

They do not prove live integrations. The proof ledger demoted related atoms to `missing` or
`partial` with `proof_tier: live_required`. Do not move these back or cite them as proof.

Live replacement evidence must land under `my-docs/evidence/plugforge-integrations/live/` with
inspectable external participation (real Slack channel ts, real GitLab delivery, archived CLI
`verified: true` webhook JSON, or deployed `/sdk-demo` gate).
