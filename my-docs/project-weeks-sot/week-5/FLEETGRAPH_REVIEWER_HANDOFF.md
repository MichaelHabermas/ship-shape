# FleetGraph Reviewer Handoff

Use root [`REVIEWER_GUIDE.md`](../../../REVIEWER_GUIDE.md) as the canonical handoff.

This file remains only as a Week 5 folder pointer. Do not maintain a parallel checklist here.

Fast path:

1. Sign in with the reviewer/admin account.
2. Open `https://ship-shape-web.onrender.com/fleetgraph/reviewer`.
3. Confirm the selected chain is `complete`.
4. Open `https://ship-shape-web.onrender.com/fleetgraph-observability/proof/latest.html`.
5. Run `pnpm fleetgraph:proof:check` and `pnpm fleetgraph:proof:verify-traces` when changing proof docs or artifacts.
