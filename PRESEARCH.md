# Presearch Checklist Answers

## Final Proof Posture

The final Week 5 proof posture is all-signal and deployed: `blocked`, `stale`, and `at_risk` are not merely design discovery items. Each final claimed signal must be backed by executable golden cases and deployed proof data from real Ship tables: worker ticks, attention events or repair-scan output, FleetGraph findings/runs, and reviewer-visible notifications. Local E2E remains deterministic proof of the loop mechanics; deployed proof is what supports deployed no-user-present claims.

The proof packet is the source of truth for grading claims. It must publish under `/fleetgraph-observability/proof/latest.html`, include graph invocation count, model call count, input/output token totals, deterministic versus real-model run counts, estimated FleetGraph runtime cost, and trace links for blocked/stale/at-risk/on-demand. Missing trace links or missing deployed signal evidence is a blocked/risk proof state, not a pass with placeholder text.

## Phase 1: Define Your Agent

### 1. Agent Responsibility Scoping

- What events in Ship should the agent monitor proactively?

  **FleetGraph is a project drift operator, not an alert bot.**
  It monitors Ship for execution drift: blocked work, stale blockers, missing ownership, missing progress signals, sprint carryover risk, repeated issue movement across weeks, high-priority work without project/program context, and project/program patterns that indicate a team is losing control of delivery. Raw events are only inputs. FleetGraph should care when an event changes the next useful action for a PM, engineer, or director.

  MVP should prove this with one sharp detector: **visible blocked issues**. The candidate condition must be deterministic before the LLM runs: an issue has `state = blocked`, is not deleted/archived/private for the target surface, has the existing source associations required by the current finding schema, and does not already have an open finding for the same dedupe key. Priority, current-week membership, owner/assignee, and non-empty blocker text are not eligibility gates. FleetGraph surfaces the blocked-work finding within 5 minutes. The graph then does the manual PM work: gathers visible evidence, explains why it matters now, identifies the smallest useful audience, drafts the unblock path only when that action is approved for the surface, and asks a human before contacting people or changing Ship's source of truth.

- What constitutes a condition worth surfacing?

  **A condition is worth surfacing when FleetGraph can name the drift, prove it with evidence, and prepare the next action.**
  A finding should not be "something changed." It should answer:

  - What is drifting?
  - Why does it matter now?
  - Who is the smallest useful audience?
  - What evidence supports the claim?
  - What should happen next?
  - What can FleetGraph do without asking?
  - What decision, if any, must a human make?

  FleetGraph should stay quiet for routine CRUD, low-confidence guesses, duplicate findings, and observations that do not change anyone's next action. It should also stay quiet when it lacks visible evidence or a safe route for the finding. Missing owner or missing blocker text is context to surface, not an automatic suppression reason.

- What is the agent allowed to do without human approval?

  **FleetGraph should be aggressive inside FleetGraph-owned state and conservative at Ship mutation boundaries.**
  It may autonomously read permitted Ship data, run deterministic candidate checks, invoke the graph for eligible candidates, classify severity/confidence, create and update FleetGraph findings, group related findings, mark duplicate findings, close findings when the source condition resolves, reopen a dismissed finding when evidence materially changes, maintain watermarks/dedupe keys/cooldowns, prepare private summaries, draft messages, and show contextual in-app findings.

  Those are real actions: FleetGraph maintains a live project-risk ledger. It should not wait for permission to understand the project, classify drift, or keep its own findings current.

- What must always require confirmation?

  **Any action that mutates Ship's canonical work records, changes accountability, or contacts another person requires confirmation.**
  This includes assigning or reassigning owners, changing issue status, changing priority, moving work between sprints/weeks, editing documents, changing due dates, creating new work items, posting comments, sending notifications, escalating to directors, or marking a project risk as accepted on behalf of the team.

  The human should not be asked to do clerical work. FleetGraph should present a confirmation card with the evidence, proposed action, affected people/objects, and exact message or mutation. The human decision should be accept, edit, snooze, dismiss, or escalate.

