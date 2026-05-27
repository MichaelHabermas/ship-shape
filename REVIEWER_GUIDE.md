# Reviewer Guide

## What To Review

FleetGraph MVP: Ship detects urgent/high active-week issues that are blocked, creates a FleetGraph finding, shows it in context, explains why it was flagged, lets you refine the draft, and does not mutate Ship or contact anyone.

It is not a chatbot. It is not a global inbox. It is not autonomous escalation.

## Start

```bash
pnpm install
pnpm db:migrate
pnpm fleetgraph:demo
pnpm dev
```

`pnpm fleetgraph:demo` prints:

- reviewer email
- reviewer password
- active week URL
- positive issue URLs
- negative-control URLs

Open the web app, sign in with the printed reviewer login, then use the printed URLs.

Default local app:

```text
http://localhost:5173
```

## Fast Path

1. Open the printed `activeWeek` URL.
2. Look for the FleetGraph active-week cue/banner.
3. Open `positiveIssueA`: `FG Demo - SSO cert rotation blocked`.
4. Confirm the FleetGraph card says why the issue was flagged.
5. Click `Why flagged?`.
6. Confirm the answer cites the blocked issue/week evidence.
7. Refine the draft.
8. Confirm only the FleetGraph draft changes.
9. Dismiss the finding.
10. Confirm the issue itself is not changed.

Expected result: FleetGraph prepares the unblock action; the human stays in control.

## What Should Appear

On a flagged issue or active week, the FleetGraph surface should show:

- blocked urgent/high active-week work
- blocker summary
- issue/week context
- proposed smallest useful recipient or role
- recommended next human action
- draft unblock message
- `Why flagged?`
- draft refinement
- dismiss

It should not show fake certainty, send controls that actually send, or claims that Ship was mutated.

## Demo Data

Positive cases:

- `FG Demo - SSO cert rotation blocked`
- `FG Demo - Data export contract blocked`

Negative controls:

- urgent active work that is not blocked
- blocked issue with no blocker explanation
- medium-priority blocked issue
- done issue with old blocker history
- inactive-week blocked issue
- duplicate open finding control
- private blocked source control

Only the positive urgent/high blocked active-week issues should create normal MVP findings.

## Evidence Links

Main writeup:

- `FLEETGRAPH.md`
- `PRESEARCH.md`

Week 5 source of truth:

- `my-docs/project-weeks-sot/week-5/`

Reviewer-safe trace examples are listed in `FLEETGRAPH.md` under `Test Cases`.

## Useful Commands

```bash
pnpm fleetgraph:demo -- --capture-traces
pnpm fleetgraph:detector -- --workspace-id <workspace-id>
pnpm type-check
pnpm test
```

Use `--capture-traces` only when LangSmith/LangChain tracing is configured. Without tracing credentials, the MVP still runs and records local trace metadata.

## MVP Boundary

FleetGraph may create/update/dismiss FleetGraph-owned findings and drafts.

FleetGraph may not:

- assign work
- change issue state, priority, owner, due date, or week
- edit Ship documents
- post comments
- send Slack/email
- escalate to a person
- accept project risk

If you see any of those happen without explicit human approval, that is a bug.
