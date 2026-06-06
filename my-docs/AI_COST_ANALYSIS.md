# AI Cost Analysis

This report separates four cost lanes that are easy to conflate:

- Development AI usage: local coding-agent sessions used to build, audit, test, and document Ship.
- FleetGraph runtime usage: model calls made by the Ship agent itself.
- PlugForge platform usage: OAuth, public API, SDK, CLI, webhooks, portal, and integrations. These are not LLM paths.
- Production projections: monthly model spend estimates at reviewer-requested scale points.

The important conclusion is not "AI was free." It is narrower: the FleetGraph product runtime has spent about six cents of estimated model cost in local evidence, while development used a very large amount of coding-agent context under subscription-style tooling whose exact token-billed invoice is not available locally.

## Reviewer Summary

| Metric | Current value |
| --- | ---: |
| Report refresh date | 2026-06-06 |
| Codex local project threads | 920 |
| Codex local project tokens | 4,765,728,721 |
| Codex measurement window | 2026-05-18 14:51:52 to 2026-06-06 15:11:14 America/Chicago |
| Codex high-water mark | `1780776674825` |
| New Codex threads since prior report timestamp | 114 |
| New Codex-thread tokens since prior report timestamp | 904,606,570 |
| Net Codex token increase vs prior report total | 907,679,649 |
| Local FleetGraph run ledger | 12,885 runs |
| FleetGraph deterministic runs | 12,870 |
| FleetGraph model calls | 15 |
| FleetGraph model tokens | 2,518 input; 2,346 output; 4,864 total |
| FleetGraph persisted estimated model spend | $0.0510714 |
| FleetGraph corrected estimated model spend | $0.0617114 |
| Owner-confirmed development/platform cash committed | $537 |
| Latest published FleetGraph proof packet | 2026-06-01T16:03:40.433Z; `target: local`; 0 model calls |
| Latest deployed/both proof refresh attempt | 2026-06-06T20:38:35.664Z; verdict `fail`; not deployed |
| Latest published reviewer chain latency | 865 ms |
| Week 6 PlugForge platform model calls | 0 by design boundary |
| Week 6 PlugForge metrics aggregate | 219,286 ms local command runtime |
| Week 6 strict submission gate | Passed per `my-docs/evidence/plugforge-manual-live.md` |

Exact OpenAI, Claude, Cursor, or Codex billable invoice data is not available from local project records. The Codex token totals are local usage evidence, not provider billing. Do not multiply the 4.765B local Codex tokens by API pricing and call that spend.

The FleetGraph runtime cost is measurable because FleetGraph writes token and cost metadata to `fleetgraph_runs`. That ledger is still a floor: the 15 model calls were tiny demo/reviewer/chat payloads, not rich production workspaces.

## What Changed Since The Prior Cost Report

The prior report froze most numbers at 2026-05-31 and treated Week 6 as a short addendum. That is stale now.

Since then, the repo added and proved:

- FleetGraph PM chat as model-primary conversation when `OPENAI_API_KEY` and `FLEETGRAPH_MODEL` are configured.
- User-initiated FleetGraph source reads through `@ship/sdk` and `/api/v1` when `FLEETGRAPH_USE_PUBLIC_API=true`.
- PlugForge OAuth app registration, shown-once hashed secrets, Authorization Code + PKCE, Device Grant, refresh-token rotation, and refresh-token theft invalidation.
- Public `/api/v1` documents, issues, sprints, webhooks, FleetGraph attention contexts, public audit rows, generated OpenAPI 3.1, and SDK/OpenAPI parity.
- `@ship/sdk`, `@ship/cli`, packed TTFE drill, browser SDK demo, Developer portal, webhook delivery/retry/DLQ/replay, and public delivery/audit evidence.
- Slack, GitLab, browser SDK, CLI TTFE, refresh-token theft, and idempotency replay integration matrix proof.
- PlugForge reviewer packet generation, live proof evidence copying, and final `pnpm plugforge:submission` closure.

Cost implication: Week 6 added a lot of engineering and proof-surface work, but it did not add a new product LLM lane. The only model-spend lanes remain FleetGraph proactive create and FleetGraph context chat.

## Assignment Criteria

Week 5 asks for:

- Claude/API costs with input and output token breakdown where available.
- Number of graph-agent invocations during development.
- Total development spend.
- Production monthly cost projections at 100, 1,000, and 10,000 users.
- Assumptions: proactive runs per project per day, on-demand invocations per user per day, and average tokens per invocation.

This report uses local evidence where the repo records it. When exact billing fields are unavailable, it says so instead of inventing numbers.

