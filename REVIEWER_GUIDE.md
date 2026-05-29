# Reviewer Guide

Start here for Week 5 FleetGraph review.

## Start Here

| Need | Go here |
| --- | --- |
| Final FleetGraph submission | [`FLEETGRAPH.md`](./FLEETGRAPH.md) |
| Pre-search checklist | [`PRESEARCH.md`](./PRESEARCH.md) |
| Latest proof packet | [`my-docs/evidence/fleetgraph-proof/latest.md`](./my-docs/evidence/fleetgraph-proof/latest.md) |
| Product-surface eval | [`my-docs/evals/fleetgraph-product-surface/latest.md`](./my-docs/evals/fleetgraph-product-surface/latest.md) |
| Observability dashboard artifact | [`web/public/fleetgraph-observability/index.html`](./web/public/fleetgraph-observability/index.html) |

Public demo URLs:

| Surface | URL |
| --- | --- |
| Web app | https://ship-shape-web.onrender.com/ |
| API health | https://ship-shape-api.onrender.com/health |
| Static observability dashboard | https://ship-shape-web.onrender.com/fleetgraph-observability/ |

Reviewer login:

- Deployed: use reviewer credentials supplied out of band. Do not publish a static deployed password in the submission.
- Local demo seed: use `fleetgraph.reviewer@ship.local`; the local-only default password is intentionally not a deployed credential.

## Claims Matrix

| Claim | Required proof |
| --- | --- |
| Deployed proactive worker runs without a user | `render.yaml` has `FLEETGRAPH_WORKER_ENABLED=true`, and proof packet shows recent completed `fleetgraph_worker_ticks` |
| Blocked, stale, and at-risk are all deployed signals | Proof packet deployed evidence lists `blocked`, `stale`, and `at_risk` |
| No skipped attention-loop proof | `pnpm fleetgraph:proof -- --mode both --with-e2e` and `pnpm fleetgraph:proof:check` pass without `--allow-blocked` or `--allow-risk` |
| Same graph architecture | `api/src/fleetgraph/core.ts` shared `runFleetGraph` runtime handles proactive and on-demand triggers |
| Embedded context chat | `web/src/components/FleetGraphChatProbe.tsx` and `POST /api/fleetgraph/chat` |
| Human-in-the-loop gate | Focused E2E and chat response show approval required before mutation/contact; source issue remains unchanged |
| Real Ship data | Demo/proof uses Ship documents, issue iterations, associations, FleetGraph events/findings/runs, and worker tick tables |

## 5-Minute Walkthrough

1. Open Ship and log in as the reviewer.
2. Open the left rail notifications.
3. Confirm blocked, stale, and at-risk signals are present when deployed proof data has been seeded and the worker has run.
4. Select a FleetGraph attention notification.
5. Confirm the card shows a compact signal, source issue, reason, owner/context when known, and useful next step.
6. Open the source issue from the notification.
7. Open contextual chat from the notification/source.
8. Ask `What should I do?`.
9. Confirm chat explains the current finding from attached context and shows human approval is required before mutation/contact.
10. Confirm the source issue state remains unchanged unless the user explicitly edits it.

Expected loop:

`Ship issue state -> attention event/worker or repair scan -> FleetGraph finding -> left-rail notification -> source issue -> context chat -> human gate`

## Primary Proof Commands

Run local deterministic gates:

```bash
pnpm fleetgraph:proof:test
DATABASE_URL=postgresql://ship:ship_dev_password@localhost:5432/ship_test_audit \
pnpm --filter @ship/api test \
  src/fleetgraph/eval/eval.test.ts \
  src/fleetgraph/eval/executable-golden-cases.test.ts \
  src/fleetgraph/eval/product-surface.test.ts \
  src/fleetgraph/api-contract.test.ts
```

Run final proof packet with deployed DB evidence and focused E2E:

```bash
FLEETGRAPH_PROOF_API_URL=https://ship-shape-api.onrender.com \
FLEETGRAPH_PROOF_WEB_URL=https://ship-shape-web.onrender.com \
FLEETGRAPH_PROOF_RENDER_POSTGRES=ship-shape-db \
E2E_RESULTS_DIR=test-results/fleetgraph-proof \
pnpm fleetgraph:proof -- --mode both --with-e2e

pnpm fleetgraph:proof:check
```

Do not use `--skip-tests`, omit `--with-e2e`, or pass `--allow-blocked` / `--allow-risk` for final submission.

## Deployed SQL Checks

```sql
SELECT id, instance_id, status, started_at, completed_at,
       workspace_count, detector_decision_count, result_count, model_call_count,
       error_metadata, audit_metadata
FROM fleetgraph_worker_ticks
ORDER BY started_at DESC
LIMIT 10;

SELECT COUNT(*) AS stuck_running_ticks
FROM fleetgraph_worker_ticks
WHERE status = 'running'
  AND deadline_at < now();

SELECT status, COUNT(*), MIN(created_at), MAX(created_at)
FROM fleetgraph_attention_events
GROUP BY status
ORDER BY status;

SELECT COALESCE(run_metadata->>'signalType', 'blocked') AS signal_type,
       COUNT(*), MAX(updated_at)
FROM fleetgraph_findings
WHERE status IN ('open', 'needs_confirmation', 'error')
GROUP BY COALESCE(run_metadata->>'signalType', 'blocked')
ORDER BY signal_type;
```

## Rollback

Fast rollback is setting `FLEETGRAPH_WORKER_ENABLED=false` and redeploying/restarting the API. That stops future proactive ticks. Existing FleetGraph-owned findings/runs/ticks remain audit evidence and should be dismissed or suppressed only through FleetGraph-owned paths; do not mutate Ship source records as rollback cleanup.

## Implementation Anchors

| Boundary | File |
| --- | --- |
| Shared graph runtime | [`api/src/fleetgraph/core.ts`](./api/src/fleetgraph/core.ts) |
| API routes | [`api/src/routes/fleetgraph.ts`](./api/src/routes/fleetgraph.ts) |
| Worker execution | [`api/src/fleetgraph/execution/worker.ts`](./api/src/fleetgraph/execution/worker.ts) |
| Shared wire types | [`shared/src/types/fleetgraph.ts`](./shared/src/types/fleetgraph.ts) |
| Notifications UI | [`web/src/components/FleetGraphNotificationsProbe.tsx`](./web/src/components/FleetGraphNotificationsProbe.tsx) |
| Context chat UI | [`web/src/components/FleetGraphChatProbe.tsx`](./web/src/components/FleetGraphChatProbe.tsx) |
