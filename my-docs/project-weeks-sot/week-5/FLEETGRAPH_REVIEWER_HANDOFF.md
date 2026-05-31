# FleetGraph Reviewer Evidence Handoff

Final reviewer evidence is the public proof packet:

- Public proof: `https://ship-shape-web.onrender.com/fleetgraph-observability/proof/latest.html`
- Generated source of truth: `web/public/fleetgraph-observability/proof/latest.json`
- Required verifier: `pnpm fleetgraph:proof:verify-traces`

What changed:

- The proof packet now renders a Reviewer Test Cases table with one direct public LangSmith trace URL per reviewer-facing case.
- Submission proof requires `https://smith.langchain.com/public/...` links. Langfuse links are no longer accepted for final reviewer evidence.
- Proof checks reject stale evidence text when it disagrees with `api/src/fleetgraph/detection/attention-policy.ts`.
- Public and local proof artifacts must agree for deployed submission proof.

Manual checks still required:

- Open each LangSmith link in an incognito browser and confirm the trace content is readable.
- Confirm the deployed proof was generated from Render Postgres evidence, not local-only proof.
- Confirm the proof packet shows `Verdict: pass`, `30+ days`, and no `180+ days` stale text.
