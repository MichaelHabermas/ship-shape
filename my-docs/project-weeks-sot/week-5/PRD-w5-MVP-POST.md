# PRD - FleetGraph Week 5 Post-MVP

## 1. Executive Summary

**Problem Statement:** The MVP detects one class of blocked active-week work, but Ship still lacks a durable system for tracking execution drift across projects, decisions, and repeated delivery patterns.

**Proposed Solution:** Expand FleetGraph from one blocked-work detector into a project-risk ledger, then into a drift autopilot where FleetGraph prepares multi-step recovery options and humans approve each consequence. Autopilot means decision preparation and orchestration, not unsupervised judgment.

**Success Criteria:**

- All new detectors write to the same FleetGraph finding ledger instead of creating separate alert systems.
- PMs can manage finding lifecycle with snooze, dismiss, resolve, reopen-on-material-change, and audit history.
- Approved FleetGraph actions can mutate Ship or contact people only after final authorization, recipient-side policy checks, and a clear record of which human decision the action implements.
- Director/program rollups summarize existing findings without broad whole-workspace LLM scans.
- Per-workspace budgets, cooldowns, trace redaction, and worker coordination prevent cost, privacy, and duplicate-run cliffs.

## 2. User Experience & Functionality

**User Personas:**

- PM: manages a queue of project risks, approves consequences, and tunes noise.
- Engineer: receives clearer blocker context, missing-context prompts, and approved follow-up actions.
- Director: sees repeated drift patterns across projects and programs after individual findings establish evidence.
- Admin/security reviewer: controls FleetGraph availability, trace exposure, retention, and auditability.

**User Stories:**

- As a PM, I want FleetGraph findings to behave like a durable ledger so that risks do not disappear as transient alerts.
- As a PM, I want to snooze or dismiss a finding and have FleetGraph reopen it only when evidence materially changes.
- As a PM, I want FleetGraph to prepare issue comments, assignments, scope moves, and escalation drafts so that I can approve the right consequence with less manual work.
- As an engineer, I want FleetGraph to identify missing execution context so that I know what clarification to request.
- As a director, I want program-level drift summaries based on existing findings so that I can intervene without reading every issue.
- As an admin, I want trace redaction, retention, disable, and purge controls so that FleetGraph does not become a hidden data exposure surface.

**Acceptance Criteria:**

- Every post-MVP detector creates, updates, resolves, or suppresses a FleetGraph finding using shared status, evidence, dedupe, trace, and audit conventions.
- Snoozed findings stay quiet until the snooze expires or material evidence changes.
- Approved actions are executed only after rechecking actor authorization, recipient visibility, and action content.
- Rollups are built from findings and bounded context, not unbounded workspace scans.
- Users can see why a finding exists, what changed, who should act, and what FleetGraph proposes next.
- Admins can disable FleetGraph per workspace and purge FleetGraph-owned state without corrupting Ship canonical documents.

**Non-Goals:**

- Blanket autonomy.
- Whole-workspace free-form reasoning as the default path.
- Detector-specific persistence models.
- Separate alert feeds for each detector.
- External delivery without recipient-side permission checks.
- Autonomous acceptance of project risk.

## 3. AI System Requirements

**Tool Requirements:**

- Continue using the shared graph and trace system introduced in MVP.
- Add detector modules as new candidate sources, not new agent architectures.
- Add policy checks immediately before any approved action that posts, sends, assigns, moves, edits, or escalates.
- Add per-workspace budgets, concurrency caps, cooldowns, and severity ranking before broadening proactive coverage.
- Add trace redaction controls for document body, private titles, people names, emails, drafts, and sensitive metadata.

**Evaluation Strategy:**

- Detector quality: each detector must define deterministic candidate criteria before model reasoning.
- Ledger integrity: one source condition must map to one active dedupe key unless the evidence materially changes.
- Permission safety: findings and drafts must not leak private issue/document/project context to unauthorized users or recipients.
- Action safety: approved consequences must be rejected if authorization or recipient visibility changes between drafting and execution.
- Cost safety: empty ticks produce no model calls; noisy workspaces are capped and ranked by severity.

## 4. Technical Specifications

**Architecture Overview:**

Post-MVP FleetGraph keeps the MVP boundary: Ship remains canonical work state, FleetGraph owns diagnosis and proposed-action state.

```text
candidate sources
-> shared graph
-> risk ledger findings
-> contextual surfaces and inbox
-> human-approved consequences
-> audit, trace, retention, budgets
```

The ledger is the product spine. New detectors should feel like additional inputs into the same operational object, not separate assistants.

**v1.1: Ledger Hardening**

- Add snooze with `snoozed_until` and material-change reopen rules.
- Add finding timeline: flagged because, changed since, still blocked because, needs you because.
- Add audit events for create, update, resolve, dismiss, snooze, reopen, refine, approve, execute, and deny.
- Add retention/deletion rules tied to source document/workspace lifecycle.
- Add DB lease/leader election before enabling multiple API worker instances.
- Add per-workspace rate limits, budgets, cooldowns, and trace redaction.
- Add admin disable/purge controls for FleetGraph-owned state.