## Workstream Cost Map

| Workstream | What shipped | Model-spend lane |
| --- | --- | --- |
| Week 4 quality/security/type-safety work | Type-safety cleanup, authorization hardening, evidence ledger, route/test tightening | Development AI only; no product model path |
| Week 5 FleetGraph | SQL-first detection, worker, graph runtime, findings/runs, proof packets, reviewer control room, traces, notifications, human gate | Product runtime model path exists, but most runs are deterministic |
| Week 5/6 FleetGraph PM chat | Page/finding/document context chat, authorized source loading, bounded context, LLM conversation when configured | Product runtime model path; measured in `fleetgraph_runs` |
| Week 6 PlugForge OAuth/API | OAuth apps, PKCE, Device Grant, refresh tokens, `/api/v1`, OpenAPI, public audit rows | Zero platform model calls |
| Week 6 webhooks/portal | Event registry, HMAC signatures, retry, DLQ, replay, Developer portal ops | Zero model calls; DB rows and outbound HTTP |
| Week 6 SDK/CLI/TTFE | `@ship/sdk`, `@ship/cli`, packed install, Device Grant login, signed webhook tail | Zero model calls; local/CI compute |
| Week 6 integrations | Slack, GitLab, browser SDK, six-flow matrix, always-on integration runbook | Zero model calls; external APIs, webhooks, hosting |
| Week 6 reviewer proof | Generated packet, live evidence JSON, strict final gate | Zero model calls; docs/build/CI work |

## Development And Testing Costs

Development was performed mostly through Codex Desktop/local coding-agent sessions, with additional non-Codex tooling and manual browser/provider work. Codex local records include model labels and aggregate local token accounting. They do not expose reliable input/output token splits or invoice prices. Cursor/Claude-style transcripts are qualitative evidence only unless an export with usage/cost fields is provided.

| Cost basis | Value |
| --- | --- |
| Codex subscriptions | 2 x $200/month = $400 |
| Cursor subscriptions | 2 x $60/month = $120 |
| Render hosting tier currently paid | $7/month |
| OpenAI API credits purchased | $10 prepaid; not necessarily consumed |
| Slack/GitLab Render integration services | $0 currently; free instances/services |
| Total owner-confirmed committed cash basis | $537 |
| Exact token-metered development invoice | Not available from local Codex records |
| Claude/API development input/output split | Not available from local records |
| Local Codex evidence source | `/Users/michaelhabermas/.codex/state_5.sqlite`, `threads` table |
| Cursor/other assistant evidence treatment | Qualitative unless owner supplies usage export |

The $537 figure is the owner-confirmed cash basis so far: two Codex subscriptions, two Cursor subscriptions, one paid Render tier, and prepaid OpenAI API credit. Slack and GitLab integration Render services are currently free. This still excludes any unreported Claude/ChatGPT subscriptions, future paid Render services, paid Slack/GitLab costs, and OpenAI dashboard usage outside the local FleetGraph ledger.

### Codex Local Usage

| Metric | Value |
| --- | ---: |
| Threads | 920 |
| Tokens | 4,765,728,721 |
| First recorded thread | 2026-05-18 14:51:52 America/Chicago |
| Last recorded update | 2026-06-06 15:11:14 America/Chicago |
| Next high-water mark | `1780776674825` |

### Codex Usage By Model

| Model | Reasoning effort | Threads | Tokens |
| --- | --- | ---: | ---: |
| `gpt-5.5` | low | 513 | 3,337,088,087 |
| `gpt-5.5` | xhigh | 97 | 829,935,694 |
| `gpt-5.5` | medium | 120 | 242,877,273 |
| `codex-auto-review` | low | 115 | 178,703,854 |
| `gpt-5.5` | high | 69 | 166,700,238 |
| `gpt-5.4` | medium | 2 | 9,695,860 |
| `gpt-5.4-mini` | medium | 1 | 727,715 |
| unknown | unknown | 3 | 0 |

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
| 2026-05-30 | 37 | 188,930,049 | 5,106,218 | 47,194,196 |
| 2026-05-31 | 16 | 86,353,419 | 5,397,089 | 18,069,692 |
| 2026-06-01 | 12 | 110,079,652 | 9,173,304 | 25,927,579 |
| 2026-06-02 | 45 | 338,324,639 | 7,518,325 | 47,898,111 |
| 2026-06-03 | 20 | 199,979,677 | 9,998,984 | 50,349,638 |
| 2026-06-04 | 11 | 123,018,767 | 11,183,524 | 88,728,865 |
| 2026-06-05 | 15 | 68,636,355 | 4,575,757 | 50,683,945 |
| 2026-06-06 | 6 | 31,031,349 | 5,171,892 | 11,271,564 |