- How does the agent know who is on a project?

  **FleetGraph derives project membership from Ship's graph, not a separate roster.**
  It reads project documents, program associations, linked issues, document associations, accountable users, owners, assignees, recent contributors, sprint/week ownership, and workspace roles. Direct owners and assignees are active participants. Project owners, PMs, program leads, supervisors, admins, and directors are escalation candidates. Recent contributors are context sources, not default recipients.

  If the graph is incomplete, FleetGraph should lower confidence and explain the missing relationship instead of pretending it knows the team.

- How does the agent know who to notify?

  **FleetGraph uses the smallest-useful-audience rule with explicit fallback paths.**
  For issue-level findings, the first target is the assignee when the action is execution work and the owner/accountable person when the action is scope, priority, or escalation. For missing ownership, the target is the project owner or PM. For sprint/week risk, the target is the sprint/week owner or PM. For program drift, the target is the program lead or director only when the pattern is repeated, severe, overdue, or explicitly escalated by a PM.

  Permission boundaries override routing. FleetGraph must not leak hidden document or project details through summaries. If the best recipient cannot see the evidence, FleetGraph routes to someone who can act on visible evidence or labels the finding as restricted-context: enough to explain that a risk exists, not enough to expose hidden source material.

- How does the on-demand mode use context from the current view?

  **On-demand mode starts from the user's current object and runs through the same graph core as proactive mode.**
  When invoked from an issue, project, sprint/week, document, or dashboard, FleetGraph receives the object type, object ID, visible page state, selected filters, user role, and permissions. It resolves the local graph around that object first: linked issues, project/program associations, owners, recent activity, open FleetGraph findings, and sprint/week state.

  The user should be able to ask "why was this flagged?", "what changed since I last looked?", "what should I do next?", or "draft the unblock message" without restating the page context. The trigger differs from proactive mode; the reasoning spine does not.

### 2. Use Case Discovery (minimum 5)

- Think about the roles: Director, PM, Engineer
- For each use case define: role, trigger, what the agent detects or produces, what the human decides
- Do not invent use cases - discover pain points first

#### Use Cases

Final Week 5 proof claims only the blocked, stale, at-risk, and bounded on-demand/page-context paths mapped in `FLEETGRAPH.md`. The broader discovery cases below are product-direction notes unless explicitly called out as implemented proof.

**FleetGraph should focus on project drift that Ship can prove from its own documents, issues, weeks/sprints, standups, plans, reviews, associations, and activity history.**

##### **PM** - visible issue is marked blocked

   **Trigger:** a visible issue has `state = blocked` and does not already have an open finding for the same source association.
   **Agent detects or produces:** blocked-work finding, issue owner/assignee when known, affected sprint/project when associated, linked dependency context, latest blocker text when present, severity/confidence, smallest useful audience, and next unblock step.
   **Human decides:** send/edit the message, escalate, move the work, accept the carryover risk, or snooze.

##### **PM** - sprint commitment is silently turning into carryover (future direction)

   **Trigger:** active sprint/week is near its end and important active issues remain open, especially if they are blocked, unowned, or missing recent updates.
   **Agent detects or produces:** likely carryover list, owners, repeated blockers, missing-update evidence, suggested re-scope options, and a recovery note.
   **Human decides:** re-scope, reassign, defer, notify owners, escalate, or accept carryover.

##### **Engineer** - assigned issue lacks enough context to execute (future direction)

   **Trigger:** an engineer opens an assigned issue with sparse description, missing acceptance criteria, missing project/program association, or conflicting linked context.
   **Agent detects or produces:** relevant linked docs/issues, recent decisions, missing acceptance criteria, likely accountable person, and clarification questions.
   **Human decides:** ask the PM, update the issue, link missing context, or proceed with known constraints.

##### **Director** - repeated drift across a program indicates management attention is needed (future direction)

   **Trigger:** multiple projects under one program show stale blockers, missing updates, high carryover, or repeated ownership gaps.
   **Agent detects or produces:** program-level drift pattern, affected projects, repeated accountable people or dependencies, trend evidence, and recommended escalation target.
   **Human decides:** request a recovery plan, intervene with a PM, reassign attention, or dismiss the pattern.

