# Presearch Checklist Answers

## Phase 1: Define Your Agent

### 1. Agent Responsibility Scoping

- What events in Ship should the agent monitor proactively?

  **FleetGraph should proactively monitor Ship events that indicate project execution drift:**
  issue creation and updates, owner/assignment changes, blocker and priority changes, stale issue activity, sprint/week boundary changes, missing standups/plans/reviews, carryover growth, and project/program association changes. It should also watch human-written updates for blocker/risk/decision language. The agent should treat raw CRUD events as inputs, not notifications; it should only surface an event when it implies a project risk, missing accountability, or a useful next decision.

- What constitutes a condition worth surfacing?

  **A condition is worth surfacing when it is actionable, role-relevant, and not already obvious from normal workflow.**
  FleetGraph should surface conditions where delay, missing ownership, blocked work, missing updates, sprint risk, or cross-project dependency risk requires a human decision or a prepared next action. It should suppress routine activity, duplicate alerts, and low-confidence observations. The bar is: "Would the notified person reasonably change what they do next because of this?" If not, the agent should stay quiet.

- What is the agent allowed to do without human approval?

  **FleetGraph can act autonomously when the action is low-risk, reversible, and informational.**
  It may analyze Ship data, classify detected conditions, create an internal finding, update its own alert state, group related signals, draft suggested messages, prepare summaries, and show contextual recommendations in the UI. It may also mark a finding as duplicate or snoozed according to existing user preferences. It should not autonomously change issue ownership, sprint commitments, document content, project status, due dates, or send broad notifications.

- What must always require confirmation?

  **FleetGraph must always require confirmation before taking actions that change Ship's source of truth, affect another person's responsibilities, or create a visible team commitment.**
  This includes assigning or reassigning owners, changing issue status or priority, moving work between sprints, editing documents, changing due dates, posting comments or notifications to other users, escalating to leadership, creating new work items, or closing/dismissing a project risk. The agent can recommend these actions and draft the content, but a human must approve before they happen.

- How does the agent know who is on a project?

  **FleetGraph determines project membership from Ship's existing data model rather than maintaining a separate roster.**
  For a project, it reads the project document, its program association, linked issues, document associations, owners/accountable users, assignees, recent contributors, and workspace memberships/roles. Direct owners and assignees count as active project participants. Program leads, sprint owners, supervisors, and workspace admins/directors are escalation candidates, not default participants. If the relationship graph is incomplete, the agent should say its confidence is low instead of pretending it knows the team.

- How does the agent know who to notify?

  **FleetGraph chooses notification targets using a smallest-useful-audience rule.**
  For issue-level findings, it notifies the owner or assignee first. For missing updates, it notifies the accountable person. For sprint-level risk, it notifies the sprint owner or PM. For project/program-level risk, it notifies the project owner or program lead. Directors/admins are notified only when the condition is severe, repeated, overdue, or explicitly escalated by a PM. If the agent cannot identify a clear owner, it routes the finding to the project/PM role with a low-confidence explanation instead of broadcasting to everyone.

- How does the on-demand mode use context from the current view?

  **On-demand mode starts from the user's current Ship view as the graph's primary context.**
  When invoked from an issue, project, sprint/week, document, or dashboard view, FleetGraph receives the current object type, object ID, visible page state, selected filters, and the user's role/permissions. It uses that context to fetch only the relevant neighboring data first: linked issues, owners, associations, recent updates, sprint status, and project/program rollups. The user should not need to restate what they are looking at; the agent should answer and recommend actions as if it is sitting inside that page.

### 2. Use Case Discovery (minimum 5)

- Think about the roles: Director, PM, Engineer
- For each use case define: role, trigger, what the agent detects or produces, what the human decides
- Do not invent use cases - discover pain points first

#### Use Cases

**FleetGraph should focus on project drift pain points that PMs, engineers, and directors already feel in Ship.**

##### **PM** - blocked issue stuck in active sprint

   **Trigger:** an issue is marked blocked, or blocker language appears in updates, and there is no meaningful progress update after 24 hours.
   **Agent detects or produces:** blocker summary, owner, related dependency, affected sprint/project, and a drafted unblock message.
   **Human decides:** notify the owner, escalate, move the work, accept the risk, or snooze.

##### **PM** - sprint commitment at risk

   **Trigger:** an active sprint is near its end and high-priority or committed issues remain open.
   **Agent detects or produces:** likely carryover list, risk summary, owners, and suggested re-scope/reassignment options.
   **Human decides:** re-scope, reassign, escalate, defer, or accept carryover.

