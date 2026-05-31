# AI Cost Analysis

## Reviewer Summary

This is the Week 5 FleetGraph cost report. It separates development AI usage from FleetGraph runtime usage because they answer different questions:

- Development usage shows how much coding-agent work went into understanding, auditing, and building the submission.
- FleetGraph runtime usage shows what the agent itself costs when it runs.
- Production projections estimate monthly FleetGraph model spend at reviewer-requested scale points.

| Metric | Value |
| --- | ---: |
| Codex local project threads | 787 |
| Codex local project tokens | 3,674,047,029 |
| Codex measurement window | 2026-05-18 14:51:52 to 2026-05-30 19:07:28 America/Chicago |
| Codex high-water mark | `1780186048932` |
| Latest FleetGraph proof packet | 2026-05-31T00:07:11.336Z |
| Latest reviewer chain latency | 5,354 ms |
| Latest reviewer proof model calls | 0 |
| Latest reviewer proof runtime model spend | $0.00 |
| Local FleetGraph run ledger | 1,701 runs; 12 model calls; 2,655 model tokens; $0.020901 estimated model spend |

Exact OpenAI, Claude, or Codex billable invoice data is not available from local project records. The Codex token totals below are local usage evidence, not a provider bill. The latest reviewer proof packet is deterministic and shows zero model calls, but the broader local FleetGraph run ledger includes real model calls and nonzero estimated model spend.

## Assignment Criteria

Week 5 asks for:

- Claude/API costs with input and output token breakdown where available.
- Number of graph-agent invocations during development.
- Total development spend.
- Production monthly cost projections at 100, 1,000, and 10,000 users.
- Assumptions: proactive runs per project per day, on-demand invocations per user per day, and average tokens per invocation.

This report uses the best available local evidence. When exact billing fields are unavailable, it says so instead of inventing numbers.

## Development And Testing Costs

Development was performed mostly through Codex Desktop/local coding-agent sessions, with additional Cursor session history visible locally. Codex local records include model labels and aggregate local token accounting. Cursor transcripts are useful qualitative evidence of related work, but the local Cursor records inspected here do not expose reliable billable token or cost fields.

| Cost basis | Value |
| --- | --- |
| Cash spend basis | $100/month Codex subscription |
| Subscription allocation | Up to $100 if the full monthly subscription is allocated to ShipShape; otherwise prorate outside this report |
| Exact token-metered bill | Not available from local Codex records |
| Claude/API billable split | Not available from local records |
| Local Codex evidence source | `/Users/michaelhabermas/.codex/state_5.sqlite`, `threads` table |
| Cursor evidence treatment | Qualitative session-history evidence only |

### Codex Local Usage

| Metric | Value |
| --- | ---: |
| Threads | 787 |
| Tokens | 3,674,047,029 |
| First recorded thread | 2026-05-18 14:51:52 America/Chicago |
| Last recorded update | 2026-05-30 19:07:28 America/Chicago |
| Next high-water mark | `1780186048932` |

### Codex Usage By Model

| Model | Reasoning effort | Threads | Tokens |
| --- | --- | ---: | ---: |
| `gpt-5.5` | low | 487 | 3,134,549,503 |
| `gpt-5.5` | medium | 118 | 202,899,698 |
| `codex-auto-review` | low | 115 | 178,703,854 |
| `gpt-5.5` | high | 64 | 153,394,436 |
| `gpt-5.5` | xhigh | 1 | 4,499,538 |
| unknown | unknown | 2 | 0 |

### Codex Usage By Day

| Local day | Threads | Tokens | Avg tokens/thread | Largest thread |
| --- | ---: | ---: | ---: | ---: |
| 2026-05-18 | 3 | 87,774,273 | 29,258,091 | 79,977,259 |
| 2026-05-19 | 13 | 121,710,812 | 9,362,370 | 47,210,903 |
| 2026-05-20 | 110 | 280,127,893 | 2,546,617 | 34,717,810 |
| 2026-05-21 | 108 | 422,017,196 | 3,907,567 | 56,228,429 |
| 2026-05-22 | 108 | 513,263,594 | 4,752,441 | 65,017,167 |
| 2026-05-23 | 19 | 135,862,413 | 7,150,653 | 74,886,277 |
| 2026-05-24 | 91 | 298,121,577 | 3,276,061 | 114,089,897 |
| 2026-05-25 | 64 | 130,832,441 | 2,044,257 | 42,453,782 |
| 2026-05-26 | 111 | 674,321,047 | 6,074,964 | 63,462,258 |
| 2026-05-27 | 19 | 159,891,043 | 8,415,318 | 29,469,982 |
| 2026-05-28 | 67 | 405,583,625 | 6,053,487 | 109,914,248 |
| 2026-05-29 | 45 | 389,868,900 | 8,663,753 | 151,671,960 |
| 2026-05-30 | 29 | 54,672,215 | 1,885,249 | 22,800,339 |

