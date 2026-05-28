# FleetGraph Operating Definition

This file explains what FleetGraph is trying to become. It is not an implementation plan, feature checklist, or product requirements document.

The canonical assignment context is everything in `my-docs/project-weeks-sot/week-5/w5-specs/`. Those files are the Week 5 specs even when their filenames say PRD, PDF, advisor note, or something else. Treat them as the directional source of truth for what Gauntlet AI asked Ship to prove.

Existing FleetGraph code, UI, database tables, traces, and docs are evidence, not authority. Read them when implementation needs archaeology, but do not let them steer the product just because they already exist. Some pieces may be useful. The previous direction as a whole was misaligned.

Resist new FleetGraph-specific document properties, finding fields, or notification categories by default. Use existing Ship state first; add new properties only when there is a clear product advantage that cannot be represented by the source issue, associations, ownership, blocker iterations, or FleetGraph-owned finding state.

## What FleetGraph Means

FleetGraph is Ship's project intelligence and attention engine.

It is not a graph visualization. It is not a standalone chatbot. It is not a dashboard with AI copy. It is the system that notices important project state, reasons about why it matters, surfaces it to the right people, and gives them a direct way to understand or act.

The Week 5 spec's durable idea is two modes through one intelligence layer:

- Proactive push: Ship notices something worth attention without a user asking.
- Contextual pull: a user asks from inside the product, and the system starts from the issue, document, week, project, program, workspace, or notification they are already looking at.

## Product Shape

FleetGraph should move toward one engine with two main surfaces.

Notifications are the attention surface. They tell connected people that something needs attention.

Chat is the contextual discussion surface. It helps users ask questions, understand provenance, inspect current context, and decide what to do next.

These are not separate products. A notification should be able to open chat with the relevant context attached. Chat should be able to explain a notification without forcing the notification card to display every detail.

## Notifications

Notifications are generic infrastructure. FleetGraph is one producer.

A notification should have a source, recipients, timestamp, minimal display body, and actions. The notification system should not depend on the notification being agent-generated. Future producers may be agent runs, cron jobs, workflow checks, system events, or purely programmatic detectors.

For the first FleetGraph producer, blocked issues are the forcing case.

A blocked issue notification exists because the source issue is blocked. It should stay visible while the issue remains blocked. It should disappear from active notifications when the issue is no longer blocked.

Do not create a shadow blocker lifecycle unless there is a clear product reason. In particular, do not add dismiss, snooze, acknowledge, accepted-risk, or parallel resolved states by default. The source issue state is the truth: blocked or not blocked.

Notification cards should stay minimal until more detail proves necessary. Start with what helps a person recognize and reach the problem:

- issue title
- blocked age
- connected owner or assignee
- project/program context when available
- short blocker text when available
- actions to open the source and discuss it in chat

Detailed provenance belongs in the source issue and in chat context, not on the first notification card.

## Recipients

Notifications should go to connected people, not the whole workspace by default.

For blocked issues, start tight:

- issue assignee or owner
- project owner or PM

Nothing important should be orphaned. If no primary connected person can be found, fall back to:

- program owner
- workspace admins

Over time, routing can loosen if the product proves that more people need visibility. Do not broaden recipients just to make the system look active.

## Chat Context

Chat should be context-aware by construction.

When opened from a page, it should know the current issue, document, week, project, program, or workspace context. When opened from a notification, it should attach a richer context capsule than the visible card shows.

For blocked notifications, that capsule should be able to support questions like:

- Why is this blocked?
- How did it get here?
- Who can unblock it?
- What changed since the last update?
- What should I do next?

The user interface may show compact context chips. It should not dump all hidden context into the visible chat unless the user asks.

## Design Bias

Build the smallest thing that proves the loop.

First prove that a real project condition can become a notification for the right connected people, that the notification can open the source, and that it can move into chat with useful context.

Ordering, aging buckets, escalation ladders, dismissal semantics, filtering, and richer actions are later product decisions. They should be informed by the first working loop, not designed into the foundation prematurely.

Complexity must justify itself. If a proposed feature does not make the attention loop clearer, faster, or more trustworthy, leave it out.