##### **Engineer** - missing context on assigned work

   **Trigger:** an engineer opens an assigned issue with sparse description, unclear acceptance criteria, or missing project/program links.
   **Agent detects or produces:** linked docs, related issues, recent decisions, owner context, and clarification questions.
   **Human decides:** update the issue, ask the PM, link missing context, or start work.

##### **Director** - program health drift

   **Trigger:** multiple projects in a program show stale blockers, missing updates, or growing sprint carryover.
   **Agent detects or produces:** program-level risk rollup, affected projects, repeated patterns, and recommended escalation targets.
   **Human decides:** intervene, ask for a recovery plan, reassign attention, or dismiss the finding.

##### **PM/Director** - accountability silence

   **Trigger:** planned work has an owner or accountable person, but there is no standup or progress signal during the expected cadence.
   **Agent detects or produces:** missing-update list, last known activity, accountable person, and a drafted nudge.
   **Human decides:** send the nudge, mark an expected absence, snooze, or escalate.

##### **PM/Engineer/Director** - "what changed since I last looked?"

   **Trigger:** a user invokes FleetGraph from a project, sprint, issue, or dashboard after meaningful activity occurred since their last view.
   **Agent detects or produces:** concise change summary, important new risks, resolved items, new blockers, and suggested next actions.
   **Human decides:** follow up, update plan, notify someone, dismiss, or ask a deeper question.

### 3. Trigger Model Decision

- When does the proactive agent run without a user present?

  **The proactive agent runs as a background worker on a fixed short interval, independent of any logged-in user.**
  For MVP, FleetGraph should run every 2 minutes against recently changed projects/sprints/issues and any previously open findings that need rechecking. That interval leaves room for fetch/reasoning/notification time while still meeting the < 5 minute detection requirement. The worker should process only changed or at-risk scopes, not the entire workspace every run.

- Poll vs. webhook vs. hybrid - what are the tradeoffs?

  **FleetGraph should use a hybrid trigger model long term, with polling as the MVP path.**
  Polling is simple, reliable, and easy to deploy quickly, but it can waste work and becomes expensive if every run scans every project. Webhooks or an internal event queue are cheaper and faster for fresh changes, but require more integration, replay handling, and failure recovery. A hybrid model gives the best shape: events enqueue changed scopes immediately, while a short polling sweep catches missed events, retries open findings, and prevents silent drift. For MVP, polling every 2 minutes is enough if each run is scoped to recent changes and open findings.

  **Tradeoffs:**
  - **Polling:** simple, reliable, easy to deploy; can waste work and becomes expensive if every run scans every project.
  - **Webhooks:** cheaper and faster for fresh changes; require more integration, replay handling, and failure recovery.
  - **Hybrid:** events enqueue changed scopes immediately, while a short polling sweep catches missed events, retries open findings, and prevents silent drift.

- How stale is too stale for your use cases?

  **Too stale depends on the condition, but newly eligible risks should be detected within 5 minutes.**
  FleetGraph should notice when a condition crosses its threshold within one or two worker intervals. Blocker and sprint-risk conditions are too stale if surfaced more than 5 minutes after becoming eligible. Missing standups or accountability silence are cadence-based, so they become eligible after the expected update window passes. On-demand answers should use current data at request time, with cached context treated as stale after a few minutes unless it is only being used for comparison.

- What does your choice cost at 100 projects? At 1,000?

  **The cost is acceptable only if the worker filters with cheap database queries before invoking the LLM.**
  A 2-minute polling loop runs 720 times per day. At 100 projects, a naive full scan touches 72,000 project checks/day; at 1,000 projects, it touches 720,000 project checks/day. That is still manageable for lightweight SQL eligibility checks, but not for graph/LLM runs on every project. FleetGraph should first query for recently changed or already-risky scopes, then invoke the graph only for candidates. At 100 projects this likely means tens of graph runs per day, not thousands. At 1,000 projects, the system needs event-backed candidate selection, batching, deduplication, and per-project cooldowns to avoid a cost cliff.

## Phase 2: Graph Architecture

### 4. Node Design

- What are your context, fetch, reasoning, action, and output nodes?

  **FleetGraph uses one shared graph with different entry context for proactive and on-demand runs.**
  Context nodes normalize the trigger into a common graph state: mode, user, workspace, current view, target object, permissions, and reason for running. Fetch nodes load the relevant Ship data: current object, linked issues/docs, sprint/week state, project/program rollups, ownership/membership, recent activity, and prior FleetGraph findings. Reasoning nodes classify the situation, decide whether it is worth surfacing, rank severity, select recipients, and propose next actions. Action nodes create or update FleetGraph findings, draft messages, request confirmation, snooze/dedupe alerts, or prepare allowed read-only summaries. Output nodes return either an in-context chat response, an in-app notification/finding, or a human confirmation card.

