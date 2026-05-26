# FleetGraph Post-MVP Implementation Plan

This is an execution checklist for Codex. It is organized as epics with small, reviewable slices. Each slice should be completed, verified, and status-updated before moving to the next slice unless the user explicitly redirects.

This plan starts after the FleetGraph MVP vertical slice. The goal is to make the final submission safe first, then grow FleetGraph into a real project-risk ledger without creating architecture that must be undone later.

## Status Legend

`Not started` | `In progress` | `Blocked` | `Done` | `Deferred`

## Source Truth And Non-Negotiables

Treat `my-docs/project-weeks-sot/week-5/w5-specs/` as authoritative. Keep this plan aligned with `PRESEARCH.md`, `FLEETGRAPH.md`, `ARCHITECTURE.md`, `ARCHITECTURAL_DEFENSE.md`, `PRD-w5-MVP.md`, and `my-docs/MEMORY.md`.

Do not weaken these constraints:

- Proactive and on-demand modes share one graph core.
- SQL candidate selection happens before model reasoning.
- The LLM never decides what to scan.
- FleetGraph owns diagnosis state only: findings, runs, evidence snapshots, trace metadata, drafts, approval requests, and action results once approved actions exist.
- Ship remains canonical for documents, issues, weeks, ownership, status, priority, associations, and content.
- No autonomous Ship mutation, external delivery, assignment, escalation, document edit, status/priority/week change, due date change, or risk acceptance.
- Any Ship mutation, comment, notification, escalation, or external delivery requires explicit, content-specific human approval.
- User-visible claims must be backed by evidence visible to that user.
- Shared traces must use seeded/demo-safe data.
- Do not add a new `document_type`.
- Keep contextual chat embedded in Ship surfaces; do not create a standalone chatbot as the primary experience.
- Product leap work must not risk final-submission requirements.

## Scope Boundary

### Final Submission Safe Scope

Finish the assignment deliverables and harden the MVP evidence:

- Root submission files are present where required: `PRESEARCH.md` and `FLEETGRAPH.md`.
- `FLEETGRAPH.md` includes final Test Cases, Architecture Decisions, and Cost Analysis.
- At least five use cases are documented with Ship state, expected output, and trace evidence or honest trace status.
- Proactive blocked-work creation, on-demand explanation, draft refinement, and duplicate/update or quiet exit have reviewer-safe trace evidence.
- A timed proof shows a qualifying blocked active-week issue becomes visible within 5 minutes.
- Reviewer navigation is reproducible from seeded/demo-safe data.

### Post-MVP Product Leap

After final-submission safety is locked, expand FleetGraph in this order:

1. Project risk ledger: more detectors and rollups using the same findings/runs model.
2. Durable proactive architecture: job table, leases, retries, budgets, and hybrid event plus polling trigger model.
3. Approval-backed actions: human-approved Ship mutations, comments, and notifications.
4. Contextual copilot expansion: broader on-demand questions from issue, week, project, program, and dashboard context.

### Beyond Final Submission

Keep these in mind while designing interfaces, but do not pull them into final-submission scope unless the user explicitly redirects:

- Broad workspace chat.
- Global FleetGraph inbox.
- Autonomous action without human approval.
- Slack/email delivery.
- Multi-workspace operational dashboards.
- Event-sourced graph facts for every Ship mutation.
- Long-running director analytics beyond existing FleetGraph evidence.

## Locked Decisions

- Final submission safety comes before product leap.
- Risk ledger expansion is the first product-leap lane.
- Action execution comes after the ledger is reliable and approval semantics are explicit.
- Broader contextual copilot comes after proactive findings are useful without chat.
- New detectors reuse FleetGraph findings, runs, evidence snapshots, dedupe, trace metadata, and contextual surfaces.
- Director/program rollups summarize evidence-backed findings; they do not invent unsupported claims.
- Durable worker/jobs and event triggers are post-MVP reliability work, not a prerequisite for final submission.
- Approved actions are exact-action approvals, not standing permission grants.
- No staging, unstaging, or commits without explicit instruction.

