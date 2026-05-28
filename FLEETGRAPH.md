# FleetGraph Current Compass

FleetGraph is Ship's internal project intelligence and attention engine.

It is not user-facing branding, a graph visualization, a standalone chatbot, or a dashboard with AI copy. It is the system that notices important project state, reasons from real Ship data, surfaces useful findings to connected people, and gives them a direct way to understand what to do next.

This file is a compass, not a chronicle. It should stay short. History, traces, eval output, reviewer proof, and implementation archaeology belong in linked evidence files.

## Source Truth Order

When sources disagree, use this order:

1. Week 5 specs in `my-docs/project-weeks-sot/week-5/w5-specs/`
2. FleetGraph operating definition in `my-docs/project-weeks-sot/week-5/fleetgraph/AGENTS.md`
3. Latest durable decisions in `my-docs/project-weeks-sot/week-5/DECISION_LOG-w5.md`
4. Current code, tests, traces, persisted runs, and eval reports

Existing code and old docs are evidence, not authority. Do not preserve an old surface just because it exists.

## Active Week 5 Loop

The current proof loop is:

1. A real Ship issue has an attention signal: blocked, long-stale active work, or current-week high-priority risk.
2. FleetGraph detects it from existing Ship issue/week/iteration data.
3. The finding routes to the smallest useful connected audience.
4. The left rail shows a compact notification.
5. The notification can open the source issue.
6. The notification can open contextual chat with the source attached.
7. Chat explains the situation from the same graph architecture used by proactive mode.
8. Any Ship mutation or contact with another person remains behind a human gate.

The first slice is not "make an AI card." It is "make project attention become useful decision support."

## Hard Rules

- FleetGraph is internal terminology only.
- Proactive mode and on-demand chat use the same graph boundary.
- Use real Ship data, not fake UI placeholders.
- Prefer existing Ship fields and associations before inventing FleetGraph-specific properties.
- Blocked issue notification eligibility is `issue.state = blocked`.
- Do not require current week, urgent/high priority, owner, or blocker text.
- The source issue state is canonical. Do not create a shadow blocker lifecycle by default.
- Human gates prevent Ship mutation or contacting people without approval.
- Reviewer proof belongs in logs, persisted runs, traces, tests, screenshots, and docs.
- Product UI exists for useful user decisions, not reviewer proof.

## Current Product Surface

Notifications live in the left rail. FleetGraph is one producer of generic notifications.

An attention notification should stay compact:

- presentational signal chip plus raw issue title
- age
- owner or assignee, or `-` only when no owner/team exists
- project or context
- concise reason or latest non-empty blocker text when present
- source and chat actions

Chat is contextual by construction. Current page context is always present and cannot be removed. Extra contexts can be added or removed. Clicking an extra context navigates to that source. If an extra context becomes current, the previous current becomes an extra chip. Never render duplicate chips for the same source. The current context chip uses a small empty green ring marker, not `Current -`.

## Future Choice Test

Future product choices should be judged by whether they make the active loop clearer, faster, or more trustworthy.

A good FleetGraph slice should improve at least one of these:

- detecting real project state
- routing to the right connected people
- preserving current context across notification and chat
- explaining evidence without leaking private or irrelevant details
- helping the user decide the next useful action
- proving graph path differences, gates, provenance, or latency outside the product UI

If a choice mostly adds surface area, labels, or proof scaffolding, leave it out.

## Current Evidence

Key implementation boundaries:

- `api/src/fleetgraph/core.ts`
- `api/src/fleetgraph/detection/`
- `api/src/fleetgraph/persistence.ts`
- `api/src/routes/fleetgraph.ts`
- `api/src/fleetgraph/runtime/`
- `web/src/components/FleetGraphNotificationsProbe.tsx`
- `web/src/components/FleetGraphChatProbe.tsx`

Key proof surfaces:

- executable FleetGraph evals in `api/src/fleetgraph/eval/`
- product-surface eval report at `my-docs/evals/fleetgraph-product-surface/latest.md`
- persisted `fleetgraph_runs`
- focused FleetGraph tests
- reviewer guide and screenshots when preparing a walkthrough

As of the latest product-surface report, current authored and runtime outputs pass. Historical persisted failures remain trend data only; they are not present-tense user-facing failures unless a current run reproduces them.

## Current Bottleneck

The weakest remaining product question is not whether FleetGraph can detect an attention signal. It can.

The bottleneck is whether the full loop feels like project intelligence:

Ship signal -> routed notification -> source -> contextual chat -> useful next action

Next slices should move that whole loop. Prefer work that proves lifecycle correctness, routing, context transfer, graph path differences, human gates, real-data provenance, and low detection latency together. Avoid slices that only make the card prettier.