- Which fetch nodes run in parallel?

  **After context and permissions are resolved, FleetGraph should fetch independent Ship context in parallel.**
  The current object fetch should run first when the graph is invoked from a specific page, because it anchors the rest of the query plan. After that, linked issues, related documents, sprint/week state, project/program rollups, ownership/membership, recent activity, and prior FleetGraph findings can run in parallel. Proactive runs can also parallelize candidate scopes across projects, as long as each scope has a concurrency limit. Permission checks and final visibility filtering should not be skipped or moved after reasoning.

- Where are your conditional edges and what triggers each branch?

  **FleetGraph branches on mode, confidence, severity, permission, and action risk.**
  The first branch routes proactive triggers to detection/scoring and on-demand triggers to user-intent handling. After fetch, a relevance branch exits quietly when no actionable condition exists. A confidence branch either proceeds, asks for clarification, or labels the finding low-confidence. A severity branch decides whether the result stays in-context, becomes an in-app finding, or is eligible for escalation. A permission branch prevents hidden data from influencing output. An action-risk branch separates autonomous read-only outputs from human-confirmation actions such as posting, assigning, moving, or escalating work.

### 5. State Management

- What state does the graph carry across a session?

  **Within a session, FleetGraph carries enough state to explain and continue the current reasoning path without refetching or losing context.**
  Session state includes mode, user/workspace identity, permissions, current view context, target object IDs, fetched summaries, detected conditions, confidence/severity scores, selected recipients, proposed actions, confirmation status, trace/run ID, and recent user messages. It should not carry unrestricted raw document or project data longer than needed; durable Ship data should be refetched or referenced by ID when accuracy matters.

- What state persists between proactive runs?

  **Between proactive runs, FleetGraph persists operational state about findings, not a shadow copy of Ship.**
  Persistent state should include last successful scan time, per-scope watermarks, open findings, finding status, snooze/dismiss decisions, dedupe keys, notification history, escalation cooldowns, confirmation requests, run/trace IDs, and lightweight evidence snapshots explaining why a finding was created. Ship remains the source of truth for projects, issues, documents, ownership, and sprint state.

- How do you avoid redundant API calls?

  **FleetGraph avoids redundant API calls by separating candidate detection from detailed reasoning fetches.**
  Each proactive run first uses cheap timestamp/status queries to find changed scopes, open findings, and conditions near threshold. The graph only fetches full issue/project/sprint context for candidates that pass that filter. Within a run, fetched objects are cached by ID so parallel nodes do not request the same data twice. Across runs, watermarks, dedupe keys, cooldowns, and finding status prevent repeated scans and repeated notifications for unchanged conditions. On-demand runs should fetch narrowly from the current view outward instead of loading the whole workspace.

### 6. Human-in-the-Loop Design

- Which actions require confirmation?

  **Any action that mutates Ship data, contacts another person, or changes accountability requires human confirmation.**
  Confirmation is required before assigning or reassigning owners, changing issue status/priority/sprint, editing documents, posting comments, sending notifications, escalating to directors, creating new issues, changing due dates, closing findings as accepted risk, or applying bulk changes. The graph may autonomously draft, summarize, classify, dedupe, and prepare these actions, but execution waits for explicit approval.

- What does the confirmation experience look like in Ship?

  **Confirmation should appear in a collapsible right-side FleetGraph drawer, pending UI review.**
  FleetGraph should stay collapsed by default as a small contextual tab or rail item, then open only when the user clicks it or when a high-relevance finding briefly peeks for attention. The open drawer shows the finding, evidence, proposed action, affected people/objects, and approval controls. Closing the drawer returns the user to the current Ship page without losing context. Risky or bulk actions should require a stronger review step before execution.

- What happens if the human dismisses or snoozes?

  **Dismiss and snooze update FleetGraph's finding state so the agent does not nag the user.**
  Dismiss closes the current finding and records the reason if provided, preventing the same dedupe key from resurfacing unless the underlying condition materially changes. Snooze hides the finding until a selected time or event threshold, such as tomorrow, next standup, sprint end, or severity increase. If the condition worsens during the snooze window, FleetGraph may resurface it with the new evidence. Both actions should be traceable so future runs can explain why a finding stayed quiet.

### 7. Error and Failure Handling