## Epic 0: Post-MVP Guardrails

**Status:** Not started

**Goal:** Keep final-submission work safe while designing the product-leap path.

### Slice 0.1: Re-Pin Source Truth

**Status:** Not started

**Do:**

- Read `my-docs/project-weeks-sot/week-5/w5-specs/Week-5-GFA-FleetGraph-PRD.txt`.
- Read `my-docs/project-weeks-sot/week-5/w5-specs/Advisor-followup-week-5.md`.
- Read the current `my-docs/project-weeks-sot/week-5/FLEETGRAPH.md`, `PRESEARCH.md`, and `PRD-w5-MVP.md` before changing final deliverables.
- State the final-submission vs post-MVP boundary before editing code.

**Done Means:**

- Work starts from the Week 5 assignment, not from a stale interpretation of the MVP plan.
- Codex can name which tasks are final-submission-critical and which are beyond final submission.

**Evidence:**

- Short implementation note naming the source docs used.

### Slice 0.2: Preserve MVP Safety Boundaries

**Status:** Not started

**Do:**

- Keep FleetGraph as diagnosis/action-prep until approved actions are explicitly implemented.
- Keep Ship canonical for work state.
- Keep contextual chat embedded in issue/week/project/program surfaces.
- Avoid new document types, global chatbot routes, and autonomous Ship mutations.

**Done Means:**

- Product-leap work does not weaken MVP guarantees.
- Any new affordance either stops at a human gate or records a blocked consequence.

**Evidence:**

- Diff review showing no autonomous mutation or standalone chatbot surface was introduced.

### Slice 0.3: Use Horizon Labels

**Status:** Not started

**Do:**

- Label implementation work as one of:
  - `Final submission`
  - `Post-MVP`
  - `Beyond final submission`
- Do not mix beyond-final work into final-submission checklists.

**Done Means:**

- The plan can guide architecture without bloating the final submission.

**Evidence:**

- Slice notes and handoff summary use the horizon labels consistently.

## Epic 1: Submission File Sync

**Status:** Not started

**Goal:** Put the required root deliverables in the right place before polishing their content.

### Slice 1.1: Create Or Sync Root Submission Files

**Status:** Not started

**Do:**

- Ensure final deliverables exist at the root as required by the Week 5 PRD:
  - `PRESEARCH.md`
  - `FLEETGRAPH.md`
- Sync from `my-docs/project-weeks-sot/week-5/` only after confirming the week-5 versions are the intended source.
- Preserve root deliverable content as submission-ready, not as internal scratch notes.

**Done Means:**

- Reviewer-required files exist where the assignment expects them.
- The root files match the final FleetGraph story.

**Evidence:**

- File presence check and diff summary.

### Slice 1.2: Confirm Submission File Ownership

**Status:** Not started

**Do:**

- Decide whether the root files or week-5 files are the canonical editing target for final submission.
- If root files are canonical, keep week-5 files as supporting history.
- If week-5 files are canonical until handoff, make root sync an explicit final step.
- Do not let two divergent copies become competing truths.

**Done Means:**

- Codex knows which file to edit when completing final-submission sections.

**Evidence:**

- Implementation note naming the canonical deliverable location.

## Epic 2: Use Cases And Agent Responsibility

**Status:** Not started

**Goal:** Make the final submission prove FleetGraph is more than one blocked-work detector without claiming unbuilt features are implemented.

### Slice 2.1: Reconcile Agent Responsibility

**Status:** Not started

**Do:**

- Re-read `FLEETGRAPH.md` Agent Responsibility against the Week 5 PRD.
- Keep the MVP responsibility precise: blocked urgent/high active-week work becomes an action-ready finding.
- Add post-MVP responsibility language for risk ledger expansion without implying autonomous Ship mutation.
- Preserve the human gate and smallest-useful-audience rules.