**v1.2: Human-Approved Consequences**

- Add approved issue comments first; this is the lowest-risk canonical/public consequence.
- Add approved assignment/reassignment after the comment path proves authorization, preview, audit, and rollback/error handling.
- Add approved priority/status/week/due-date changes last; these are project-state mutations and need stronger previews, capability checks, and audit than comments.
- Add approved escalation drafts and recipient selection after recipient-side visibility checks are proven.
- Add multi-document action previews before applying changes.
- Recheck authorization, recipient visibility, and content safety immediately before execution.
- Store action-specific approval; never treat one approval as standing permission.

**v2.0: More Detectors**

- Sprint carryover risk: active week nearing end with urgent/high incomplete work.
- Silent accountable owner: important active work lacks expected progress signal.
- Orphaned urgent/high work: issue lacks owner, project/program association, or active week context.
- Missing execution context: assigned issue lacks acceptance criteria, linked context, or clear accountable person.
- Repeated program-level drift: multiple projects under a program show recurring blockers, carryover, ownership gaps, or missing updates.

**Aspirational: Drift Autopilot**

FleetGraph bundles related proposed actions into one reviewable approval surface. Example:

```text
This work will likely slip unless Legal answers by Thursday.
Prepared actions:
1. Message Dana for blocker resolution.
2. Move Issue X out of Week 5 if no answer by Thursday.
3. Draft director risk note.
4. Add scope tradeoff note to the week review.
```

Humans approve individual consequences. FleetGraph never gets blanket autonomy, and it must keep separating evidence, inference, recommendation, and approved human decision.

**Integration Points:**

- Contextual issue/week/project/program surfaces.
- Optional FleetGraph inbox after MVP, backed by the same ledger.
- Existing document authorization and capability model.
- Existing issue mutation services for approved consequences.
- Existing audit logging for user-visible and canonical mutations.

**Scenario/Data Readiness:**

Post-MVP detector expansion must ship with reusable scenario packs, not only code paths. Each new detector needs seeded positive cases, negative controls, permission cases, and reviewer links before it counts as product-complete.

Required scenario packs:

- Carryover risk: active week near end, urgent/high incomplete issues, mixed blocked/unblocked cases.
- Silent accountable owner: planned important work with no recent standup, iteration, review, or issue update.
- Orphaned urgent/high work: important issue missing owner, project/program association, or active week context.
- Missing execution context: assigned issue with sparse description, missing acceptance criteria, or conflicting linked context.
- Program-level drift: multiple projects under one program with repeated blockers or ownership gaps.

Scenario packs should include role-rich people data, associations, recent activity, private/restricted variants, and expected FleetGraph decisions. The goal is to make every detector auditable against a known Ship world before it is trusted on organic customer data.

**Security & Privacy:**

- Create a scoped FleetGraph service principal with explicit capabilities.
- Add FleetGraph-specific capabilities if the existing document capability model is too coarse:
  - `finding:read`
  - `finding:write`
  - `finding:approve`
  - `finding:dismiss`
  - `finding:admin`
- Add prompt-injection defenses: Ship document content is untrusted evidence, not instructions.
- Add trace redaction and retention policy before broadening context.
- Add recipient-side policy checks immediately before sending/posting.
- Log denied actions as security-relevant audit events.

## 5. Risks & Roadmap

**Phased Rollout:**

- MVP: blocked urgent/high active-week findings.
- v1.1: harden ledger lifecycle, audit, retention, trace redaction, budgets, and worker lease.
- v1.2: execute human-approved consequences with final authorization checks.
- v2.0: add more detectors into the same ledger.
- Aspirational: drift autopilot with bundled proposed actions and per-action approval.

**Technical Risks:**

- Adding detectors before ledger hardening creates noisy, untrusted alerts.
- Program rollups can become expensive or leaky if they trigger fresh broad LLM scans.
- Approved action execution can bypass security if authorization is checked only at draft time.
- Trace and evidence snapshots can become sensitive long-lived data if retention is undefined.
- Multi-instance workers can duplicate runs and costs without DB lease/leader election.
- Per-project customization can fracture the simple detector model if introduced too early.

**Post-MVP Acceptance Tests:**

- Snoozed finding stays hidden until expiration, then reappears only if still qualifying.
- Materially changed evidence reopens a dismissed/snoozed finding according to policy.
- Approved issue comment is blocked if recipient/source visibility changes before execution.
- Director rollup summarizes existing findings without scanning unrelated private documents.
- Per-workspace budget prevents additional graph runs after configured daily cap.
- Trace redaction removes raw document body and draft content from stored/shared traces.
- DB lease prevents duplicate workers from processing the same candidate batch.