##### **PM/Director** - accountable owner has gone silent (future direction)

   **Trigger:** planned or important active work has an accountable person but no standup, issue update, review, or progress signal during the expected cadence.
   **Agent detects or produces:** missing-progress finding, last known activity, expected cadence, affected work, accountable person, and a drafted nudge.
   **Human decides:** send/edit the nudge, mark expected absence, snooze until next cadence, or escalate.

##### **PM/Engineer/Director** - explain what changed since I last looked

   **Trigger:** a user invokes FleetGraph from a project, issue, sprint/week, program, or dashboard after meaningful activity occurred since their last view.
   **Agent detects or produces:** concise change summary, new risks, resolved blockers, new ownership/scope changes, open findings, and suggested next actions.
   **Human decides:** follow up, approve a prepared action, ask a deeper question, dismiss, or update the plan.

##### **PM** - high-priority work exists outside the planning graph (future direction)

   **Trigger:** a high-priority issue is created or updated without an owner, project/program association, or active sprint/week context.
   **Agent detects or produces:** orphaned-priority finding, missing relationship, likely project/program candidates, likely accountable person, and a proposed linking/ownership action.
   **Human decides:** link the issue, assign an owner, defer it, downgrade it, or dismiss it as intentionally unplanned.

### 3. Trigger Model Decision

- When does the proactive agent run without a user present?

  **FleetGraph now uses a hybrid trigger model: durable attention events first, plus a 2-minute server-side repair scan.**
  Issue mutations enqueue FleetGraph-owned attention events after the Ship write succeeds. The worker claims pending events, evaluates the changed source with deterministic policy, and sends only eligible candidates into the shared graph. The scheduled scan remains as the catch-up path for missed events and open finding revalidation.

  The deployed latency path is:

  1. Ship issue state changes.
  2. The mutation enqueues a `fleetgraph_attention_events` row.
  3. The worker claims the event or the next 2-minute repair scan finds the source.
  4. Deterministic policy selects `blocked`, `stale`, `at_risk`, or quiet exit.
  5. Eligible candidates enter the shared graph.
  6. The graph persists a FleetGraph finding/run and returns UI-visible output.

- Poll vs. webhook vs. hybrid - what are the tradeoffs?

  **The final model is hybrid because it gives fast event-driven freshness without trusting events as the only safety net.**

  - **Polling only:** simple, but either wastes work or waits up to the next tick for every change.
  - **Events only:** fast, but missed event writes or worker failures can silently lose attention signals.
  - **Hybrid:** events enqueue changed scopes immediately; polling catches missed events, rechecks open findings, handles cooldowns, and prevents silent drift.

  The Week 5 implementation uses the hybrid model directly: FleetGraph-owned events for freshness and a worker repair scan for resilience.

- How stale is too stale for your use cases?

  **Newly eligible high-confidence risks are too stale if they are not visible within 5 minutes.**
  The timed path treats a visible blocked issue as eligible as soon as the blocked state appears in Ship. Staleness, priority, and current-week membership can change the signal type or reason, but they are not reasons to wait silently once policy says the source is eligible. For sprint risk, the clock starts when the sprint/week enters the risk window and qualifying important work remains open. For stale work, the clock starts when the meaningful-update threshold passes.

  On-demand answers should use fresh reads at request time. Cached context may help compare prior state, but current decisions must be based on fresh permission-checked data.