### New Codex Usage Since Prior Report Timestamp

The prior report measured through 2026-05-31 09:31:03 America/Chicago. New threads created after that timestamp:

| Local day | Threads | Tokens |
| --- | ---: | ---: |
| 2026-05-31 | 5 | 33,536,131 |
| 2026-06-01 | 12 | 110,079,652 |
| 2026-06-02 | 45 | 338,324,639 |
| 2026-06-03 | 20 | 199,979,677 |
| 2026-06-04 | 11 | 123,018,767 |
| 2026-06-05 | 15 | 68,636,355 |
| 2026-06-06 | 6 | 31,031,349 |
| Total | 114 | 904,606,570 |

### What Drove Development Usage

The high local token count came from evidence-heavy work, not just code generation:

- Reading source-of-truth Week 4, Week 5, and Week 6 materials.
- Auditing existing Ship architecture, authorization, document model, routes, and tests.
- Building FleetGraph graph boundaries, ledgers, proof packets, reviewer surfaces, traces, and cost metadata.
- Building PlugForge's OAuth/public API/webhook/SDK/CLI/portal/integration surface.
- Running repeated code reviews, type/lint cleanup, OpenAPI drift checks, proof ledger checks, and browser/integration drills.
- Compressing many artifact and proof files into reviewer-readable docs.

The 10x lesson is that proof work gets expensive when every pass reloads the world. Future AI work should anchor to one proof gap, one executable gate, and one source-of-truth file at a time.

## FleetGraph Runtime Costs

FleetGraph runtime cost is the cost of the agent running inside Ship, not the cost of the coding assistant used to build it.

Current runtime evidence comes from:

- `fleetgraph_runs.token_metadata` and `fleetgraph_runs.cost_metadata` in local `ship_dev`.
- `web/public/fleetgraph-observability/proof/latest.json`.
- `my-docs/evidence/fleetgraph-proof/latest.json`.
- FleetGraph model/cost code in `api/src/fleetgraph/model.ts`, `api/src/fleetgraph/usage-metadata.ts`, and `api/src/config/fleetgraph-models.ts`.
- Week 6 decisions around `FLEETGRAPH_USE_PUBLIC_API=true` and PM context chat.

### Model Boundary

FleetGraph model spend is restricted to two paths:

- Proactive blocked-create copy can call a model only when `FLEETGRAPH_REAL_MODEL_ENABLED=true`, `FLEETGRAPH_MODEL` is configured, and `OPENAI_API_KEY` exists.
- PM context chat calls a model when `OPENAI_API_KEY` and `FLEETGRAPH_MODEL` are set. Without them, the API returns an honest unavailable response.

These paths stay deterministic or zero-token unless separately re-decided:

- SQL candidate detection.
- No-candidate scheduled worker ticks.
- Attention-event enqueue and claim.
- Dedupe/update/resolve/suppress finding paths.
- Explain/refine/dismiss structure, except where context chat is invoked.
- PlugForge OAuth, API, SDK, CLI, portal, webhook, Slack, and GitLab flows.

### Local Run Ledger

The local run ledger is the best current source for measured FleetGraph runtime spend.

| Metric | Value |
| --- | ---: |
| Local run window | 2026-05-26 20:44:43 UTC to 2026-06-06 20:11:12 UTC |
| Total FleetGraph runs | 12,885 |
| Deterministic runs | 12,870 |
| Real-model runs | 15 |
| Model calls | 15 |
| Input tokens | 2,518 |
| Cached input tokens | 0 |
| Persisted billable input tokens | 1,711 |
| Output tokens | 2,346 |
| Total model tokens | 4,864 |
| Persisted estimated model spend | $0.0510714 |
| Missing persisted cost rows | 2 `gpt-5.5` rows; 178 input tokens; 325 output tokens |
| Added correction at `gpt-5.5` catalog rates | $0.0106400 |
| Corrected estimated model spend | $0.0617114 |
| Persisted blended cost per FleetGraph run | $0.000003964 |
| Corrected blended cost per FleetGraph run | $0.000004789 |
| Corrected average cost per real-model run | $0.004114 |
| Average tokens per real-model run | 324.27 |

### Runtime Usage By Model