**Done Means:**

- FleetGraph's responsibility definition covers final submission and product direction without contradicting MVP safety.

**Evidence:**

- `FLEETGRAPH.md` Agent Responsibility section review.

### Slice 2.2: Complete Five Use Cases

**Status:** Not started

**Do:**

- Ensure `FLEETGRAPH.md` contains at least five use cases.
- Keep blocked active-week work as the implemented MVP use case.
- Include post-MVP use cases without claiming implementation if they are not built:
  - sprint carryover risk.
  - assigned issue lacks execution context.
  - repeated program drift for directors.
  - accountable owner has gone silent.
  - high-priority work exists outside the planning graph.
  - what changed since I last looked.
- For each use case, include role, trigger, what FleetGraph detects or produces, and what the human decides.

**Done Means:**

- The required five-use-case section is complete and honest about implementation state.

**Evidence:**

- `FLEETGRAPH.md` use-case table or section review.

### Slice 2.3: Map Use Cases To Implementation State

**Status:** Not started

**Do:**

- Mark each use case as implemented, partially supported, planned, or beyond final submission.
- Do not let planned risk-ledger cases read like shipped behavior.
- For unbuilt use cases, describe the intended detector/graph path and what evidence would prove it later.

**Done Means:**

- The final submission is ambitious without being misleading.

**Evidence:**

- Use-case implementation-state notes in `FLEETGRAPH.md` or final handoff.

## Epic 3: Test Cases And Trace Evidence

**Status:** Not started

**Goal:** Show distinct graph paths and per-use-case expected behavior with reviewer-safe evidence.

### Slice 3.1: Complete Test Cases

**Status:** Not started

**Do:**

- For each final-submission use case, document:
  - Ship state that should trigger FleetGraph.
  - Expected output.
  - Trace link or honest trace status.
- Include at minimum:
  - proactive create finding.
  - on-demand explain.
  - on-demand draft refinement.
  - proactive duplicate/update or quiet exit.
- Use seeded/demo-safe data only.
- Do not invent external trace URLs.

**Done Means:**

- Reviewer can see distinct graph paths and understand any local-only trace limitation.

**Evidence:**

- Trace links or local trace metadata recorded in `FLEETGRAPH.md`.

### Slice 3.2: Capture Required Trace Paths

**Status:** Not started

**Do:**

- Capture or document reviewer-safe trace evidence for:
  - proactive create finding.
  - on-demand explain.
  - on-demand draft refinement.
  - proactive duplicate/update or quiet exit.
- Confirm traces show different graph branches, not only different metadata through the same pipeline.
- Use seeded/demo-safe data only.
- Do not invent external trace URLs.

**Done Means:**

- The assignment's observability requirement is met honestly.

**Evidence:**

- Shared trace links or local trace metadata in `FLEETGRAPH.md`.

### Slice 3.3: Review Trace Safety

**Status:** Not started

**Do:**

- Confirm traces do not expose raw private workspace data, hidden document titles, sensitive excerpts, tokens, or user secrets.
- Confirm local-only trace metadata is labeled local-only.
- Confirm trace examples correspond to documented test cases.

**Done Means:**

- Reviewer evidence is useful and safe to share.

**Evidence:**

- Focused trace-safety review note.

## Epic 4: Architecture And Cost Analysis

**Status:** Not started

**Goal:** Finish the final written sections that defend how FleetGraph works and why it scales.

### Slice 4.1: Complete Architecture Decisions

**Status:** Not started

**Do:**

- Document current architecture decisions:
  - shared graph core.
  - deterministic SQL before model reasoning.
  - FleetGraph-owned findings/runs.
  - API-process worker for MVP.
  - contextual UI over global chatbot.
  - permission-filtered evidence.
  - human gate before mutation/contact.
