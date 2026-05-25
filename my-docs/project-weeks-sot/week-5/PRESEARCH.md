# Presearch Checklist Answers

## Phase 1: Define Your Agent

### 1. Agent Responsibility Scoping

- What events in Ship should the agent monitor proactively?
- What constitutes a condition worth surfacing?
- What is the agent allowed to do without human approval?
- What must always require confirmation?
- How does the agent know who is on a project?
- How does the agent know who to notify?
- How does the on-demand mode use context from the current view?

### 2. Use Case Discovery (minimum 5)

- Think about the roles: Director, PM, Engineer
- For each use case define: role, trigger, what the agent detects or produces, what the
     human decides
- Do not invent use cases - discover pain points first

### 3. Trigger Model Decision

- When does the proactive agent run without a user present?
- Poll vs. webhook vs. hybrid - what are the tradeoffs?
- How stale is too stale for your use cases?
- What does your choice cost at 100 projects? At 1,000?

## Phase 2: Graph Architecture

### 4. Node Design

- What are your context, fetch, reasoning, action, and output nodes?
- Which fetch nodes run in parallel?
- Where are your conditional edges and what triggers each branch?

### 5. State Management

- What state does the graph carry across a session?
- What state persists between proactive runs?
- How do you avoid redundant API calls?

### 6. Human-in-the-Loop Design

- Which actions require confirmation?
- What does the confirmation experience look like in Ship?
- What happens if the human dismisses or snoozes?

### 7. Error and Failure Handling

- What does the agent do when Ship API is down?
- How does it degrade gracefully?
- What gets cached and for how long?

## Phase 3: Stack and Deployment

### 8. Deployment Model

- Where does the proactive agent run when no user is present?
- How is it kept alive?
- How does it authenticate with Ship without a user session?

### 9. Performance

- How does your trigger model achieve the < 5 minute detection latency goal?
- What is your token budget per invocation?
- Where are the cost cliffs in your architecture?
