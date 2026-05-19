# Temporary Deployment Plan

This is a disposable planning document. It exists to align on what we are deploying, why we are deploying it early, and what counts as enough validation. Delete or replace it once the real deployment checklist is settled.

## Recommendation

Use the repo's intended AWS deployment path:

- API: Elastic Beanstalk
- Frontend: S3 + CloudFront
- Database: Aurora/PostgreSQL
- Config and secrets: SSM/Secrets Manager
- First target: `shadow`/UAT, not production

This is the right early move because it exercises the production-shaped risks that local dev cannot prove: migrations on startup, CloudFront routing, cookies/CORS, API-to-frontend environment alignment, WebSocket upgrades, and database connectivity.

## Why Not A Shortcut Deploy

A Render/Fly/Railway-style deploy would get a public URL faster, but it would avoid the infrastructure shape already present in the repo. That is useful only if the goal is a throwaway demo URL.

A static-only frontend deploy is the wrong answer. ShipShape is not meaningful without auth, Postgres, REST endpoints, Yjs collaboration, and persisted editor state.

A single VPS would be simple, but it would create custom operations work while ignoring the existing Terraform, S3/CloudFront, EB, and SSM design.

## Deployment Strategy

Deploy `shadow` first and make production a promotion, not a separate project.

1. Confirm infrastructure and config are available for `shadow`.
2. Deploy API with `./scripts/deploy.sh shadow`.
3. Deploy frontend with `./scripts/deploy-web.sh shadow`.
4. Validate the app in a browser, not just with curl.
5. Fix deployment-specific issues before continuing feature/audit improvement work.
6. Promote the same pattern to `prod` only after shadow passes the browser checklist.

## Critical Deployment Risks

The biggest risk is WebSocket routing through CloudFront. The SPA can load while collaboration is broken.

CloudFront must route these paths to the API origin and forward upgrade headers/cookies:

- `/collaboration/*`
- `/events`

Success means the browser Network tab shows WebSocket `101 Switching Protocols` for collaboration/events traffic, and same-document editing syncs across two browser sessions.

The second risk is database migration safety. The API container runs migrations on startup. That is convenient, but it means a bad migration can block deploy or mutate the target database immediately.

The third risk is environment drift. API URL, WebSocket URL, CORS origin, cookie security settings, database URL, and secrets must agree for the deployed domain.

## Major Pages To Validate

"Every major page" means every page that represents a primary product surface or exercises a distinct deployment dependency. It does not mean every nested route, empty state, admin corner, or duplicate detail view.

Validate these pages:

- `/login`  
  Proves the deployed frontend can reach auth endpoints, receive cookies, and enter the app.

- `/docs`  
  Proves the primary document list loads, REST list endpoints work, and the deployed SPA route is handled correctly.

- `/documents/:id`  
  Proves the editor loads, Yjs state syncs, document body persistence works, and `/collaboration/*` WebSocket routing is correct.

- `/issues`  
  Proves the global issue list works, larger payloads load, and issue metadata renders after deployment.

- `/documents/:programId/issues` or a program Issues tab  
  Proves program-scoped issue discovery works, not just the global issue list.

- `/projects`  
  Proves project planning data loads and associations are intact.

- `/my-week`  
  Proves the authenticated dashboard/week flow works and the weekly planning endpoints can read their JSONB-backed data.

- A representative program page  
  Proves the Program -> Project -> Week -> Issue hierarchy is navigable in the deployed app.

Optional, if time allows:

- Settings/admin surfaces, if present in the current navigation.
- File upload/download, if it is part of the demo story.
- Public feedback/setup routes, if they are intended to be externally reachable.

## Browser Acceptance Checklist

For each major page:

- Page loads from a cold browser session.
- No blank screen.
- No fatal browser console errors.
- No unexpected `404`, `500`, CORS, or mixed-content failures.
- Authenticated API calls return `200` or expected domain-specific statuses.
- Refreshing the route directly does not break SPA routing.

For editor/collaboration:

- Open the same document in two sessions.
- Type in session A.
- Confirm session B receives the edit.
- Refresh both sessions and confirm the content persists.
- Confirm WebSocket requests use `101 Switching Protocols`.

For data:

- Use source-of-truth-scale seed data where possible: 500+ documents, 100+ issues, 20+ users, and 10+ weeks/sprints.
- Do not validate against an empty demo database unless the goal is only infrastructure smoke testing.

## Early Constraints

Keep the first deployment boring:

- One API instance unless sticky sessions/shared collaboration are confirmed.
- No horizontal scaling claim for collaboration yet.
- No production promotion until WebSockets pass.
- No destructive database testing against the deployment database.
- No feature polishing before the deployed login/docs/editor/issues path is proven.

The reason for one API instance is Yjs collaboration state: the API keeps in-memory document rooms. Multiple EB instances can split collaborators across different process memory unless routing is sticky or collaboration is redesigned around shared state/pubsub.

## Definition Of Done For Early Deployment

Early deployment is done when:

- Shadow URL is reachable.
- Login works.
- `/docs`, `/issues`, `/projects`, `/my-week`, and one program flow load.
- One document can be edited and refreshed with persisted content.
- Two sessions can collaboratively edit the same document.
- `/events` and `/collaboration/*` WebSockets work through the deployed routing path or an intentional `VITE_WS_URL` fallback.
- API health is green.
- Any deployment-specific issues are captured before production promotion.

## Open Questions

- Do we already have working AWS credentials and Terraform state for `shadow`?
- Is CloudFront currently configured for both `/events` and `/collaboration/*`?
- Should `VITE_WS_URL` bypass CloudFront for the first deploy, or should we force CloudFront WebSocket routing now?
- What seed data should shadow use: copied dev data, audit-scale generated data, or a clean demo dataset?
- Is the expected final deliverable a production-shaped deployment or just a public URL?