- Document post-MVP direction:
  - risk ledger first.
  - durable job runner after final-submission safety.
  - hybrid event plus polling later.
  - approval-backed action execution after exact approval semantics exist.

**Done Means:**

- Architecture Decisions explains both the current submission and the next architecture direction.

**Evidence:**

- `FLEETGRAPH.md` Architecture Decisions section review.

### Slice 4.2: Complete Cost Analysis

**Status:** Not started

**Do:**

- Record actual development/testing invocation data when available.
- Estimate monthly production cost for:
  - 100 users.
  - 1,000 users.
  - 10,000 users.
- Use candidate-driven cost assumptions, not naive full-workspace reasoning.
- Call out cost cliffs:
  - broad on-demand prompts.
  - noisy detectors.
  - duplicate reprocessing.
  - oversized context.
  - director rollups without summarization.

**Done Means:**

- Cost Analysis is defensible even if some exact development spend data is unavailable.

**Evidence:**

- Completed `FLEETGRAPH.md` Cost Analysis section.

### Slice 4.3: Defend Product-Leap Architecture

**Status:** Not started

**Do:**

- Explain why risk ledger expansion comes before action execution and broad chat.
- Explain why durable jobs and hybrid triggers are post-MVP reliability work.
- Explain how approved actions remain content-specific and human-gated.
- Explain how contextual copilot avoids broad workspace chat and privacy cliffs.

**Done Means:**

- The final submission shows a credible path beyond MVP without over-scoping the final build.

**Evidence:**

- Architecture Decisions or roadmap section review.

## Epic 5: Reviewer Demo And Timed Proof

**Status:** Not started

**Goal:** Make the final submission reproducible for a reviewer without private context or manual database work.

### Slice 5.1: Prove Five-Minute Detection

**Status:** Not started

**Do:**

- Start from demo-safe data.
- Record the blocker write timestamp.
- Record worker tick/run timestamp.
- Record graph decision timestamp.
- Record finding persisted timestamp.
- Record UI/API visibility timestamp.
- Confirm visibility within 5 minutes.

**Done Means:**

- The detection latency claim is supported by timestamps, not vibes.

**Evidence:**

- Timed proof notes added to `FLEETGRAPH.md` or final handoff.

### Slice 5.2: Verify Demo Data And Reviewer Paths

**Status:** Not started

**Do:**

- Ensure demo setup prints or documents stable reviewer paths for:
  - active week.
  - positive blocked issue.
  - second positive blocked issue.
  - duplicate/update control.
  - missing-evidence or quiet-exit control.
  - project/program context where applicable.
- Confirm reviewer-visible data does not expose private organic workspace content.

**Done Means:**

- Reviewer can reproduce the finding path without manual SQL or private context.

**Evidence:**

- Demo command output or reviewer path checklist.

### Slice 5.3: Verify Permission And Visibility Behavior

**Status:** Not started

**Do:**

- Confirm user-visible findings require source issue/week visibility.
- Confirm restricted evidence is hidden, summarized generically, or causes quiet exit.
- Confirm seeded restricted/private controls behave as documented.

**Done Means:**

- The reviewer demo proves FleetGraph is proactive without leaking hidden context.

**Evidence:**

- Focused permission test or review notes.

## Epic 6: Final Verification And Handoff

**Status:** Not started

**Goal:** Run final local gates, update statuses, and make the handoff honest.

### Slice 6.1: Run Final Submission Gates

**Status:** Not started

**Do:**

- Run relevant final gates after implementation work:
  - `pnpm type-check`
  - `pnpm build`
  - `pnpm openapi:check`
  - `pnpm docs:check`
  - `pnpm docs:check:paths`
  - targeted API/web/FleetGraph tests.
- Use `DATABASE_URL=.../ship_test_audit` for destructive API tests.
- Do not run full E2E blindly if infrastructure failures are known; follow repo E2E guidance.

**Done Means:**

