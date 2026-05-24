**Description**

`POST /api/feedback` is unauthenticated, no CSRF, creates real triage issues when program has `public_feedback_enabled`. Only general API rate limit (100 req/min prod).

**Affected code**

- `api/src/routes/feedback.ts` — `publicFeedbackRouter.post('/')` (~L66+)
- `api/src/app.ts` — mounted before auth (~L208); general `apiLimiter` (~L112–119)

**Attack scenario**

Mass-create triage issues; pollute ticket numbers; DoS triage workflows on enabled programs.

**Recommended fix**

Dedicated rate limit, CAPTCHA, or honeypot; per-program throttle.
