# Reviewer Guide

Start here for Week 5 FleetGraph review.

## Start Here

| Need | Go here |
| --- | --- |
| Final FleetGraph submission | [`FLEETGRAPH.md`](./FLEETGRAPH.md) |
| Pre-search checklist | [`PRESEARCH.md`](./PRESEARCH.md) |
| Latest observability run | [`my-docs/evals/fleetgraph-observability/run-2026-05-28T22-44-44-783Z.md`](./my-docs/evals/fleetgraph-observability/run-2026-05-28T22-44-44-783Z.md) |
| Observability dashboard artifact | [`web/public/fleetgraph-observability/index.html`](./web/public/fleetgraph-observability/index.html) |
| Product-surface eval | [`my-docs/evals/fleetgraph-product-surface/latest.md`](./my-docs/evals/fleetgraph-product-surface/latest.md) |
| End-to-end loop proof | [`e2e/fleetgraph-attention-loop.spec.ts`](./e2e/fleetgraph-attention-loop.spec.ts) |

Public demo URLs:

| Surface | URL |
| --- | --- |
| Web app | https://ship-shape-web.onrender.com/ |
| API health | https://ship-shape-api.onrender.com/health |
| Static observability dashboard | https://ship-shape-web.onrender.com/fleetgraph-observability/ |

Local reviewer login after `pnpm demo:seed`:

- Email: `fleetgraph.reviewer@ship.local`
- Password: `admin123`

## 5-Minute Walkthrough

1. Open Ship and log in as the reviewer.
2. Open the left rail notifications.
3. Select a FleetGraph attention notification.
4. Confirm the card shows a compact signal, source issue, reason, owner/context when known, and useful next step.
5. Open the source issue from the notification.
6. Open contextual chat from the notification/source.
7. Ask `What should I do?`.
8. Confirm chat explains the current finding from attached context and shows human approval is required before mutation/contact.
9. Confirm the source issue state remains unchanged unless the user explicitly edits it.

Expected loop:

`Ship issue state -> attention event/worker -> FleetGraph finding -> left-rail notification -> source issue -> context chat -> human gate`

## Requirement Map

| Week 5 requirement | Proof |
| --- | --- |
| Proactive graph path | LangSmith proactive create trace: https://smith.langchain.com/public/ad258212-2b31-4c36-88f2-ad91401a7d86/r |
| On-demand graph path | LangSmith explain trace: https://smith.langchain.com/public/2cccea43-ab44-4228-9f04-5f4b331aed3a/r |
| Same graph architecture | `api/src/fleetgraph/core.ts` shared `runFleetGraph` LangGraph runtime |
| Embedded context chat | `web/src/components/FleetGraphChatProbe.tsx` and `POST /api/fleetgraph/chat` |
| Proactive no-user-present execution | `api/src/fleetgraph/execution/worker.ts` and durable `fleetgraph_attention_events` |
| Real Ship data | Detector reads Ship issue/week/iteration context before creating FleetGraph findings |
| Human-in-the-loop gate | `e2e/fleetgraph-attention-loop.spec.ts` asserts approval is required and issue state stays blocked |
| Notifications accessible in UI | `web/src/components/FleetGraphNotificationsProbe.tsx` and `GET /api/fleetgraph/notifications` |
| Observability traces | `my-docs/evals/fleetgraph-observability/run-2026-05-28T22-44-44-783Z.md` |
| Product copy quality | `my-docs/evals/fleetgraph-product-surface/latest.md`: 6 pass, 0 fail |
| Cost reporting | `FLEETGRAPH.md` Cost Analysis section |
| Final required sections | `FLEETGRAPH.md` contains Agent Responsibility, Graph Diagram, Use Cases, Trigger Model, Test Cases, Architecture Decisions, Cost Analysis |

## Primary Traces

Use these as the primary shared trace evidence:

| Path | Decision | LangSmith | Langfuse |
| --- | --- | --- | --- |
| Proactive | `create_finding` | https://smith.langchain.com/public/ad258212-2b31-4c36-88f2-ad91401a7d86/r | https://us.cloud.langfuse.com/project/cmpq0gd7n014vad0ejpkkkpqo/traces/b4c5639bc035f5e58b9c5a12cacd4d0c |
| On-demand | `explain` | https://smith.langchain.com/public/2cccea43-ab44-4228-9f04-5f4b331aed3a/r | https://us.cloud.langfuse.com/project/cmpq0gd7n014vad0ejpkkkpqo/traces/c9c551348ef3e1a8cafac71bb0f697e9 |

Latest run summary:

- Generated: 2026-05-28T22:44:44.783Z.
- Traces: 4.
- Model calls: 1.
- Total tokens: 180.
- Estimated cost: `$0.0000675`.
- Score pass/fail: 32/0.
- Provider coverage: LangSmith 4/4, Langfuse 4/4.
- Non-primary smoke/refine LangSmith share attempts returned provider 404s; they are recorded as provider-friction dataset items, not primary reviewer proof.

## Verification Commands

Run the submission doc/proof checks:

```bash
pnpm docs:check:strict
pnpm fleetgraph:eval:surface
pnpm fleetgraph:observe --max-runs 5
pnpm type-check
```

Run the targeted E2E loop when local Playwright infrastructure is ready:

```bash
pnpm test:e2e:setup
pnpm test:e2e:run -- e2e/fleetgraph-attention-loop.spec.ts
```

Run the demo seed locally:

```bash
pnpm demo:seed
```

## Implementation Anchors

| Boundary | File |
| --- | --- |
| Shared graph runtime | [`api/src/fleetgraph/core.ts`](./api/src/fleetgraph/core.ts) |
| API routes | [`api/src/routes/fleetgraph.ts`](./api/src/routes/fleetgraph.ts) |
| Worker execution | [`api/src/fleetgraph/execution/worker.ts`](./api/src/fleetgraph/execution/worker.ts) |
| Shared wire types | [`shared/src/types/fleetgraph.ts`](./shared/src/types/fleetgraph.ts) |
| Notifications UI | [`web/src/components/FleetGraphNotificationsProbe.tsx`](./web/src/components/FleetGraphNotificationsProbe.tsx) |
| Context chat UI | [`web/src/components/FleetGraphChatProbe.tsx`](./web/src/components/FleetGraphChatProbe.tsx) |