- What does your choice cost at 100 projects? At 1,000?

  **Project count is not the main cost driver; candidate count is.**
  A 2-minute repair scan runs 720 ticks/day. A naive full scan would touch 72,000 project checks/day at 100 projects and 720,000 checks/day at 1,000 projects. That is acceptable only as cheap SQL, not as graph execution. The event path avoids waiting for the repair scan on normal issue mutations.

  MVP assumes:

  - 720 worker ticks/day.
  - zero LLM cost for ticks with no eligible candidate.
  - one graph run per eligible finding or finding recheck.
  - candidate checks are bounded by recent `updated_at` windows, open finding recheck times, and deterministic risk predicates.

  The working estimate must be candidate-based, not project-based:

  `daily graph runs = new eligible candidates + due rechecks + on-demand invocations`

  For MVP, the target is tens of proactive graph runs/day at 100 projects, but that is only defensible if most ticks find no eligible candidates and open findings recheck on a cooldown instead of every tick. At 1,000 projects, FleetGraph needs event-backed candidate selection, per-workspace/project budgets, severity ranking, concurrency caps, dedupe keys, and cooldowns so a noisy workspace cannot produce a cost cliff. On-demand chat may become the larger cost driver, so final cost analysis must include user invocation assumptions, not only polling.

## Phase 2: Graph Architecture

### 4. Node Design

- What are your context, fetch, reasoning, action, and output nodes?

  **FleetGraph uses one graph with two entry modes and a shared reasoning core.**

  The shared graph shape:

  1. `normalizeTrigger`: convert proactive candidate or on-demand request into common state.
  2. `resolveScope`: identify workspace, user/service principal, object type, object ID, mode, permissions, and candidate reason.
  3. `fetchCurrentObject`: load the anchor object first when one exists.
  4. `fetchNeighborContext`: load linked issues, docs, project/program associations, sprint/week state, owners, recent activity, prior findings, and relevant standups/plans/reviews.
  5. `filterVisibleEvidence`: enforce recipient/user visibility before reasoning output can be shown.
  6. `reasonAboutDrift`: classify drift, severity, confidence, recurrence, likely accountable person, smallest useful audience, and next action.
  7. `decideAction`: choose quiet exit, internal finding update, contextual answer, confirmation card, or escalation candidate.
  8. `persistFleetGraphState`: create/update findings, dedupe keys, watermarks, evidence snapshots, snoozes, and run metadata.
  9. `produceOutput`: return contextual chat answer, in-app finding, notification candidate, or human confirmation card.

  Proactive mode enters with a candidate condition. On-demand mode enters with user intent. Both use the same scope resolution, fetch, evidence, reasoning, action, and output machinery. The submitted traces should prove different branches, not just different inputs through the same pipeline: for example, a proactive blocked-work run should create/update a finding, an on-demand "why was this flagged?" run should explain an existing finding, and a duplicate/resolved/restricted proactive run should exit quietly.

- Which fetch nodes run in parallel?

  **Fetches parallelize only after scope and permissions are known.**
  The current object fetch anchors the query plan. After that, independent reads can run in parallel: linked issues, related documents, sprint/week state, project/program rollups, owner/member lookup, recent activity, existing FleetGraph findings, and relevant standup/plan/review documents.

  Proactive candidate scopes can also be processed concurrently with per-workspace and global caps. Permission checks and evidence filtering are not optional cleanup steps; they are part of the graph path before output.

- Where are your conditional edges and what triggers each branch?

  **Branches should prove this is a graph, not a pipeline.**

  Conditional edges:

  - **Mode branch:** proactive candidate vs. on-demand request.
  - **Eligibility branch:** candidate still qualifies vs. condition resolved vs. insufficient data.
  - **Intent branch:** on-demand explanation vs. summary vs. proposed action.
  - **Permission branch:** evidence visible vs. restricted evidence vs. no safe recipient.
  - **Confidence branch:** high-confidence finding vs. low-confidence private note vs. quiet exit.
  - **Severity branch:** contextual finding vs. urgent finding vs. escalation candidate.
  - **Action-risk branch:** autonomous FleetGraph state update vs. human confirmation before Ship mutation/contact.
  - **Dedupe branch:** new finding vs. update existing finding vs. suppress duplicate.
  - **Snooze/dismiss branch:** stay quiet unless material change or severity increase.

### 5. State Management

