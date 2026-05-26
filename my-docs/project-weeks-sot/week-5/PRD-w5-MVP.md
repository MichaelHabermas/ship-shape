# PRD - FleetGraph Week 5 MVP

## 1. Executive Summary

**Problem Statement:** Ship records project work, but urgent/high work can become blocked inside an active week without the right person noticing in time. PMs should not have to poll dashboards to discover that committed execution is drifting.

**Proposed Solution:** FleetGraph detects urgent/high active-week issues with a real blocker signal, creates an action-ready finding, shows it in the affected issue/week context, and lets the user ask why, refine the draft, or dismiss the finding without allowing FleetGraph to mutate Ship or contact anyone autonomously. "Action-ready" means FleetGraph prepares the decision surface: evidence, stakeholder role candidates, a safe next-action class, and a draft follow-up. It does not mean FleetGraph knows or executes the correct human decision.

**Success Criteria:**

- A qualifying blocked-work signal creates a visible FleetGraph finding within 5 minutes.
- At least two shared trace links show distinct proactive and on-demand graph paths; the traces must show different branch decisions, not only the same pipeline with different metadata.
- FleetGraph performs zero autonomous Ship mutations and sends zero outbound messages.
- Each MVP finding includes a decision packet: visible evidence, summary, stakeholder role candidates, recommended next human decision/action class, draft message, proposed recipient rationale, uncertainty/missing-context notes, trace metadata, and a human gate.
- The finding is discoverable from an in-app proactive surface without requiring the PM to already know which issue to open.
- The MVP runs against real Ship data, not mocks or hard-coded fixture responses.

## 2. User Experience & Functionality

**User Personas:**

- PM: primary user. Needs to notice blocked active-week work early and decide the next unblock action.
- Engineer: secondary user. Needs to understand why assigned work was flagged and what context is missing.
- Director: post-MVP user. Needs pattern and escalation visibility after the ledger has enough findings.

**User Stories:**

- As a PM, I want FleetGraph to surface blocked urgent/high active-week work without being asked so that I can intervene before carryover is inevitable.
- As a PM, I want to open a FleetGraph finding and see why it matters now so that I can make a fast, evidence-backed decision.
- As a PM, I want to refine or dismiss a drafted unblock action so that FleetGraph reduces clerical work without taking control away from me.
- As an engineer, I want to ask why my assigned issue was flagged so that I can understand the blocker and next useful step.

**Acceptance Criteria:**

- A FleetGraph finding appears on the affected issue and active week context when an issue qualifies.
- A lightweight proactive UI surface makes the finding noticeable from the active week or nearby navigation context, such as a banner, badge/count, or notification item. MVP does not require a global FleetGraph inbox.
- The finding explains the issue, active week, latest blocker signal, severity, confidence, recommended next human decision/action class, proposed smallest useful audience, and why that audience is smaller/better than the obvious broader audience.
- The finding includes a draft unblock message/action but does not send, post, assign, move, or update Ship records.
- The human gate shows the exact proposed action, exact proposed recipient or role, exact draft text, affected source objects, why approval is required, and approve/refine/dismiss controls. If send/post/mutate execution is not implemented in MVP, approval must still remain a recorded blocked consequence rather than silently performing the action.
- On-demand "why was this flagged?" uses the current issue/week context and the existing finding state.
- Draft refinement updates only FleetGraph-owned draft content.
- Dismiss updates only FleetGraph finding status.
- Duplicate candidates update or quietly suppress the existing open finding instead of creating duplicate open findings.
- A user who cannot read the source issue/week cannot read the finding.

**Non-Goals:**

- Multiple proactive detectors.
- Global FleetGraph inbox, dashboard, or standalone chatbot.
- Slack, email, issue comment, or external notification delivery.
- Autonomous issue assignment, priority/status changes, sprint/week moves, due date changes, document edits, or escalation.
- Snooze, material-change reopen, DB lease, event bus, director rollups, or broad workspace chat.

## 3. AI System Requirements

**Tool Requirements:**

- LangGraph and LangSmith, or equivalent graph execution and shared tracing, are required for MVP evidence.
- The current API package does not already include LangGraph/LangSmith dependencies; adding graph/tracing dependencies is part of implementation, not a configuration toggle.
- Deterministic SQL candidate selection must run before model reasoning.
- The model receives bounded context only: source issue, active week, current blocked state, latest blocker iteration when present, assignee/owner display context, existing FleetGraph finding state, and permission-filtered evidence.

**Evaluation Strategy:**

- Candidate detection: urgent/high active-week issues with `issue.state = blocked` qualify. `issue_iterations.blockers_encountered` provides explanation/history for the block. Non-urgent/non-high, inactive-week, done/cancelled, and unblocked issues do not qualify.
- Evidence grounding: every user-visible claim must map to source issue/week/iteration evidence visible to the current user.
- Trace evidence: one proactive trace must create or update a finding; one on-demand trace must explain or refine an existing finding. Preferred MVP evidence is three traces: proactive create, on-demand explain/refine, and proactive duplicate/update or quiet exit.
- Quiet exits: duplicate and resolved/non-qualifying candidates must produce quiet/update traces without duplicate open findings.
- Safety: draft refinement, explanation, and dismiss actions must not mutate source issue/week records or contact people.

