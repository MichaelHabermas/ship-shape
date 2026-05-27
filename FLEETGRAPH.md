# FleetGraph

FleetGraph is a proactive project drift operator for Ship. It watches deterministic Ship state for execution drift, runs a shared LangGraph for proactive and on-demand reasoning, persists its own findings autonomously, and asks humans before it mutates Ship's source of truth or contacts people.

## MVP Scope

The MVP proves one detector end to end: blocked important work inside an active sprint/week becomes an action-ready unblock workflow.

A Ship issue becomes a proactive FleetGraph candidate when all conditions are true:

1. The issue belongs to an active sprint/week.
2. The issue is important active work. MVP uses the narrowest existing commitment marker in Ship. If Ship has no explicit commitment marker, the predicate is explicit and conservative: active sprint/week membership, not-done status, an owner or assignee, and `priority in ('urgent', 'high')`. In that fallback path FleetGraph describes the finding as "urgent/high active sprint work," not as committed work.
3. The issue has `state = blocked`; `issue_iterations.blockers_encountered` supplies blocker explanation/history when present.
4. No open FleetGraph finding already covers the same dedupe key.

The LLM does not decide which issues are worth checking. SQL-level deterministic candidate selection bounds the graph before model reasoning runs.

The graph's job is not to restate the SQL result. For each eligible issue, FleetGraph must produce the useful work a PM would otherwise do manually: identify why the blocker matters now, gather visible evidence, name the smallest useful audience, propose the next unblock step, draft the exact message/action, and stop at a human approval gate before contacting anyone or changing Ship.

## Agent Responsibility

FleetGraph monitors Ship for execution drift that changes the next useful action for a PM, engineer, or director. For MVP, it monitors blocked important issues in active sprint/weeks and creates contextual, action-ready findings within the product.

FleetGraph may autonomously:

- Read permitted Ship data from the server-side API process.
- Run deterministic candidate checks.
- Invoke the shared LangGraph for eligible candidates.
- Create, update, dedupe, suppress, and resolve FleetGraph-owned findings.
- Persist run metadata, decision metadata, and shared trace links.
- Draft recommended next actions and unblock messages.

FleetGraph must ask a human before:

- Assigning or reassigning work.
- Changing issue status, priority, sprint/week, due date, or owner.
- Editing documents or canonical Ship work records.
- Posting comments, sending notifications, or escalating to another person.
- Accepting project risk on behalf of a team.

FleetGraph derives project membership from Ship's graph: issue assignees, owners, project/program associations, sprint/week ownership, document associations, recent contributors, workspace roles, PMs, leads, supervisors, admins, and directors. It routes findings to the smallest useful audience and filters evidence to avoid leaking restricted context.

The MVP proactive surface is an in-product FleetGraph finding card on the affected issue and sprint/week context plus a lightweight active-week or navigation entry point, such as a banner, badge/count, or notification item. The finding should be visible as proactive output, not buried inside chat or discoverable only after opening the exact issue: it shows the issue is flagged, why it was flagged, what changed, and what FleetGraph recommends next. External comments, messages, and escalations are drafted but not sent without confirmation.

On-demand mode starts from the current page context: object type, object ID, visible state, user role, and permissions. It uses the same graph core as proactive mode but is read/explain/draft/refine only for MVP. Proactive mode owns finding creation and updates. On-demand mode lets the user ask why the issue was flagged, what should happen next, or how to reword the prepared draft without copying the text into another AI tool.

## Graph Diagram