### What Drove Development Usage

The high token count came from evidence-heavy work: reading the Week 5 source of truth, mapping existing ShipShape architecture, building reviewer proof surfaces, running code reviews, tracing FleetGraph execution, and repeatedly scanning changed files. Subagent and auto-review threads increased coverage but also multiplied context.

The cash-cost conclusion is narrower than the token total: local Codex records show scale of AI use, not marginal invoice cost. The defensible project spend statement is that the work was covered by a $100/month Codex subscription unless the user allocates only a prorated share to ShipShape.

## FleetGraph Runtime Costs

FleetGraph runtime cost is the cost of the agent running inside Ship, not the cost of the coding assistant used to build it.

Current runtime evidence comes from:

- `FLEETGRAPH.md` cost section.
- `shared/src/types/fleetgraph.ts` usage/cost fields.
- `my-docs/evidence/fleetgraph-proof/latest.json`.
- FleetGraph proof-run JSON files under `my-docs/evidence/fleetgraph-proof/runs/`.
- Local Postgres `fleetgraph_runs` rows in `ship_dev`.

### Local Run Ledger

The latest proof packet alone is not enough for cost analysis because it can be generated from deterministic reviewer proof paths. The full local `fleetgraph_runs` ledger captures the development and testing runs that did use a model.

| Metric | Value |
| --- | ---: |
| Local run window | 2026-05-26 20:44:43 UTC to 2026-05-31 00:19:50 UTC |
| Total FleetGraph runs | 1,701 |
| Deterministic runs | 1,689 |
| Real-model runs | 12 |
| Model calls | 12 |
| Input tokens | 1,074 |
| Output tokens | 1,581 |
| Total model tokens | 2,655 |
| Estimated model spend | $0.020901 |
| Blended cost per FleetGraph run | $0.0000123 |
| Average cost per real-model run | $0.002090 |
| Average tokens per real-model run | 221.25 |

| Model | Runs | Model calls | Input tokens | Output tokens | Total tokens | Estimated spend |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `gpt-4.1-mini` | 6 | 6 | 540 | 634 | 1,174 | $0.000461 |
| `gpt-5.5` | 6 | 6 | 534 | 947 | 1,481 | $0.020440 |
| deterministic / none | 1,689 | 0 | 0 | 0 | 0 | $0.000000 |

| Local day | Runs | Model calls | Total tokens | Estimated spend |
| --- | ---: | ---: | ---: | ---: |
| 2026-05-26 | 108 | 0 | 0 | $0.000000 |
| 2026-05-27 | 56 | 0 | 0 | $0.000000 |
| 2026-05-28 | 77 | 6 | 1,174 | $0.000461 |
| 2026-05-29 | 776 | 6 | 1,481 | $0.020440 |
| 2026-05-30 | 684 | 0 | 0 | $0.000000 |

### Latest Proof Packet

| Metric | Value |
| --- | ---: |
| Generated at | 2026-05-31T00:07:11.336Z |
| Required scenarios | 9 |
| Proven scenarios | 9 |
| Current surface pass/fail | 8 / 0 |
| Deployed configured | false |
| Proof summary graph invocations | 0 |
| Proof summary model calls | 0 |
| Proof summary real-model runs | 0 |

### Latest Reviewer Chain

| Step | Latency |
| --- | ---: |
| Ship source to attention event | 7 ms |
| Attention event to worker tick | 2 ms |
| Worker tick to graph run | 5,347 ms |
| Graph run to finding | 0 ms |
| Finding to notification projection | 0 ms |
| Total | 5,354 ms |

| Usage field | Value |
| --- | --- |
| Model calls | 0 |
| Input tokens | Not present because no model call ran |
| Output tokens | Not present because no model call ran |
| Estimated cost | $0.00 |
| Currency | USD |
| Usage source | `none` |
| Cost source | `none` |