| Model | Runs | Model calls | Input tokens | Output tokens | Total tokens | Persisted spend | Corrected spend |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `gpt-5.5` | 9 | 9 | 1,978 | 1,712 | 3,690 | $0.0506100 | $0.0612500 |
| `gpt-4.1-mini` legacy mini-priced rows | 6 | 6 | 540 | 634 | 1,174 | $0.0004614 | $0.0004614 |
| deterministic / none | 12,870 | 0 | 0 | 0 | 0 | $0.0000000 | $0.0000000 |

The two missing persisted-cost rows are both `gpt-5.5` demo-proactive-create runs from 2026-05-29. They recorded token usage but `costSource: none`. The correction uses the current local catalog and official model pricing: $5.00 / 1M input tokens and $30.00 / 1M output tokens.

### Runtime Usage By Trigger

| Trigger reason | Runs | Model calls | Total tokens | Persisted spend | Notes |
| --- | ---: | ---: | ---: | ---: | --- |
| `scheduled-worker` | 12,438 | 0 | 0 | $0.0000000 | The dominant path; zero model spend |
| `explain_finding` | 116 | 0 | 0 | $0.0000000 | Deterministic explain path |
| `context-chat` | 68 | 2 | 1,629 | $0.0195950 | Model-backed PM chat when configured |
| `attention-event` | 58 | 0 | 0 | $0.0000000 | Event processing, no model |
| `demo-refine-draft` | 40 | 0 | 0 | $0.0000000 | Deterministic proof path |
| `demo-why-flagged` | 40 | 0 | 0 | $0.0000000 | Deterministic proof path |
| `demo-proactive-create` | 37 | 12 | 2,655 | $0.0209014 | Corrected spend is $0.0315414 |
| `manual-run` | 35 | 0 | 0 | $0.0000000 | Manual graph execution, no model |
| `reviewer-source-mutation-proof` | 31 | 1 | 580 | $0.0105750 | Reviewer chat mutation proof |
| `refine_draft` | 11 | 0 | 0 | $0.0000000 | Deterministic refine path |
| `local-notification-truth-run` | 9 | 0 | 0 | $0.0000000 | Local proof support |
| `summarize_changes` | 2 | 0 | 0 | $0.0000000 | No model in current ledger |

### Runtime Usage By Day

| UTC day | Runs | Model calls | Total tokens | Persisted spend |
| --- | ---: | ---: | ---: | ---: |
| 2026-05-26 | 37 | 0 | 0 | $0.0000000 |
| 2026-05-27 | 99 | 0 | 0 | $0.0000000 |
| 2026-05-28 | 77 | 6 | 1,174 | $0.0004614 |
| 2026-05-29 | 341 | 6 | 1,481 | $0.0204400 |
| 2026-05-30 | 1,090 | 0 | 0 | $0.0000000 |
| 2026-05-31 | 1,692 | 0 | 0 | $0.0000000 |
| 2026-06-01 | 1,349 | 3 | 2,209 | $0.0301700 |
| 2026-06-02 | 1,535 | 0 | 0 | $0.0000000 |
| 2026-06-03 | 1,190 | 0 | 0 | $0.0000000 |
| 2026-06-04 | 1,840 | 0 | 0 | $0.0000000 |
| 2026-06-05 | 2,030 | 0 | 0 | $0.0000000 |
| 2026-06-06 | 1,605 | 0 | 0 | $0.0000000 |

### Latest Published Proof Packet

The currently published FleetGraph proof URL returns a local-target packet:

| Metric | Value |
| --- | ---: |
| URL | `https://ship-shape-web.onrender.com/fleetgraph-observability/proof/latest.json` |
| Generated at | 2026-06-01T16:03:40.433Z |
| Target | `local` |
| Deployed configured | false |
| Required scenarios | 9 |
| Proven scenarios in latest packet | 0 |
| Current surface pass/fail | 8 / 0 |
| Proof packet graph invocations | 0 |
| Proof packet model calls | 0 |
| Proof packet estimated model spend | $0.00 |
| Reviewer chain status | complete |
| Reviewer chain latency | 865 ms |
| Reviewer chain model calls | 0 |
| Reviewer chain cost source | `none` |

This is not the same evidentiary posture as the earlier Week 5 deployed proof packet. The public static file is local because commit `a5c3d066` replaced `web/public/fleetgraph-observability/proof/latest.json` with a local proof artifact and that static artifact later shipped with the web deployment. FleetGraph itself is not local-only; the proof artifact is. For final deployed FleetGraph proof claims, regenerate a deployed/both proof packet and deploy the refreshed static artifact.

Proof refresh attempt on 2026-06-06:

| Field | Value |
| --- | ---: |
| Command | `pnpm fleetgraph:proof -- --mode both --with-e2e` with Render Postgres evidence |
| Generated at | 2026-06-06T20:38:35.664Z |
| Target | `both` |
| Verdict | `fail` |
| Focused API proof tests | pass; 4 files, 34 tests |
| Focused FleetGraph E2E | pass; 1 test |
| Deployed configured | true |
| Deployed graph invocations in packet | 100 |
| Deployed model calls in packet | 0 |
| Deployed estimated model spend in packet | $0.000000 |
| Deployed signals observed | `blocked`, `stale` |
| Missing deployed signal | `at_risk` |
| Missing public trace links | `blocked`, `stale`, `at_risk`, `on_demand` |
| Script mismatch | root `pnpm fleetgraph:eval:surface` is missing; API package has `fleetgraph:eval:surface` |

The generated failed `both` packet should not be deployed as final proof. It is useful failure evidence: Render DB access works, the focused E2E path works, and the remaining deployed proof gaps are signal freshness plus public trace publication.

### Runtime Cost Controls

FleetGraph avoids model spend by design:

- SQL and deterministic candidate policy select candidates before any model boundary.
- No-candidate worker ticks spend zero model tokens.
- Open findings use dedupe/update/quiet paths instead of repeated model-backed creation.
- Context chat is bounded to authorized page/finding/document context, not the full workspace.
- Page context carries capped hints: up to 25 visible item summaries and up to 8 selected IDs.
- Server-side context loading re-authorizes source documents before sending text to the model.
- `usageMetadataFromResult` omits usage metadata entirely when `modelCalls === 0`, making zero-token paths explicit.

## Pricing Assumptions

Pricing was checked on 2026-06-06 against the local FleetGraph catalog and official OpenAI model documentation.

| Model | Input | Cached input | Output | Source |
| --- | ---: | ---: | ---: | --- |
| `gpt-5.5` | $5.00 / 1M tokens | $0.50 / 1M tokens | $30.00 / 1M tokens | `api/src/config/fleetgraph-models.ts`; `https://developers.openai.com/api/docs/models/gpt-5.5` |
| `gpt-5.4` | $2.50 / 1M tokens | $0.25 / 1M tokens | $15.00 / 1M tokens | `api/src/config/fleetgraph-models.ts`; `https://developers.openai.com/api/docs/models/gpt-5.4` |
| `gpt-4o-mini` | $0.15 / 1M tokens | $0.075 / 1M tokens | $0.60 / 1M tokens | `api/src/config/fleetgraph-models.ts`; `https://developers.openai.com/api/docs/models/gpt-4o-mini` |

Important pricing caveats:

- Current projections use standard processing, not Batch, Flex, Priority, or regional/data-residency uplift pricing.
- For `gpt-5.5`, prompts over 272K input tokens are priced higher for the full session. The measured FleetGraph calls are far below that threshold.
- FleetGraph supports env overrides: `FLEETGRAPH_MODEL_INPUT_COST_PER_1M`, `FLEETGRAPH_MODEL_CACHED_INPUT_COST_PER_1M`, and `FLEETGRAPH_MODEL_OUTPUT_COST_PER_1M`.
- Official API pricing can change; this report should be refreshed before any production budget commitment.

## Week 6 PlugForge Cost Analysis

PlugForge turned Ship into a public developer platform. It did not add platform-layer model calls.

### Zero-LLM Boundary

The script `scripts/ci/check-plugforge-no-llm-boundary.mjs` scans these targets:

- `api/src/platform`
- `api/src/fleetgraph/public-api-client.ts`
- `api/src/fleetgraph/attention-context-factory.ts`
- `api/src/fleetgraph/attention-context-reader.ts`
- `sdk/src`
- `integrations`
- selected Developer portal and OAuth web pages

It fails if those files reference model-provider imports, `ChatOpenAI`, `generateContextChatText`, `generateProactiveCreateText`, `OPENAI_API_KEY`, `FLEETGRAPH_MODEL`, or FleetGraph model internals. `pnpm plugforge:verify` and `pnpm plugforge:final` run this guard.

Cost implication: OAuth, `/api/v1`, public OpenAPI, SDK calls, CLI TTFE, webhook delivery, portal operations, Slack, GitLab, and issue external-link upserts do not spend model tokens. With `FLEETGRAPH_USE_PUBLIC_API=true`, user-initiated FleetGraph source reads can go through `@ship/sdk` and `/api/v1`, but that public API hop itself is zero-token. The model boundary remains FleetGraph chat/proactive copy.

### Week 6 Metrics And CI Cost Tracking