```mermaid
flowchart TD
  A[Trigger] --> B{Mode}
  B -->|Proactive candidate| C[normalizeTrigger]
  B -->|On-demand page request| C
  C --> D[resolveScope]
  D --> E{Eligible scope?}
  E -->|No or resolved| Q[quietExit]
  E -->|Yes| F[fetchCurrentObject]
  F --> G[fetchNeighborContext]
  G --> H[reasonAboutDrift]
  H --> I{Decision}
  I -->|Low confidence| Q
  I -->|Proactive finding| J{Finding exists?}
  I -->|On-demand explain/draft/refine| K[prepareContextualAnswer]
  I -->|Action would mutate/contact| L[prepareConfirmationCard]
  J -->|New| M[createFinding]
  J -->|Duplicate/update| N[updateFinding]
  J -->|Condition gone| O[resolveFinding]
  K --> P[filterRecipientOutput]
  L --> P
  M --> P
  N --> P
  O --> P
  Q --> R[persistFleetGraphState]
  P --> S{Safe recipient output?}
  S -->|Visible| R
  S -->|Restricted summary| R
  S -->|No safe output| Q
  R --> T[produceOutput]
```

Key branches:

- Proactive vs. on-demand trigger.
- Candidate still eligible vs. resolved or low confidence.
- On-demand explanation/draft refinement vs. drafted action vs. proactive finding.
- New finding vs. duplicate/update.
- Autonomous FleetGraph state update vs. human approval required for Ship mutation or communication.
- Recipient-visible evidence vs. restricted summary vs. quiet exit.

## Use Cases

| # | Role | Trigger | Agent Detects / Produces | Human Decides |
| --- | --- | --- | --- | --- |
| 1 | PM | Active sprint/week contains important active work with a blocked signal | Blocked-work finding, owner/assignee, sprint/project context, evidence, severity, confidence, next unblock step, draft message/action | Send/edit message, escalate, re-scope, dismiss |
| 2 | PM | Active sprint/week nears end with blocked important work still open | Carryover risk explanation tied to the blocked issue and sprint/week | Re-scope, defer, notify owner, accept risk |
| 3 | Engineer | Engineer opens an assigned blocked issue | Contextual explanation of why it was flagged, linked context, likely next unblock step | Ask PM, update issue, request clarification |
| 4 | Director | Program/project view contains repeated blocked-work findings | Pattern summary across affected work, owners, and projects | Request recovery plan, intervene, dismiss |
| 5 | PM/Director | User asks "why was this flagged?" from an issue or sprint/week page | On-demand explanation using the existing finding and current visible context | Follow up, approve a drafted action, dismiss |

MVP implements use case 1 end to end. The others reuse the same graph shape and are expansion paths after the first detector is working.

## Trigger Model

MVP uses server-side polling inside the existing API process.

- The FleetGraph worker starts with the API process when `FLEETGRAPH_WORKER_ENABLED=true`.
- It ticks every 2 minutes.
- Each tick runs deterministic SQL candidate checks for blocked important work in active sprint/weeks.
- Eligible candidates enter the shared LangGraph.
- Findings must become visible within 5 minutes of the blocked signal appearing in Ship.

Latency budget for the timed test:

- Up to 120 seconds waiting for the next poll tick.
- Up to 30 seconds for candidate query and bounded context fetch.
- Up to 60 seconds for graph reasoning and trace recording.
- Up to 30 seconds to persist the finding and make it visible in the UI.
- 60 seconds reserved for jitter, retries, or cold-path overhead.

Polling is the right MVP tradeoff because it is reliable, fast to deploy, and catches missed transitions without building an event bus. The long-term architecture is hybrid: Ship events enqueue changed scopes immediately, while polling rechecks open findings, catches missed events, and handles cooldowns.

Cost is candidate-driven, not project-driven:

`daily graph runs = new eligible candidates + due rechecks + on-demand invocations`

Cheap polling can run often. LLM reasoning only runs after deterministic filters produce a bounded candidate.

## Human-in-the-Loop

FleetGraph owns diagnosis state. Ship owns canonical work state.

For MVP, a blocked-work finding includes:

- Title and summary.
- Source issue and sprint/week.
- Evidence snapshot.
- Severity and confidence.
- Recommended next action.
- Draft unblock message/action.
- Proposed recipient and why they are the smallest useful audience.
- "Needs you because" explanation for the human gate.
- Shared trace link.