- What state does the graph carry across a session?

  **Within a graph run, FleetGraph carries only what it needs to explain the reasoning path and produce a bounded output.**
  Run state includes mode, trigger reason, workspace, user/service principal, target object IDs, permissions, fetched object summaries, visible evidence, detected drift, confidence/severity, proposed recipients, proposed action, confirmation status, dedupe key, and trace/run ID.

  Raw documents and broad activity logs should not live in session state longer than needed. Durable Ship state should be referenced by ID and refetched when accuracy matters.

- What state persists between proactive runs?

  **FleetGraph persists finding state, not a shadow copy of Ship.**
  Persistent FleetGraph state includes worker watermarks, scan heartbeat, open findings, finding status, dedupe keys, evidence snapshots, snooze/dismiss decisions, notification history, escalation cooldowns, confirmation requests, material-change markers, and trace/run IDs.

  Ship remains the source of truth for issues, documents, owners, associations, sprint/week status, and project/program state.

- How do you avoid redundant API calls?

  **FleetGraph separates cheap candidate selection from expensive context reasoning.**
  The worker first performs SQL-level eligibility checks. Only candidates that pass deterministic filters enter graph reasoning. Within a run, fetched objects are cached by ID so parallel nodes do not request the same object twice. Across runs, watermarks, dedupe keys, finding status, recheck times, and cooldowns prevent unchanged conditions from being repeatedly reasoned over.

  On-demand runs fetch from the current object outward. Broad prompts like "what is wrong with everything?" should trigger scope narrowing or summarized rollups before any large graph expansion.

### 6. Human-in-the-Loop Design

- Which actions require confirmation?

  **Humans approve decisions that alter Ship's work record, accountability, or communications.**
  Confirmation is required before assigning/reassigning work, changing status/priority/sprint/week, editing documents, changing due dates, creating issues, posting comments, sending notifications, escalating, or accepting risk on behalf of the team.

  FleetGraph does not need confirmation to keep its own findings accurate. It can create, update, dedupe, group, rank, resolve, reopen, route, and display FleetGraph findings autonomously. Humans approve consequences; FleetGraph should handle diagnosis, triage, evidence gathering, and routing without asking. Draft preparation/refinement should stay internal until the product surface explicitly earns it.

- What does the confirmation experience look like in Ship?

  **Confirmation should be an action card in context, not a generic chatbot exchange.**
  FleetGraph can live in a contextual side drawer or panel, but the primary interaction should be object-aware findings and action cards. The current approved surface is the left-rail notification plus contextual chat explanation. Closing the chat should not lose the underlying finding or graph context.

  Chat is contextual. It should know the current page and the selected finding without the user restating them. Draft/refine controls are not product-approved surface area yet.

- What happens if the human dismisses or snoozes?

  **Dismiss and snooze become part of the finding state and future graph routing.**
  Dismiss closes the current finding for its dedupe key unless the underlying condition materially changes. Snooze hides the finding until a time or event threshold, such as next standup, tomorrow, sprint end, new blocker evidence, or severity increase. If evidence materially worsens during snooze, FleetGraph may resurface the finding with the new evidence and trace why it broke silence.

### 7. Error and Failure Handling

- What does the agent do when Ship API is down?

  **FleetGraph stops creating new claims when it cannot validate current Ship state.**
  Proactive runs fail the current scope, record the error, retry with backoff, and avoid creating or escalating findings from incomplete data. Existing findings remain visible with stale-data indicators. On-demand mode tells the user which context failed to load and offers a retry rather than answering from stale memory.

- How does it degrade gracefully?

  **FleetGraph reduces capability instead of pretending the full agent is working.**
  If graph reasoning fails, deterministic rules can still maintain simple finding state for known conditions, but new natural-language claims should not be generated. If a detailed fetch fails, the graph can update run metadata and show existing findings as stale, but should not create new findings. If notification/action delivery fails after confirmation, the finding stays open with retry state. If tracing fails, the run is incomplete and should not be used as submission evidence.