- What does the agent do when Ship API is down?

  **When the Ship API is down, FleetGraph stops taking actions and degrades to read-only status messaging.**
  Proactive runs should fail the current scope, record the error, retry with backoff, and avoid creating new findings from incomplete data. Existing findings remain visible with a stale-data indicator, but the agent should not escalate, notify, or mutate anything until it can revalidate against Ship. On-demand mode should tell the user which context could not be loaded and offer to retry instead of hallucinating from old state.

- How does it degrade gracefully?

  **FleetGraph degrades by reducing capability rather than pretending the full agent is working.**
  If the LLM or graph reasoning fails, deterministic rules can still surface simple conditions like stale blockers or missing standups. If detailed fetches fail, the agent can show existing findings as stale but should not create new ones. If notification delivery fails, it keeps the finding open and retries later instead of dropping the action. If tracing fails, the run should be marked incomplete and excluded from submission evidence. In the UI, degraded responses should be explicit: what worked, what failed, and what the user can retry.

- What gets cached and for how long?

  **FleetGraph caches short-lived context for performance and persists finding state for continuity.**
  Within a graph run, fetched Ship objects can be cached for the duration of the run. Across proactive runs, candidate watermarks, dedupe keys, open findings, snooze/dismiss state, notification history, and evidence snapshots persist until the finding is resolved or retired. Recently fetched project/issue/sprint summaries may be cached for a few minutes to avoid duplicate work, but must be invalidated by newer `updated_at` values or event watermarks. Permission and visibility decisions should be checked fresh per run or kept only in very short-lived request scope.

## Phase 3: Stack and Deployment

### 8. Deployment Model

- Where does the proactive agent run when no user is present?

  **The proactive agent runs server-side as a background worker, not in the browser.**
  For MVP, FleetGraph can run in the Ship API process or a companion worker process with access to the same database and internal service layer. That lets it scan project state without a user present, persist findings, and deliver in-app notifications. Long term, the worker can be split into a separate service or job runner if load or reliability requires it.

- How is it kept alive?

  **FleetGraph is kept alive by the deployment platform and guarded by a worker heartbeat/lease.**
  In MVP, the API or companion worker process starts the polling loop on boot and the host restarts it if the process exits. The worker should record heartbeat timestamps and acquire a database-backed lease before scanning so multiple instances do not duplicate alerts. If the lease expires, another instance can take over. Each run should log success/failure and expose basic health so deployment checks can prove the proactive path is alive.

- How does it authenticate with Ship without a user session?

  **FleetGraph authenticates as a scoped service principal, not as a fake user session.**
  The proactive worker should have a dedicated FleetGraph principal with only the capabilities required to read eligible project data, create/update FleetGraph findings, and deliver approved notifications. Any proposed mutation on behalf of a human must still require that human's confirmation and be attributed to both the approving user and FleetGraph. The service principal should be auditable, least-privileged, and denied from bypassing normal document visibility rules.

### 9. Performance

- How does your trigger model achieve the < 5 minute detection latency goal?

  **The trigger model meets the < 5 minute goal by running every 2 minutes and keeping each detection pass scoped.**
  A condition should become eligible through cheap database checks, enter the candidate queue on the next polling interval, and complete graph reasoning/notification within the remaining time budget. The worker should prioritize newly eligible high-severity candidates, avoid full-workspace scans, and cap per-run concurrency so one slow project does not block the rest. If a run falls behind, it should process the newest/highest-risk candidates first and report degraded latency.

- What is your token budget per invocation?

  **FleetGraph should spend tokens only after deterministic filters identify a candidate worth reasoning about.**
  Simple eligibility checks should use zero LLM tokens. A normal proactive finding should target roughly 2,000-4,000 input tokens and 500-1,000 output tokens by sending summarized issue/project/sprint context, not raw workspace data. A heavier program rollup can use roughly 6,000-10,000 input tokens and 1,000-2,000 output tokens. On-demand chat can vary by question, but should start with the current-view context and expand only when needed. Any invocation expected to exceed the budget should summarize first or ask the user to narrow scope.

- Where are the cost cliffs in your architecture?

  **The main cost cliffs are full-workspace scans, unnecessary LLM calls, and oversized context.**
  FleetGraph gets expensive if every 2-minute poll reasons over every project, if raw documents/activity logs are sent to the model, if unchanged findings are reprocessed repeatedly, or if program rollups include every child object instead of summaries. On-demand chat can also spike cost when a user asks broad questions like "what is wrong with everything?" Mitigations are candidate filtering, watermarks, dedupe keys, cooldowns, summarized context, per-run concurrency limits, per-user/project budgets, and explicit scope narrowing for broad requests.