FleetGraph may display this finding without approval. It may not send the draft, post a comment, assign work, change status, move sprint/week scope, or escalate without explicit human confirmation.

The MVP human gate is a confirmation card for the drafted unblock action. The card shows the evidence, affected issue/sprint, proposed recipient, exact draft text, and the blocked action. The user can approve, dismiss, or ask FleetGraph to refine the draft in place, for example: "make it softer," "add that Legal is the dependency," or "rewrite this as a scope tradeoff." If sending/posting is not implemented in MVP, the gate still records `needs_confirmation` and prevents accidental mutation or communication.

Humans may dismiss findings. FleetGraph may resolve findings when the source condition disappears, but it does not autonomously dismiss a human-visible finding as if a person rejected it. `snooze` is nice-to-have, not required for the architecture defense.

Recipient output is permission-filtered after reasoning. FleetGraph may reason server-side with system attribution, but every user-visible claim must be backed by evidence visible to that user. It may not reveal restricted document titles, hidden project names, private text excerpts, or inferred confidential facts. If the useful evidence is restricted, the output becomes a generic restricted-context summary or quiet exit.

## Observability

FleetGraph uses LangGraph and shared observability traces from day one. LangSmith is acceptable, but any tracing system is acceptable if it provides reviewer-shareable trace links that show distinct proactive and on-demand paths.

Each graph run records:

- Mode: `proactive` or `on_demand`.
- Trigger reason.
- Source object type and ID.
- Decision: `quiet_exit`, `create_finding`, `update_finding`, `explain`, `refine_draft`, `needs_confirmation`, `dismiss`, `resolve`, or `error`.
- Finding ID when applicable.
- Trace ID or URL.

Shared reviewer traces must use seeded/demo-safe data or redacted metadata. Trace links must not expose raw prompts, raw completions, hidden document IDs/titles, private excerpts, contact details, session tokens, or user tokens.

Required trace evidence:

1. Proactive blocked important active issue creates a finding.
2. On-demand "why was this flagged?" explains that finding from a contextual page.
3. On-demand draft refinement updates the proposed unblock message without mutating Ship.
4. Proactive run exits quietly because the candidate resolved or is a duplicate.

Trace debug UI is nice-to-have, not MVP. MVP persists trace metadata and includes submitted trace links in this file or submission notes.

## Deployment Model

FleetGraph runs inside the existing backend API process for MVP.

This avoids an extra service boundary, deployment target, auth path, and operational surface during the one-week sprint. The implementation should still keep clean internal boundaries:

- `fleetgraph/graph`: shared LangGraph nodes and edges.
- `fleetgraph/worker`: 2-minute polling loop and candidate selection.
- `fleetgraph/routes`: contextual on-demand endpoint and finding endpoints.

The worker uses heartbeat/run metadata in the database. MVP assumes a single deployed API worker. If deployment runs multiple API instances, a DB lease becomes required for correctness, not polish: without it, duplicate workers can create duplicate findings, duplicate traces, and unnecessary graph cost.

FleetGraph authenticates server-side using an explicit system attribution path. Long term, this becomes a scoped service principal. The safety rule is unchanged: service-principal access may detect drift, but recipient-facing output must be permission-filtered and cannot leak restricted evidence.

If Ship reads fail, FleetGraph does not create new claims from stale or partial data. It records the failed run, retries on the next tick, and leaves existing findings visible with stale-run metadata. On-demand mode reports the missing context instead of answering from old state.

Public deployment verification on 2026-05-27:

- Render API deploy `dep-d8b5o519rddc73a36gag` for commit `67586bf9da42fe6027a38c8decd4325fe7f80980` reached `live`.
- `https://ship-shape-api.onrender.com/health` returned HTTP 200.
- `https://ship-shape-web.onrender.com` returned HTTP 200.
- `https://ship-shape-api.onrender.com/api/fleetgraph/findings?sourceIssueId=...` returned HTTP 401 `No session found`, proving the FleetGraph route is mounted and protected instead of missing.
- `POST https://ship-shape-api.onrender.com/api/fleetgraph/manual-run` returned HTTP 403 `Missing Origin or Referer header`, proving the manual route is mounted and CSRF-protected.

Conclusion: the current public Render deployment exposes the FleetGraph route family. Reviewer-visible FleetGraph content still requires an authenticated reviewer session and seeded/demo-safe objects.

## Test Cases

| # | Ship State | Expected Output | Trace Link |
| --- | --- | --- | --- |
| 1 | Active sprint/week contains important issue `FG Demo - SSO cert rotation blocked` with `state = blocked` and blocker evidence | Proactive graph creates a blocked-work finding with evidence, proposed recipient, next step, draft action, and human gate | [LangSmith trace](https://smith.langchain.com/public/352e0204-8782-4233-8857-1d46281627bf/r): `mode=proactive`, `decision=create_finding`, `nodePath=normalizeTrigger -> resolveScope -> fetchCurrentObject -> filterVisibleEvidence -> reasonProactiveCreate -> persistFleetGraphState -> produceOutput`. |
| 2 | User asks why the flagged issue was flagged from the issue/sprint context | On-demand graph explains the existing finding and drafts next action without mutating Ship | [LangSmith trace](https://smith.langchain.com/public/3f7209df-4b19-4769-bcc8-6fe78b57b093/r): `mode=on_demand`, `decision=explain`, `nodePath=normalizeTrigger -> resolveScope -> fetchCurrentObject -> filterVisibleEvidence -> produceOutput`. |
| 3 | User asks FleetGraph to reword the draft with extra context | On-demand graph refines the confirmation-card draft in place without sending/posting | [LangSmith trace](https://smith.langchain.com/public/cf7aa1bb-e0c9-4613-ae74-0154189bdec8/r): `mode=on_demand`, `decision=refine_draft`, `nodePath=normalizeTrigger -> resolveScope -> fetchCurrentObject -> filterVisibleEvidence -> refineDraft -> persistFleetGraphState -> produceOutput`. |
| 4 | Candidate issue already has an open finding with the same dedupe key | Proactive graph updates or suppresses duplicate finding | Local demo detector output from `pnpm fleetgraph:demo -- --capture-traces`: `decision=update_finding` for `FG Demo - Duplicate open finding control`; focused golden/core tests cover `nodePath=normalizeTrigger -> resolveScope -> fetchCurrentObject -> filterVisibleEvidence -> refreshExistingFinding -> persistFleetGraphState -> produceOutput`. |
| 5 | Blocked signal is removed before recheck | Proactive graph resolves or quietly exits | Nice-to-have |
| 6 | Evidence is not visible to current user | Graph returns restricted-context output or quiet exit | Nice-to-have |

## Architecture Decisions

- Use LangGraph for the shared graph and shared trace links for reviewer evidence.
- Run inside the API process for MVP, with clean module boundaries for later extraction.
- Use deterministic SQL candidate selection before LLM reasoning.
- Persist FleetGraph-owned findings rather than mutating Ship work records.
- Make proactive mode responsible for findings; on-demand mode explains, drafts, and refines without mutating Ship.
- Implement contextual UI first. A global FleetGraph panel is not MVP.
- Persist trace metadata. A reviewer/debug trace UI is nice-to-have.
- Use heartbeat/run metadata first. DB lease is not MVP for a single deployed worker, but is required if production runs multiple API instances.
- Keep a dedicated FleetGraph worker process with durable `fleetgraph_jobs` as the preferred post-MVP reliability path once API horizontal scaling or operational SLA pressure appears.

## Cost Analysis

FleetGraph MVP is currently running in deterministic text mode for reviewer/demo paths. The graph records token/cost metadata on every run, but the captured local demo and test runs made zero model calls.

Actual local run accounting from `fleetgraph_runs` after `pnpm fleetgraph:demo -- --capture-traces` on 2026-05-27:

| Mode | Decision | Runs | Model calls | Input tokens | Output tokens | Estimated cost |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| on_demand | explain | 27 | 0 | 0 | 0 | $0 |
| on_demand | refine_draft | 20 | 0 | 0 | 0 | $0 |
| proactive | create_finding | 19 | 0 | 0 | 0 | $0 |
| proactive | resolve | 1 | 0 | 0 | 0 | $0 |
| proactive | update_finding | 8 | 0 | 0 | 0 | $0 |

Development/test model spend for the captured FleetGraph MVP path: **$0**. This is not a claim that production reasoning will be free; it is an honest report that the current reviewer-safe graph path uses deterministic generation and records zero model calls.

Production assumptions if real proactive-create model calls are enabled later:

- Polling ticks: every 2 minutes, 720 ticks/day.
- LLM cost on empty ticks: zero.
- Normal proactive finding target: 2,000-4,000 input tokens and 500-1,000 output tokens per model-backed create.
- Heavier rollups are not part of MVP.
- Main cost cliffs: broad workspace reasoning, noisy candidate generation, repeated duplicate processing, oversized context, and broad on-demand prompts.

Working formula:

`monthly cost = (proactive graph runs + rechecks + on-demand runs) * average model cost per run`

Scale projection, using $0 for deterministic MVP paths and a planning placeholder of $0.01 per future model-backed graph run:

| Scale | Monthly deterministic MVP cost | If future model-backed runs average $0.01 | Assumption |
| --- | ---: | ---: | --- |
| 100 users | $0 | $6.30-$12.90/month | 1-3 proactive creates/day plus 20-40 on-demand runs/day |
| 1,000 users | $0 | $63-$129/month | 10-30 proactive creates/day plus 200-400 on-demand runs/day |
| 10,000 users | $0 | $630-$1,290/month | 100-300 proactive creates/day plus 2,000-4,000 on-demand runs/day |

The most dangerous cost assumption is not polling. It is broad on-demand prompts that expand from one page into whole-workspace reasoning.

Mitigations:

- Deterministic candidate filters.
- Dedupe keys.
- Finding status and recheck metadata.
- Severity ranking.
- Bounded context fetches.
- Permission-filtered evidence.
- Scope narrowing for broad on-demand requests.

## Non-MVP / Later

- Hybrid event + polling trigger model.
- Dedicated FleetGraph worker process with durable job claiming, retries, lease expiry, and dead-letter/cleanup policy.
- Global FleetGraph panel.
- Trace/debug reviewer UI.
- Snooze support.
- DB lease for multiple API instances.
- External notifications/comments after approval.
- Additional detectors: orphaned high-priority work, missing owner, sprint carryover risk, silent accountable owner, program-level repeated drift.

## Direction If Time

FleetGraph should grow toward a project risk ledger and drift autopilot, but the week-five promise stays the action-ready blocked-work loop.

The first stretch is draft refinement inside the confirmation card. Users should be able to add context FleetGraph cannot know, disagree with the framing, change tone, or ask for a different audience without copying the draft into another LLM. This turns the human gate from a ceremonial approval button into a real collaboration surface.

The next stretch is a finding timeline: "flagged because," "changed since," "still blocked because," and "needs you because." This keeps users oriented while the agent does more of the manual context gathering.

After that, additional detectors should reuse the same graph and findings model: sprint carryover risk, silent owner, orphaned high-priority work, missing execution context, and program-level repeated drift. These should not become separate assistants. They are more ways to update the same risk ledger and prepare the next useful action.

Future blocker modeling should consider explicit issue-to-issue dependency links: "this issue is blocked by that issue" and automatic unblock cues when the blocking issue closes. That is useful, but it is not required for the Epic 8 reviewer demo path.