- What gets cached and for how long?

  **Short-lived context can be cached for performance; decisions use fresh permission-checked state.**
  Within a run, fetched objects can be cached for that run. Across runs, FleetGraph persists watermarks, dedupe keys, finding state, snooze/dismiss state, notification/action history, evidence snapshots, and trace IDs. Recently fetched summaries may be cached for a few minutes, but must be invalidated by newer `updated_at` values, event watermarks, or explicit on-demand refresh.

  Permission and visibility decisions should be checked per run. The service principal may read for proactive detection, but every recipient-visible claim must be backed by evidence that recipient can see.

## Phase 3: Stack and Deployment

### 8. Deployment Model

- Where does the proactive agent run when no user is present?

  **The proactive agent runs server-side as a background worker, not in the browser.**
  For MVP, it can run inside the Ship API process or as a companion worker using the same database and internal service layer. It scans candidates, invokes the graph, persists FleetGraph findings, and makes those findings visible in the UI. If load or reliability demands it later, the worker can become a separate service/job runner.

- How is it kept alive?

  **The worker is kept alive by the deployment platform and protected by a heartbeat/lease.**
  The API or companion process starts the polling loop on boot. A database-backed lease prevents duplicate scans when multiple instances run. A heartbeat records the last successful tick, failed tick, and active lease owner. If the worker falls behind, it prioritizes newest/highest-severity candidates and exposes degraded latency rather than silently missing the SLA.

- How does it authenticate with Ship without a user session?

  **FleetGraph should run server-side with explicit system attribution; the durable design is a scoped service principal.**
  For MVP, FleetGraph may use the existing server-side access path to read eligible data, create/update FleetGraph findings, and prepare notification/action candidates. The architecture direction is a scoped service principal that can do those same actions without a browser session. It cannot bypass normal document visibility in recipient-facing output. Any confirmed mutation or outbound communication must record both FleetGraph and the approving user.

  The key safety rule: service-principal access may help detect drift, but it must not leak restricted evidence to users who cannot see it.

### 9. Performance

- How does your trigger model achieve the < 5 minute detection latency goal?

  **The MVP latency target is met by narrowing the proactive path to bounded deterministic candidates and a 2-minute polling cadence.**
  A newly visible blocked issue should be picked up on the next tick, enter graph reasoning immediately, and persist a UI-visible finding within the remaining time budget. Stale-blocker severity can depend on a longer threshold, but blocked-work visibility cannot. The worker should prioritize high-confidence/high-severity candidates, cap concurrent graph runs, and skip or defer lower-ranked candidates if it is behind.

  The SLA path for the MVP detector is intentionally narrow: blocked issue -> candidate query -> bounded context fetch -> graph reasoning -> finding persisted -> UI visible.

- What is your token budget per invocation?

  **LLM tokens are spent only after deterministic filters identify a candidate.**
  Eligibility scans use zero LLM tokens. A normal proactive finding should target roughly 2,000-4,000 input tokens and 500-1,000 output tokens by sending summarized issue/project/sprint context, not raw workspace data. A heavier program rollup can use roughly 6,000-10,000 input tokens and 1,000-2,000 output tokens, but that is not the MVP path. On-demand chat starts from current-view context and expands only when needed.

  Final cost analysis uses one explicit measured-projection formula:

  `monthly model cost = measured cost per graph invocation * assumed monthly graph invocations`

  The current proof generator uses 30 graph invocations per user per month for the 100/1,000/10,000-user projections. Richer project/issue/candidate/recheck assumptions remain useful for future capacity planning, but they are not the Week 5 proof formula unless the script is changed to compute them.

  Any prompt likely to exceed budget should summarize first, narrow scope, or ask the user to choose a smaller scope.

- Where are the cost cliffs in your architecture?

  **The cost cliffs are full-workspace reasoning, noisy candidate generation, oversized context, and broad on-demand prompts.**
  FleetGraph becomes expensive if every poll reasons over every project, if raw documents/activity logs are sent to the model, if unchanged findings are reprocessed, if dismissed findings keep resurfacing, or if program rollups include every child object instead of summaries.

  The mitigations are deterministic candidate filters, watermarks, dedupe keys, cooldowns, severity ranking, per-workspace/project budgets, summarized context, permission-filtered evidence, and explicit scope narrowing for broad requests.
