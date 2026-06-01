# FleetGraph conversational chat

Current law for PM-facing context chat (`POST /api/fleetgraph/chat`). Week 5 submission archive lives under `my-docs/project-weeks-sot/week-5/archive/submission-deterministic-chat/` and is not product direction.

## Product contract

- Context chips, page context, and attached documents name the **conversation topic**. They are not command menus or regex intents.
- The assistant answers in natural language grounded in **authorized server-loaded** records. Client labels and IDs are hints only.
- General questions are allowed when the user is not asking Ship to mutate data or contact anyone.
- Mutation or contact requests stay **human-gated**. The assistant must never claim Ship records changed or anyone was messaged.
- If the model is not configured, the API returns an honest **unavailable** message. It does not fake conversation with a template router.

## Runtime

- **Only path:** `generateContextChatText` in `api/src/fleetgraph/model.ts` when `shouldUseChatModel()` is true (`OPENAI_API_KEY` and `FLEETGRAPH_MODEL` set).
- **No model:** `chatModelUnavailableAnswer` in `api/src/fleetgraph/runtime/chat-fallback.ts` — configuration error text only, no prompt routing.
- **Unchanged deterministic:** SQL attention detection, worker ticks, explain-finding structured output, human gates, permission filtering.

## Environment

| Variable | Purpose |
| --- | --- |
| `OPENAI_API_KEY` | Required for PM chat |
| `FLEETGRAPH_MODEL` | Required model name (catalog in `api/src/config/fleetgraph-models.ts`) |
| `FLEETGRAPH_REAL_MODEL_ENABLED=true` | Gates **proactive create** copy only |

Do not add a chat-deterministic env flag or any switch that disables the chat model in dev/prod.

## Tests

- Behavior contract: `api/src/fleetgraph/eval/chat-behavior.ts` (rubric, not exact template prose).
- Unit tests mock **`@langchain/openai`** via `api/src/fleetgraph/test/setup-chat-openai-mock.ts` so `generateContextChatText` stays on the real code path. Do not mock `generateContextChatText` directly and do not add product-side regex routers.
- E2E chat smoke requires `OPENAI_API_KEY` in the environment; otherwise the spec is skipped.

## Agents

Do not reintroduce template routers, intent classifiers, or offline “fake chat” for PM paths. Change the model prompt, context assembly, or rubric cases instead.
