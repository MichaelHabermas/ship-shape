# Ship + Claude Code Integration Guide

This guide documents how to use Ship as a real-time observability dashboard for Claude Code workflows, enabling knowledge compounding across development weeks.

## Getting Started

### What is Ship?

Ship is a project management platform designed for AI-assisted development. It provides:

- **Week Planning**: Organize work into time-boxed weeks with hypotheses and user stories
- **Issue Tracking**: Track issues through todo → in_progress → done states
- **Real-time Sync**: See Claude's work progress in real-time as stories complete
- **Knowledge Compounding**: Learnings from past weeks inform future planning

### What is Claude Code?

Claude Code is Anthropic's official CLI for Claude, providing AI-assisted software engineering directly in your terminal. Key workflows include:

- `/prd` (alias `/workflows:plan`): Generate product requirement documents with user stories
- `/work` (alias `/workflows:work`): Execute PRDs with automatic verification loops
- `/standup` (alias `/workflows:standup`): Daily progress summaries with Ship integration
- `/review` (alias `/workflows:review`): Deep PR analysis
- Deploy verification: use repo-local deployment commands from `DEPLOYMENT.md`

### Why Integrate Them?

When Ship and Claude Code are integrated:

1. **Visibility**: Watch Claude work in real-time through Ship's dashboard
2. **Traceability**: Every story, iteration, and verification failure is logged
3. **Knowledge**: Learnings from completed weeks inform future planning
4. **Telemetry**: Track iterations, confidence levels, and time per story

## Setup and Authentication

### Step 1: Sign Up for Ship

1. Navigate to your organization's Ship instance
2. Create an account or sign in with your existing credentials
3. Join or create a workspace for your project

### Step 2: Generate an API Token

1. Go to **Workspace Settings** (gear icon in sidebar)
2. Click the **API Tokens** tab
3. Click **Generate Token**
4. Enter a name (e.g., "Claude Code")
5. Select expiration (90 days recommended)
6. **Copy the token immediately** - it's only shown once

The token format is `ship_<64 hex characters>`.

### Step 3: Configure Claude Code

Add your Ship API token to `~/.claude/.env`:

```bash
# Ship API Configuration
SHIP_API_TOKEN=ship_your_token_here
SHIP_URL=https://your-ship-instance.example.com
SHIP_PROGRAM_ID=your-program-uuid  # Optional: default program for weeks
```

### Step 4: Verify Connection

Run any Ship-integrated workflow. You should see:
- "Ship: Connected" in workflow output
- Your activity appearing in Ship's dashboard

## Planning Phase: /prd

The `/prd` command (alias `/workflows:plan`) creates structured product requirements and syncs them to Ship.

### Usage

```
/prd [feature description]
```

### What Happens in Ship

When you run `/prd`:

1. **Week Created**: A new week is created under your program with:
   - Title matching the feature name
   - Hypothesis describing expected outcome
   - Confidence level (default 70%)

2. **Issues Created**: Each user story becomes a Ship issue:
   - Linked to the week
   - State set to "todo"
   - Verification criteria in description
   - Priority mapped (high/medium/low)

3. **PRD File Saved**: Local `plans/{name}.prd.json` stores the mapping between story IDs and Ship issue IDs

### Observable Outcomes in Ship UI

After `/prd` completes:
- New week visible in Week view
- Issues appear in backlog
- Week timeline shows start date
- Issue count reflects story count

## Execution Phase: /work

The `/work` command (alias `/workflows:work`) executes PRDs while syncing progress to Ship in real-time.

### Usage

```
/work [path/to/prd.json]
```

If no path provided, uses most recent PRD in `plans/` directory.

### Issue State Transitions

As Claude works through stories:

| Claude Action | Ship Issue State | Ship Updates |
|--------------|------------------|--------------|
| Story picked | `in_progress` | `started_at` timestamp, `claude_metadata.updated_by='claude'` |
| Verification fails | `in_progress` | History entry logged with failure details |
| Story passes | `done` | `completed_at` timestamp, telemetry stored |

### Telemetry Tracking

Each completed story records:

- **iterations**: Number of fix attempts
- **feedback_loops**: Count of type-check, test, build runs
- **time_elapsed_seconds**: Duration of story work
- **files_changed**: List of modified files
- **confidence**: Final confidence score (starts at PRD level, -10 per failure, +10 on success)

### Observable Outcomes in Ship UI

