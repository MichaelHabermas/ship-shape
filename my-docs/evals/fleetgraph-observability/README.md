# FleetGraph Observability Trial

Run the local trial with:

```bash
pnpm fleetgraph:observe --max-runs 5
```

The command emits FleetGraph traces to Langfuse and LangSmith, posts deterministic scores when provider APIs allow it, and writes JSON/Markdown reports in this folder. Use `--providers=langfuse`, `--providers=langsmith`, or `--providers=both`; use `--no-model` for a no-spend dry run.

The generated control plane lives in three places:

- Visual dashboard: `dashboard.html`.
- Run reports: `run-*.md` and `run-*.json` in this folder.
- Edge-case dataset: `datasets/edge-cases.md` and `datasets/edge-cases.json`.
- Provider traces: each run report links the matching Langfuse and LangSmith traces.

The dataset is the 10x loop: every failed-score trace, provider-friction trace, or real-cost trace becomes a replay/review item for future regression protection.

Regenerate the dashboard with:

```bash
pnpm fleetgraph:observe:dashboard
```

## Provider Setup

- Langfuse: compare trace rows, generation usage, native scores, and Code Evaluator ergonomics. Mirror the local score names as Code Evaluators when testing live observation automation.
- LangSmith: compare runs, shared links, feedback scores, and annotation queue ergonomics. Mirror the local score names as feedback/rubric keys when testing human review.

## Score Names

`trace_safety`, `usage_present`, `quiet_exit_zero_cost`, `human_gate_present`, `no_fake_mutation_claim`, `decision_shape_valid`, `output_actionability`, `output_groundedness`.
