# FleetGraph Chat Behavior Evals

This eval pack protects the user-visible chat contract for contextual FleetGraph chat.

Source cases live in `api/src/fleetgraph/eval/chat-behavior.ts`. Add a case there when a real chat issue appears, then fix the behavior until the case passes. The goal is outside-in behavior, not exact prose: normal greetings, grounded summaries, meaningful simplification, no hallucination from sparse context, and follow-ups that use bounded recent history. Tests mock `@langchain/openai` on the real `generateContextChatText` path (`api/src/fleetgraph/test/setup-chat-openai-mock.ts`).

Run the focused suite with:

```bash
DATABASE_URL=postgresql://ship:ship_dev_password@localhost:5432/ship_test_audit pnpm --filter api test -- src/fleetgraph/eval/chat-behavior.test.ts src/routes/fleetgraph.test.ts
```

Browser wiring smoke lives in `e2e/fleetgraph-chat.spec.ts`; skipped unless `OPENAI_API_KEY` is set.