## 4. Technical Specifications

**Architecture Overview:**

FleetGraph MVP is one vertical slice:

```text
2-minute API worker
-> deterministic SQL candidate query
-> shared FleetGraph graph
-> FleetGraph-owned finding/run persistence
-> issue/week contextual UI
-> on-demand explain/refine/dismiss actions
```

The LLM does not decide what to scan. SQL chooses bounded candidates first. The graph does PM preparation work after eligibility is proven: explain why the blocker matters, gather visible evidence, identify stakeholder role candidates, choose a safe next-action class from a constrained set, and draft a follow-up for human review.

**Action-Ready Finding Definition:**

An MVP finding is action-ready when it gives a PM enough context to make the next decision without scanning multiple Ship surfaces. It must not present FleetGraph's recommendation as authoritative. It must show what FleetGraph knows, what it inferred, what is uncertain, and which human decision is still required.

The finding must be a decision packet, not a generic alert. It should answer: what changed, why it matters now, who can move it forward, why FleetGraph chose that person/role, what the smallest useful next action is, what evidence supports it, what FleetGraph is uncertain about, and what exact consequence is waiting on human approval.

Allowed MVP action classes:

- Ask assignee for blocker detail.
- Ask accountable owner for a scope/priority decision.
- Ask visible dependency owner or context source for ETA/decision.
- Recommend a carryover/scope tradeoff discussion.
- Dismiss as no longer relevant.
- Mark as needs human triage when evidence is too thin.

Stakeholder role candidates:

- Builder/maker: issue assignee, recent updater, or person with active issue iteration.
- Work owner: issue owner when present; otherwise project owner/accountable person.
- Week owner: active week `owner_id`.
- Decision-maker: project/program `accountable_id`, PM, lead, or director depending on scope/severity.
- Context source: recent contributors, linked-document authors, or standup authors; useful for evidence, not default recipients.
- Dependency candidate: visible person/team named in blocker text, linked context owner, or associated project/program owner.

FleetGraph should prefer the smallest useful audience and lower confidence when the graph cannot identify a role from visible Ship data.

**Data Model:**

- Add dedicated FleetGraph persistence; do not add a new `document_type`.
- Required tables:
  - `fleetgraph_findings`
  - `fleetgraph_runs`
- Required finding fields:
  - `workspace_id`
  - `source_document_id`
  - `source_sprint_id`
  - `dedupe_key`
  - `status`
  - `severity`
  - `confidence`
  - `summary`
  - `evidence_json`
  - `recommended_action_class`
  - `required_human_decision`
  - `draft_message`
  - `proposed_recipient_json`
  - `trace_url` or `trace_id`
  - timestamps
- Open finding dedupe key:

```text
blocked-important-issue:{workspace_id}:{issue_id}:{sprint_id}
```

- MVP statuses:
  - `open`
  - `dismissed`
  - `resolved`

**Candidate Predicate:**

A proactive candidate qualifies when all are true:

- Source issue is a `documents` row with `document_type = 'issue'`.
- Issue priority is `urgent` or `high`.
- Issue state is not `done` or `cancelled`.
- Issue is associated to the active week through `document_associations.relationship_type = 'sprint'`.
- The associated week is the current active week using existing workspace/week semantics.
- The issue has `state = blocked`. Recent `issue_iterations.blockers_encountered` text is used as blocker evidence when present.
- No open finding already exists for the same dedupe key.

**Integration Points:**

- API worker:
  - Runs inside the existing API process only when `FLEETGRAPH_WORKER_ENABLED=true`.
  - Polls every 2 minutes.
  - Uses an in-process tick guard plus DB uniqueness for dedupe.
- API routes:
  - `GET /api/fleetgraph/findings?source_document_id=...`
  - `POST /api/fleetgraph/on-demand`
  - `POST /api/fleetgraph/findings/:id/dismiss`
  - `POST /api/fleetgraph/findings/:id/refine-draft`
- UI:
  - Render a contextual FleetGraph card or panel on affected issue/week surfaces.
  - Add a lightweight proactive visibility surface from the active week or nearby navigation context so PMs do not need to poll or already know the affected issue.
  - Do not create a global dashboard for MVP.
  - The panel supports finding display, "why was this flagged?", draft refinement, and dismiss.

**Security & Privacy:**

- FleetGraph endpoints must use existing auth middleware and document visibility/capability checks.
- Finding visibility derives from the source issue/week visibility.
- User-facing claims must be backed by evidence visible to the current user.
- Human approval is action-specific and content-specific; approving one draft does not grant standing permission for future actions.
- FleetGraph may create/update/resolve FleetGraph-owned findings and drafts.
- FleetGraph may not mutate Ship canonical records, assign/reassign people, change status/priority/week/due date/ownership, post comments, send notifications, escalate, or accept project risk without explicit confirmation from an authorized human.
- Trace metadata may be stored; raw prompt/completion content is sensitive and must not be casually logged or exposed.
- Shared MVP trace links must use seeded/demo data or otherwise submission-safe content. Do not share traces containing private organic workspace content, private titles, emails, raw sensitive document bodies, or drafts that would expose restricted context.