- Final-submission behavior is locally verified or failures are reported honestly.

**Evidence:**

- Command output summary in final handoff.

### Slice 6.2: Update Plan And Handoff Statuses

**Status:** Not started

**Do:**

- Update relevant slice statuses in the active plan.
- Name any skipped verification with reason.
- Name any final-submission gaps explicitly.
- Keep post-MVP and beyond-final work marked as not started or deferred unless actually implemented.

**Done Means:**

- The final handoff is readable and does not blur completed work with roadmap work.

**Evidence:**

- Final implementation summary and changed-file diff.

## Epic 7: Risk Ledger Expansion

**Status:** Not started

**Goal:** Turn FleetGraph from one blocked-work detector into a project drift ledger while reusing the same graph and findings model.

### Slice 7.1: Add Detector Framework Boundaries

**Status:** Not started

**Do:**

- Define a common detector contract for deterministic candidate selection.
- Keep all detector candidates SQL-first and bounded before model reasoning.
- Require every detector to emit:
  - source object IDs.
  - workspace ID.
  - detector type.
  - dedupe key.
  - candidate reason.
  - visibility constraints.
  - quiet-exit classification.
- Do not create detector-specific finding tables unless a concrete data need appears.

**Done Means:**

- New detectors plug into FleetGraph without becoming separate mini-agents.

**Evidence:**

- Shared detector tests or interface review.

### Slice 7.2: Add Sprint Carryover Risk

**Status:** Not started

**Do:**

- Detect active-week important work likely to carry over near the end of the week.
- Use deterministic signals first:
  - active week.
  - open urgent/high work.
  - blocked state.
  - stale or missing progress.
  - repeated scope movement when available.
- Produce a PM decision packet, not a generic warning.
- Stop at human decisions: re-scope, defer, notify owner, accept risk, or dismiss.

**Done Means:**

- PM can see likely carryover before the week ends.

**Evidence:**

- Positive, quiet-exit, and duplicate tests plus reviewer-safe trace.

### Slice 7.3: Add Silent Accountable Owner

**Status:** Not started

**Do:**

- Detect important active work whose accountable owner has no recent progress signal.
- Treat expected cadence and visible activity as evidence.
- Lower confidence when ownership or activity is ambiguous.
- Draft a nudge but do not send it without approval.

**Done Means:**

- FleetGraph can identify accountability drift without accusing people from thin evidence.

**Evidence:**

- Detector tests, permission tests, and on-demand explanation trace.

### Slice 7.4: Add Orphaned High-Priority Work

**Status:** Not started

**Do:**

- Detect high-priority work outside the planning graph:
  - missing owner.
  - missing project/program association.
  - missing active-week context when the work appears urgent.
- Recommend likely linking or ownership candidates only when evidence supports them.
- Require human approval for any link, owner, priority, or scope change.

**Done Means:**

- PMs can find high-priority work that is important but ungoverned.

**Evidence:**

- Positive/negative detector tests and human-gate UI proof.

### Slice 7.5: Add Missing Execution Context

**Status:** Not started

**Do:**

- Detect assigned issues that lack enough context to execute:
  - sparse description.
  - missing acceptance criteria.
  - missing project/program link.
  - conflicting linked context.
- Make this primarily useful to engineers opening their assigned issues.
- Produce clarification questions and likely context sources.

**Done Means:**

- FleetGraph helps engineers move without forcing them to search Ship manually.

**Evidence:**

- Contextual issue-page on-demand test and grounded answer trace.

### Slice 7.6: Add Director Program Rollups

**Status:** Not started

**Do:**

- Summarize repeated drift across existing FleetGraph findings.
- Avoid scanning raw program history through an LLM as the first step.
- Group by project, owner/dependency candidate, detector type, severity, and trend.
- Route to director/program lead only when patterns are repeated, severe, or explicitly escalated by PMs.

**Done Means:**

- Director view is based on accumulated evidence, not speculative analytics.