The trace-quality proof passed and required the `create_finding` decision path. This proves graph execution and reviewer-safe usage metadata, but the latest packet does not prove a real-model call. The full run ledger above is the better source for development/testing model spend.

### Runtime Cost Controls

FleetGraph avoids model spend by design:

- SQL and deterministic candidate policy select candidates before any model boundary.
- No-candidate worker ticks spend zero model tokens.
- Open findings use dedupe/update/quiet paths instead of repeated model-backed creation.
- Context chat is scoped to the current page or finding, not the full workspace.
- Real-model blocked-create behavior is gated behind `FLEETGRAPH_REAL_MODEL_ENABLED=true`, `FLEETGRAPH_MODEL`, and `OPENAI_API_KEY`.

Configured estimate rates from `FLEETGRAPH.md`:

| Token class | Rate |
| --- | ---: |
| Input | $0.15 / 1M tokens |
| Output | $0.60 / 1M tokens |

## Production Cost Projections

Projection assumption from `FLEETGRAPH.md`: 30 graph invocations per user per month.

For projection purposes, this report interprets that as:

| Assumption | Value |
| --- | ---: |
| Average projects per active user | 1 |
| Proactive graph invocations | 0.8 per project per day |
| On-demand graph invocations | 0.2 per user per day |
| Total normalized invocations | 30 per user per 30-day month |
| Average measured tokens per real-model invocation | 89.5 input / 131.75 output |
| Average measured model cost per real-model invocation | $0.002090 |
| Blended measured model cost per FleetGraph run | $0.0000123 |

The latest reviewer proof packet has zero real-model runs, but the local development/testing ledger does not. The primary projection below uses the blended measured model cost across all 1,701 local FleetGraph runs. This is still model-spend only; it excludes hosting, database, observability, storage, staff time, and the Codex development subscription.

| Scale | Assumed graph invocations/month | Blended measured model cost/invocation | Projected monthly model spend |
| --- | ---: | ---: | ---: |
| 100 users | 3,000 | $0.0000123 | $0.04 |
| 1,000 users | 30,000 | $0.0000123 | $0.37 |
| 10,000 users | 300,000 | $0.0000123 | $3.69 |

Worst-case sensitivity if every graph invocation crossed the same model boundary as the 12 measured real-model runs:

| Scale | Assumed graph invocations/month | Real-model cost/invocation | Projected monthly model spend |
| --- | ---: | ---: | ---: |
| 100 users | 3,000 | $0.002090 | $6.27 |
| 1,000 users | 30,000 | $0.002090 | $62.70 |
| 10,000 users | 300,000 | $0.002090 | $627.04 |

If real-model mode is enabled later, use this formula:

```text
monthly model cost =
  users
  * 30 graph invocations per user per month
  * ((average input tokens / 1,000,000) * 0.15
     + (average output tokens / 1,000,000) * 0.60)
```

The blended projection is lower because most FleetGraph paths are deterministic. The worst-case sensitivity is the more conservative budget number if production policy changed so every invocation used a model.

## Evidence And Methodology

### Codex Usage Query

```bash
sqlite3 -header -csv /Users/michaelhabermas/.codex/state_5.sqlite \
  "select count(*) as threads,
          sum(tokens_used) as tokens,
          min(datetime(created_at_ms/1000,'unixepoch','localtime')) as first_local,
          max(datetime(updated_at_ms/1000,'unixepoch','localtime')) as last_local,
          max(updated_at_ms) as high_water
   from threads
   where cwd='/Users/michaelhabermas/repos/GAI/ship-shape';"
```

```bash
sqlite3 -header -csv /Users/michaelhabermas/.codex/state_5.sqlite \
  "select coalesce(model,'unknown') as model,
          coalesce(reasoning_effort,'unknown') as effort,
          count(*) as threads,
          sum(tokens_used) as tokens
   from threads
   where cwd='/Users/michaelhabermas/repos/GAI/ship-shape'
   group by model, reasoning_effort
   order by tokens desc;"
```