Local timing evidence is command/CI cost, not cloud invoice data.

| Cost lane | Evidence | Measured runtime | Cost conclusion |
| --- | --- | ---: | --- |
| Full metrics aggregate | `my-docs/evidence/plugforge-metrics/summary.json` | 219,286 ms | About 3.65 local CI minutes for the metrics gate |
| TTFE drill | `my-docs/evidence/plugforge-metrics/ttfe-timing.json` | 10,412 ms | Packed install/auth/webhook compute only |
| 20-run TTFE flake/P95 loop | `my-docs/evidence/plugforge-metrics/ttfe-flake-loop.json` | 203,262 ms | Local CI compute; catches install/webhook regressions |
| OAuth P95 probe | `my-docs/evidence/plugforge-metrics/oauth-p95.json` | 1,670 ms | API/browser compute only |
| Webhook P95 probe | `my-docs/evidence/plugforge-metrics/webhook-p95.json` | 1,458 ms | DB rows and local HTTP delivery only |
| SDK package size probe | `my-docs/evidence/plugforge-metrics/sdk-size.json` | 19 ms | Build/check overhead only |
| Webhook verifier speed probe | `my-docs/evidence/plugforge-metrics/verify-webhook-speed.json` | 123 ms | CPU-only HMAC verification |
| Baseline comparator | `my-docs/evidence/plugforge-metrics/baseline-comparator.json` | 1,503 ms | CI compute only |

### Week 6 Live Integration Evidence

| Flow | Evidence | Status | Cost conclusion |
| --- | --- | --- | --- |
| Browser SDK demo | `my-docs/evidence/plugforge-integrations/live/browser-sdk.json` | passed; generated 2026-06-05T22:00:13.000Z | OAuth + public API + SDK; zero model calls |
| Slack live proof | `my-docs/evidence/plugforge-integrations/live/slack.json` | passed; generated 2026-06-06T15:24:50.181Z | Slack OAuth + signed Ship webhooks + Slack posts; zero model calls |
| GitLab live proof | `my-docs/evidence/plugforge-integrations/live/gitlab.json` | passed; generated 2026-06-06T16:18:31.874Z | GitLab MR webhook + public issue external link; zero model calls |
| Six-flow matrix | `my-docs/evidence/plugforge-integrations/live/matrix.json` | passed; generated 2026-06-06T16:24:04.332Z | Rolls up CLI TTFE, Slack, browser, GitLab, refresh-token theft, idempotency replay |
| Strict final gate | `my-docs/evidence/plugforge-manual-live.md` | passed | `pnpm plugforge:submission` passed strict final |

The budget pressure from PlugForge is database storage, public API traffic, webhook retries, outbound HTTP, CI time, and hosting for always-on integration receivers. It is not LLM spend.

### Week 6 Non-AI Cost Assumptions

| Assumption | Value |
| --- | ---: |
| Webhook attempts per failed delivery | 6 maximum before DLQ |
| Delivery-log retention | 30 days; target cap 10,000 delivery rows per app |
| Public audit-log retention | 90 days for reviewer/demo analysis, then archive/prune policy required before production |
| Normal demo webhook fanout | 1-2 matching subscriptions |
| Load/proof target fanout | 10 matching subscriptions per `document.created` load-probe target |
| Product-usage sensitivity | 20% monthly active users ask 6 FleetGraph questions/month |
| Canonical reviewer projection | 30 graph invocations per user per 30-day month |
| Platform/integration model calls | 0 |
| Slack/GitLab integration hosting | Currently free; deploy always-on receivers before relying on live external callbacks |

If future PlugForge scope adds model-backed scope suggestions, webhook summaries, app-review copilots, portal copilots, or integration-debug assistants, that is new product scope and this report must be updated before shipping.

## Production Cost Projections

Canonical projection assumption: 30 graph invocations per user per month. This is the reviewer-safe assumption because it matches `FLEETGRAPH.md`, the prior proof-generator framing, and the assignment's requested 100/1,000/10,000-user projections.

The alternative `20% active users * 6 turns/month` assumption is a product-realism sensitivity, not the canonical reviewer projection. It averages to 1.2 model-eligible turns per total user per month, which is far lower and easier to under-defend during review.

For projection purposes, this report interprets that as:

| Assumption | Value |
| --- | ---: |
| Average projects per active user | 1 |
| Proactive graph invocations | 0.8 per project per day |
| On-demand graph invocations | 0.2 per user per day |
| Total normalized invocations | 30 per user per 30-day month |
| Average measured tokens per real-model invocation | 167.87 input / 156.40 output |
| Average measured model tokens per real-model invocation | 324.27 |
| Corrected average cost per real-model invocation | $0.004114 |
| Corrected blended cost per FleetGraph run | $0.000004789 |