While `/work` runs:
- Issue cards move across Kanban columns
- Week progress percentage updates
- Issue history shows verification attempts
- Telemetry appears in issue properties

## Review Phase: /standup and /review

### /standup

The `/standup` command generates daily progress summaries with Ship data.

```
/standup
```

What it pulls from Ship:
- Completed issues since last standup
- In-progress issues
- Week velocity metrics
- Blockers and risks

### /review (PR Review)

The `/review` command performs deep PR analysis:

```
/review [PR number or URL]
```

When integrated with Ship:
- Links PR to related issues
- Updates issue status based on PR state
- Records review findings

### Weekly Retrospective

At week end, Ship captures:
- **Outcome**: What was achieved
- **Learnings**: Key insights documented as wiki docs
- **Metrics**: Velocity, completion rate, average iterations

## Deployment Phase: /deploy

The `/deploy` command handles deployment with verification.

```
/deploy
```

Ship Integration:
- Deployment status visible in week view
- Links deployment to completed week
- Rollback history tracked

### Rollback Considerations

If deployment fails:
1. Ship marks deployment as failed
2. Previous deployment remains active
3. Issues don't revert state (separate manual process)

## Offline Handling

When Ship is unavailable:

1. **Operations Queue**: All Ship API calls are queued to `~/.claude/ship-queue.json`
2. **Local Progress**: Work continues normally with local PRD updates
3. **Auto-Retry**: Next `/work` invocation replays queued operations
4. **Graceful Degradation**: Workflows complete successfully even without Ship

Queue operations include:
- Issue state updates
- Verification failure logs
- Telemetry data
- Week updates

When connection restores, you'll see:
```
Ship: Replaying 3 queued operations...
Ship: 3 synced, 0 failed
```

## Best Practices

### 1. Always Start with /prd

Let Claude generate the PRD first - this creates Ship issues automatically and establishes the feedback loop.

### 2. Monitor Ship Dashboard

Keep Ship open in a browser tab while `/work` runs. You'll see real-time progress.

### 3. Review Telemetry

After weeks, review telemetry to understand:
- Which stories took most iterations
- Common verification failures
- Time distribution across stories

### 4. Extract Learnings

Use `/document` to capture learnings. They're searchable in future `/prd` runs.

### 5. Trust the Process

The integration is designed to be invisible when working well. If you don't see updates in Ship, check:
- Token validity (`~/.claude/.env`)
- Network connectivity
- Queue file for pending operations

## MCP Server Integration

Ship includes an MCP (Model Context Protocol) server that **auto-generates tools from the OpenAPI specification**. The server fetches the spec from any running Ship instance, so tools automatically stay in sync as the API evolves.

### Configuration

1. Add your Ship credentials to `~/.claude/.env`:

```bash
SHIP_API_TOKEN=ship_your_token_here
SHIP_URL=https://ship.example.com
```

2. Add Ship's MCP server to your `~/.claude.json`:

```json
{
  "mcpServers": {
    "ship": {
      "command": "npx",
      "args": ["tsx", "/path/to/ship/api/src/mcp/server.ts"]
    }
  }
}
```

The server reads `SHIP_API_TOKEN` and `SHIP_URL` from `~/.claude/.env` at startup, avoiding hardcoded credentials in your JSON config.

### How It Works

At startup, the MCP server:

1. **Fetches** the OpenAPI spec from `{SHIP_URL}/api/openapi.json`
2. **Generates** MCP tools from each HTTP operation (tool name = `ship_` + method + path)
3. **Builds** input schemas from path parameters, query parameters, and request bodies
4. **Executes** tool calls by making authenticated HTTP requests to the Ship API

### Available Tools

Tools are generated for all documented API endpoints (~92 tools). Tool categories include:
- **Authentication**: Login, logout, session management
- **Issues**: CRUD, state transitions, history, iterations
- **Weeks**: Planning, reviews, retros
- **Projects & Programs**: Organization hierarchy
- **Documents**: Wiki pages, search, backlinks
- **Standups**: Daily updates and status
- **Activity**: Change tracking and audit logs
- **Accountability**: Action items and weekly planning

### Benefits

1. **Zero Drift**: Tools generated from live OpenAPI spec
2. **Works with any Ship instance**: Point `SHIP_URL` at local dev or production
3. **Full Coverage**: Every documented endpoint becomes a tool
4. **Type Safety**: Input schemas validate arguments before API calls
5. **No Maintenance**: Add an endpoint to the API, MCP tool appears automatically