**Demo/Data Readiness Requirements:**

FleetGraph MVP is not demo-ready unless Ship contains a realistic execution graph for it to observe. The implementation must provide a repeatable way to create or verify a demo workspace with positive cases, negative controls, permission cases, and reviewer-friendly navigation targets.

Required demo universe:

- One active week/sprint document whose status/date semantics match the current date.
- One program and one project associated to the active week issues.
- People/user records for at least:
  - engineer/builder
  - PM or project owner
  - active week owner
  - program lead/director
  - dependency/context source
- At least two urgent/high active-week issues with assignees and `state = blocked`; at least one includes recent `issue_iterations.blockers_encountered` text explaining the block.
- At least one blocker that names a dependency or decision-maker, such as Legal, Platform credentials, PM scope decision, or unclear acceptance criteria.
- Project/program/issue/week ownership fields populated enough for FleetGraph to identify builder, work owner, week owner, decision-maker, context source, and dependency candidate roles.
- Recent activity timestamps so the worker candidate query can see the seeded blockers.
- Stable URLs or printed IDs for the reviewer to open the affected issue/week pages.
- A reviewer-visible proactive surface, such as active-week banner, badge/count, or notification item, that points to at least one seeded finding.

Required negative controls:

- Urgent/high issue in a non-active week.
- Active-week urgent/high issue that is not blocked.
- Active-week urgent/high issue with `state = blocked` but no blocker iteration.
- Active-week medium/low issue with `state = blocked`.
- Done/cancelled urgent/high issue with blocker text.
- Candidate that already has an open FleetGraph finding for the dedupe key.
- Private or restricted source issue/week that one test user cannot read.

Demo data expectations:

- Seeded issue priorities must use real values: `urgent` or `high`, not `critical`.
- Seeded issue states must use real values, including the new first-class `blocked` state once implemented.
- Week membership must use `document_associations.relationship_type = 'sprint'`, not legacy columns.
- Blockers must be in `issue_iterations.blockers_encountered`, not only in issue body text.
- The worker flag should stay off by default except in demo/test environments.
- There should be a fast way to force or invoke one worker tick for demo/test validation so implementers do not wait 2 minutes for every run.
- Automated tests must use the test database; demo seed data must not require truncating or corrupting `ship_dev`.

MVP vs final boundary:

- MVP requires one blocked-work detector, real Ship data, proactive visibility, contextual finding UI, on-demand explain/refine, a human gate, shared traces, and the timed 5-minute detection path.
- MVP does not require snooze, material-change reopen, a global inbox, DB lease, per-workspace budgets, approved Ship mutations, external delivery, director rollups, or additional detectors.
- Final submission should harden evidence quality, trace coverage, cost numbers, reviewer navigation, and optional polish only after the MVP loop is working end to end.

## 5. Risks & Roadmap

**Phased Rollout:**

- Step 1: Add FleetGraph persistence and dedupe constraints.
- Step 2: Implement deterministic candidate query.
- Step 3: Implement idempotent finding create/update/resolve service.
- Step 4: Add graph wrapper and trace metadata.
- Step 5: Add worker behind `FLEETGRAPH_WORKER_ENABLED=true`.
- Step 6: Add FleetGraph routes.
- Step 7: Add issue/week contextual card or panel.
- Step 8: Add lightweight proactive visibility from active week/navigation context.
- Step 9: Run timed detection test and collect trace links.

**Technical Risks:**

- LangGraph/LangSmith integration is not already present in the API package.
- `Blocked` becomes a canonical issue state. MVP detection must use `issue.state = blocked` for current blockedness and `issue_iterations.blockers_encountered` for explanation/history.
- Permission-filtered summaries can leak restricted context if implemented casually.
- Multi-instance API workers require a DB lease post-MVP; MVP assumes one worker process plus DB uniqueness.
- Broad on-demand prompts can create cost and privacy cliffs; MVP only explains/refines existing contextual findings.
- A contextual card alone may be too passive for the proactive requirement; MVP must provide a small notification-like entry point without building a full dashboard.

**Implementation Acceptance Tests:**

- Qualifying urgent/high active-week issue with `state = blocked` creates an open finding within 5 minutes. Missing blocker explanation creates a callout instead of suppressing the finding.
- Finding is discoverable from the affected issue/week context and from a lightweight proactive UI surface.
- Duplicate candidate produces update/quiet trace, not a duplicate open finding.
- On-demand "why was this flagged?" explains the existing finding.
- Draft refinement updates only the FleetGraph draft.
- Dismiss sets finding status without mutating issue/week data.
- User without source document access cannot read the finding.