The measured blended floor is lower than the previous report because thousands of scheduled worker/update runs were deterministic. That is useful architectural evidence, but it is not a production budget.

### Measured Blended Floor

This table assumes production preserves the same deterministic/model-call mix as the local run ledger.

| Scale | Assumed graph invocations/month | Corrected blended cost/invocation | Projected monthly model spend |
| --- | ---: | ---: | ---: |
| 100 users | 3,000 | $0.000004789 | $0.01 |
| 1,000 users | 30,000 | $0.000004789 | $0.14 |
| 10,000 users | 300,000 | $0.000004789 | $1.44 |

This is an absolute floor. It depends on most work staying deterministic and most scheduled ticks finding no model-worthy candidate.

### All-Model Sensitivity

This table assumes every graph invocation crossed the same average model boundary as the 15 measured real-model runs.

| Scale | Assumed graph invocations/month | Corrected real-model cost/invocation | Projected monthly model spend |
| --- | ---: | ---: | ---: |
| 100 users | 3,000 | $0.004114 | $12.34 |
| 1,000 users | 30,000 | $0.004114 | $123.42 |
| 10,000 users | 300,000 | $0.004114 | $1,234.23 |

This is still probably low for production chat because the measured real-model calls used tiny context payloads.

### Skeptical Production Scenarios

Using `gpt-5.5` standard pricing:

| Scenario | Model-call share | Avg input/output per model call | Effective cost per graph invocation | 100 users | 1,000 users | 10,000 users |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Guarded production | 10% | 2,000 / 500 tokens | $0.002500 | $7.50 | $75.00 | $750.00 |
| Realistic reviewer-risk | 30% | 5,000 / 1,000 tokens | $0.016500 | $49.50 | $495.00 | $4,950.00 |
| Bad product policy | 100% | 10,000 / 2,000 tokens | $0.110000 | $330.00 | $3,300.00 | $33,000.00 |

Budget against the middle row until production telemetry proves lower. The measured blended floor is architecture evidence; the skeptical table is the budget.

If real-model mode is enabled later, use this formula:

```text
monthly model cost =
  users
  * 30 graph invocations per user per month
  * model-call share
  * ((average billable input tokens / 1,000,000) * input price per 1M
     + (average cached input tokens / 1,000,000) * cached input price per 1M
     + (average output tokens / 1,000,000) * output price per 1M)
```

## Cost Cliffs And Controls

The main product cost cliffs:

- Full-workspace reasoning instead of SQL candidate selection.
- Page chat that blindly sends every visible object, document body, and history turn.
- Program-wide rollups without summarization and hard caps.
- Reprocessing unchanged findings every worker tick.
- Webhook fanout without retention and retry caps.
- Treating public API audit logs as permanent hot storage.
- Enabling model-backed portal/copilot features without a separate budget.
- Running `gpt-5.5` sessions above the 272K input-token pricing threshold.

Current controls:

- SQL-first detection and no-candidate zero-token ticks.
- Dedupe keys, suppression, update, and quiet-exit paths.
- Context chat caps and server-side authorization before source text enters the model prompt.
- PlugForge zero-LLM boundary checker.
- Webhook max-attempt DLQ.
- Delivery-log and audit-log retention targets.
- Reviewer evidence that separates deterministic proof from real-model proof.

The simplest 10x cost move is to default FleetGraph production chat to a cheaper model such as `gpt-5.4` or `gpt-4o-mini` for routine explanations, reserving `gpt-5.5` for high-stakes reasoning. That is not implemented as routing today; it is the obvious future control if chat usage grows.

## Evidence And Methodology

### Codex Usage Queries

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

### FleetGraph Run Ledger Queries

The current database URL was resolved with:

```bash
/Users/michaelhabermas/repos/GAI/ship-shape/scripts/resolve-database-url.sh ship_dev
```

Current result:

```text
postgresql://ship:ship_dev_password@localhost:5432/ship_dev
```

Ledger summary:

```bash
psql 'postgresql://ship:ship_dev_password@localhost:5432/ship_dev' -P pager=off \
  -c "select count(*) as runs,
             min(created_at) as first_run,
             max(created_at) as last_run,
             sum(coalesce((token_metadata->>'modelCalls')::int,0)) as model_calls,
             sum(coalesce((token_metadata->>'inputTokens')::int,0)) as input_tokens,
             sum(coalesce((token_metadata->>'cachedInputTokens')::int,0)) as cached_input_tokens,
             sum(coalesce((token_metadata->>'billableInputTokens')::int,0)) as billable_input_tokens,
             sum(coalesce((token_metadata->>'outputTokens')::int,0)) as output_tokens,
             sum(coalesce((token_metadata->>'totalTokens')::int,0)) as total_tokens,
             sum(coalesce((cost_metadata->>'estimatedCostUsd')::numeric,
                          coalesce((cost_metadata->>'modelCostUsd')::numeric,0))) as estimated_cost_usd
      from fleetgraph_runs;"
```

Missing-cost correction query:

```bash
psql 'postgresql://ship:ship_dev_password@localhost:5432/ship_dev' -P pager=off \
  -c "select count(*) as model_runs_missing_persisted_cost,
             sum(coalesce((token_metadata->>'inputTokens')::int,0)) as input_tokens,
             sum(coalesce((token_metadata->>'outputTokens')::int,0)) as output_tokens,
             sum(coalesce((token_metadata->>'totalTokens')::int,0)) as total_tokens
      from fleetgraph_runs
      where coalesce((token_metadata->>'modelCalls')::int,0) > 0
        and coalesce((cost_metadata->>'estimatedCostUsd')::numeric,
                     coalesce((cost_metadata->>'modelCostUsd')::numeric,0)) = 0;"
```

### FleetGraph Proof Query

```bash
curl -fsSL https://ship-shape-web.onrender.com/fleetgraph-observability/proof/latest.json \
  | jq '{generatedAt, target, summary, costs, reviewerChain:
        {chainId: .reviewerChain.chainId,
         status: .reviewerChain.status,
         latencyMs: .reviewerChain.latencyMs,
         usageSummary: .reviewerChain.usageSummary}}'
```

### PlugForge Evidence Queries

```bash
jq '{generatedAt, durationMs, ok, status,
     probes: [.probes[] | {name, status, ok, durationMs, metric, outputPath}]}'
  /Users/michaelhabermas/repos/GAI/ship-shape/my-docs/evidence/plugforge-metrics/summary.json
```

```bash
jq '{flow, run_id, generated_at, proof_class, status, flows}'
  /Users/michaelhabermas/repos/GAI/ship-shape/my-docs/evidence/plugforge-integrations/live/matrix.json
```

```bash
node ./scripts/ci/check-plugforge-no-llm-boundary.mjs
```

### Pricing Sources

- OpenAI GPT-5.5 model pricing: `https://developers.openai.com/api/docs/models/gpt-5.5`
- OpenAI GPT-5.4 model pricing: `https://developers.openai.com/api/docs/models/gpt-5.4`
- OpenAI GPT-4o mini model pricing: `https://developers.openai.com/api/docs/models/gpt-4o-mini`
- General OpenAI pricing page: `https://openai.com/api/pricing/`
- Local FleetGraph catalog: `api/src/config/fleetgraph-models.ts`

## Reflection On AI Tool Effectiveness

AI was most useful as a comprehension and proof accelerator. The valuable work was not generic code generation; it was fast orientation across a mature codebase, repeated audit passes, trace/proof construction, route-contract consistency, and compressing many repository facts into reviewer-readable artifacts.

The largest development cost driver was broad repeated context. Source-of-truth docs, proof packets, OpenAPI files, generated types, test output, diffs, and review passes are all context-heavy. That was sometimes worth it because the assignment rewarded proof, but it is the expensive way to work.

The runtime story is better: FleetGraph spends almost nothing when it can answer with SQL, dedupe state, and bounded deterministic policy. PM chat changes that. If users like chat and use it heavily, chat becomes the real production model budget, not the background worker.

## Remaining Follow-Up

Resolved from owner input on 2026-06-06:

- Cash basis is $537 so far: two $60 Cursor subscriptions, two $200 Codex subscriptions, $7 Render, and $10 OpenAI credit.
- Slack/GitLab integration services are currently free.
- Canonical production projection should stay reviewer-safe at 30 graph invocations/user/month; the lower active-user assumption remains sensitivity only.

Still open:

1. Refresh deployed FleetGraph proof until the packet verdict is `pass`, then deploy the refreshed static artifact. The 2026-06-06 attempt failed because deployed evidence lacked `at_risk`, lacked public LangSmith trace links, and the root `fleetgraph:eval:surface` script is missing.
2. Provide any Claude/ChatGPT invoice or token export if there was paid usage beyond the confirmed $537 cash basis.