```bash
sqlite3 -header -csv /Users/michaelhabermas/.codex/state_5.sqlite \
  "select date(created_at_ms/1000,'unixepoch','localtime') as local_day,
          count(*) as threads,
          sum(tokens_used) as tokens,
          round(avg(tokens_used),0) as avg_tokens,
          max(tokens_used) as max_tokens
   from threads
   where cwd='/Users/michaelhabermas/repos/GAI/ship-shape'
   group by local_day
   order by local_day;"
```

### FleetGraph Proof Query

```bash
jq '.generatedAt,
    .summary,
    .reviewerChain.latencyMs,
    .reviewerChain.usageSummary,
    .reviewerChain.traceQuality' \
  /Users/michaelhabermas/repos/GAI/ship-shape/my-docs/evidence/fleetgraph-proof/latest.json
```

### FleetGraph Run Ledger Query

```bash
psql 'postgresql://ship:ship_dev_password@localhost:5433/ship_dev' -P pager=off \
  -c "select count(*) as runs,
             min(created_at) as first_run,
             max(created_at) as last_run,
             sum(coalesce((token_metadata->>'modelCalls')::int,0)) as model_calls,
             sum(coalesce((token_metadata->>'inputTokens')::int,0)) as input_tokens,
             sum(coalesce((token_metadata->>'outputTokens')::int,0)) as output_tokens,
             sum(coalesce((token_metadata->>'totalTokens')::int,0)) as total_tokens,
             sum(coalesce((cost_metadata->>'estimatedCostUsd')::numeric,
                          coalesce((cost_metadata->>'modelCostUsd')::numeric,0))) as estimated_cost_usd
      from fleetgraph_runs;"
```

```bash
psql 'postgresql://ship:ship_dev_password@localhost:5433/ship_dev' -P pager=off \
  -c "select coalesce(token_metadata->>'model','none') as model,
             count(*) as runs,
             sum(coalesce((token_metadata->>'modelCalls')::int,0)) as model_calls,
             sum(coalesce((token_metadata->>'inputTokens')::int,0)) as input_tokens,
             sum(coalesce((token_metadata->>'outputTokens')::int,0)) as output_tokens,
             sum(coalesce((token_metadata->>'totalTokens')::int,0)) as total_tokens,
             sum(coalesce((cost_metadata->>'estimatedCostUsd')::numeric,
                          coalesce((cost_metadata->>'modelCostUsd')::numeric,0))) as estimated_cost_usd
      from fleetgraph_runs
      group by coalesce(token_metadata->>'model','none')
      order by model_calls desc, runs desc;"
```

### Cost Field Search

```bash
rg -n "FLEETGRAPH_MODEL|FLEETGRAPH_REAL_MODEL|modelCalls|estimatedCostUsd|inputTokens|outputTokens|usageSource|costSource|0\\.15|0\\.60|30 graph invocations" \
  /Users/michaelhabermas/repos/GAI/ship-shape/FLEETGRAPH.md \
  /Users/michaelhabermas/repos/GAI/ship-shape/shared/src/types/fleetgraph.ts \
  /Users/michaelhabermas/repos/GAI/ship-shape/api/src/fleetgraph \
  /Users/michaelhabermas/repos/GAI/ship-shape/scripts/fleetgraph-proof
```

### Session History Discovery

Session history was inspected with the `ce-sessions` discovery scripts, using keyword filtering for FleetGraph, cost, tokens, traces, and model usage. Raw transcript contents were not copied into this report. The useful conclusion is qualitative: Cursor and prior agent transcripts show related FleetGraph work, but the reliable numeric token totals came from Codex local SQLite records.

## Reflection On AI Tool Effectiveness

AI was most useful as a codebase-comprehension and reviewer-evidence accelerator. The valuable work was not generic code generation; it was fast orientation across ShipShape, repeated audit passes, proof-surface construction, trace instrumentation, cost metadata verification, and compression of many repository facts into reviewer-readable evidence.

The main development cost driver was broad repeated context. Large source-of-truth documents, generated OpenAPI files, proof packets, diffs, test output, and subagent fan-out all increase local token usage. That was useful for coverage, but expensive. Future work should start from the high-water mark above and narrow each AI session to one deliverable or one proof gap.

The main runtime cost control is simpler: do not ask a model to discover what SQL and deterministic policy can already detect. FleetGraph's current cost posture is deterministic-first, then optionally model-backed only at explicit boundaries. That is the right shape for this assignment because the reviewer needs proof that the graph works, not a large model bill.