**Evidence:**

- Rollup tests and trace showing summary over existing findings.

## Epic 8: Durable Proactive Architecture

**Status:** Not started

**Goal:** Make proactive FleetGraph reliable beyond a single API-process polling worker.

### Slice 8.1: Add Durable Job Model

**Status:** Deferred until final submission is safe

**Do:**

- Add a FleetGraph job table only when operational reliability justifies it.
- Represent queued scopes, detector type, priority, run-after time, lease owner, attempts, last error, and dead-letter state.
- Keep jobs as FleetGraph-owned state.

**Done Means:**

- Proactive scans can survive API restarts and multi-instance deployments.

**Evidence:**

- Migration, job-claim tests, and worker lifecycle tests.

### Slice 8.2: Add Lease, Retry, And Dead-Letter Behavior

**Status:** Deferred until final submission is safe

**Do:**

- Claim jobs with DB-backed leases.
- Expire abandoned leases.
- Retry transient failures with backoff.
- Dead-letter repeated failures with reviewer/operator visibility.

**Done Means:**

- FleetGraph does not duplicate work across API instances or silently lose failed scans.

**Evidence:**

- Concurrency and failure-path tests.

### Slice 8.3: Add Hybrid Event Plus Polling Trigger Model

**Status:** Deferred until final submission is safe

**Do:**

- Emit internal Ship events for relevant issue/week/project changes.
- Enqueue changed scopes immediately.
- Keep polling as fallback for missed events, open-finding rechecks, cooldowns, and snoozes.
- Preserve the 5-minute latency goal.

**Done Means:**

- Event triggers reduce latency/cost without making polling correctness disappear.

**Evidence:**

- Event enqueue tests, polling fallback tests, and latency proof.

### Slice 8.4: Add Budgets And Backpressure

**Status:** Deferred until final submission is safe

**Do:**

- Add per-workspace and global run budgets.
- Rank candidates by severity and recency.
- Cool down unchanged open findings.
- Record skipped/deferred work explicitly.

**Done Means:**

- A noisy workspace cannot consume all FleetGraph capacity or model budget.

**Evidence:**

- Budget tests and run metadata review.

## Epic 9: Approval-Backed Actions

**Status:** Deferred until the risk ledger is stable

**Goal:** Let FleetGraph execute useful work only after exact human approval.

### Slice 9.1: Define Approval Model

**Status:** Deferred

**Do:**

- Model approvals as content-specific records:
  - approving user.
  - authorized action type.
  - exact target object.
  - exact payload.
  - draft text at approval time.
  - evidence snapshot.
  - expiry.
- Do not create standing permission grants.

**Done Means:**

- Approval semantics are auditable and cannot drift from what the human saw.

**Evidence:**

- Schema/API review and approval tests.

### Slice 9.2: Execute Approved Ship Mutations

**Status:** Deferred

**Do:**

- Support only narrow approved actions at first:
  - post a comment.
  - assign/reassign owner.
  - change status.
  - move or defer work.
  - link missing project/program context.
- Check existing capabilities at execution time.
- Record success, failure, retry state, and resulting Ship object IDs.

**Done Means:**

- FleetGraph can complete approved clerical work without bypassing Ship authorization.

**Evidence:**

- Capability tests, mutation tests, and UI proof.

### Slice 9.3: Execute Approved Notifications

**Status:** Deferred

**Do:**

- Start with in-app notifications before Slack/email.
- Send only the exact approved message to the exact approved recipient or role.
- Record delivery result and failure state.
- Keep external delivery beyond final submission unless explicitly prioritized.

**Done Means:**

- FleetGraph contacts people only when a human approved the exact action.

**Evidence:**

- Notification tests and audit trail review.

### Slice 9.4: Add Edit-Before-Approve UX

**Status:** Deferred

**Do:**

- Let users edit the proposed action payload before approval.
- Treat edited payload as a new approval target.
- Show affected objects, exact recipients, exact draft, and consequence.

**Done Means:**

- The human gate is a real decision surface, not a decorative approval button.

**Evidence:**

- Web tests and browser proof.

## Epic 10: Contextual Copilot Expansion

**Status:** Deferred until proactive ledger is stable

**Goal:** Broaden on-demand FleetGraph without turning it into a standalone chatbot.

### Slice 10.1: Add Page-Aware Question Routing

**Status:** Deferred

**Do:**

- Support contextual prompts from issue, week, project, program, and dashboard surfaces.
- Start from current object type, object ID, visible page state, filters, role, and permissions.
- Route broad questions to scope narrowing before graph expansion.

**Done Means:**

- Users can ask useful questions without restating where they are in Ship.

**Evidence:**

- On-demand routing tests and contextual trace evidence.

### Slice 10.2: Add "What Changed Since I Last Looked?"

**Status:** Deferred

**Do:**

- Compare current visible state to last-view or last-summary markers.
- Include new risks, resolved blockers, changed ownership/scope, and open findings.
- Avoid full-workspace summaries unless the user explicitly scopes them.

**Done Means:**

- FleetGraph makes returning to a project/week faster without becoming noisy.

**Evidence:**

- Page-context tests and grounded summary traces.

### Slice 10.3: Add "What Should I Do Next?"

**Status:** Deferred

**Do:**

- Rank next actions from existing findings, current context, role, and visible evidence.
- Separate autonomous FleetGraph diagnosis from human decisions.
- Prefer specific next steps over generic project advice.

**Done Means:**

- FleetGraph helps a PM, engineer, or director choose the next useful action.

**Evidence:**

- Role-specific test cases and traces.

### Slice 10.4: Add Scoped Follow-Up Chat

**Status:** Deferred

**Do:**

- Allow follow-up questions inside a bounded page/session context.
- Persist only useful FleetGraph state, not raw broad chat transcripts.
- Keep answers evidence-backed and permission-filtered.

**Done Means:**

- Chat becomes a power feature around FleetGraph findings and Ship context.

**Evidence:**

- Web/API tests and restricted-evidence proof.

## Approved Product-Leap Direction

- Build the risk ledger first. More detectors and rollups create the substrate that makes every later action smarter.
- Make every detector deterministic before model reasoning. This keeps cost bounded and trace paths meaningful.
- Use one findings/runs/evidence model. Do not build separate data islands for each detector.
- Let director rollups summarize FleetGraph evidence. Do not make the first director feature a broad LLM scan.
- Move to durable jobs when reliability demands it. The job table is the right long-term shape, but it should not distract from final-submission evidence.
- Add approved actions only after approval semantics are exact and auditable.
- Expand contextual copilot only after proactive findings are useful without chat.

## Deferred And Beyond-Final Ideas

- Global FleetGraph inbox: useful after multiple detectors exist, but not the primary experience.
- Slack/email delivery: useful after in-app approval and notification semantics are proven.
- Autonomous Ship mutation: outside current safety boundary.
- Event-sourced graph facts for every Ship mutation: powerful, too large for Week 5.
- Cross-workspace director analytics: useful only after single-workspace rollups are evidence-backed.
- Material-change reopen and snooze: important ledger behavior, but less important than final-submission proof.
- Full broad workspace chat: high cost/privacy risk; require scope narrowing and evidence budgets first.

## Final Handoff Standard

Before human handoff, this plan should show current slice statuses; final-submission work should be clearly separated from post-MVP and beyond-final work; root submission deliverables should exist or be explicitly called out as missing; `FLEETGRAPH.md` should contain completed use cases, test cases, trace evidence, architecture decisions, and cost analysis; timed proof should be recorded or honestly missing; no code or unrelated docs should be changed by plan-only work; no staging, unstaging, or commit should happen without explicit instruction; verification should be reported honestly.
