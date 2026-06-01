# FleetGraph Reviewer Proof

Canonical reviewer instructions now live in root [`REVIEWER_GUIDE.md`](../../../REVIEWER_GUIDE.md).

Keep this Week 5 file as a pointer only. It exists for source-of-truth navigation from the Week 5 folder, not as a second reviewer checklist.

Current proof anchors:

- Live reviewer dashboard: `https://ship-shape-web.onrender.com/fleetgraph/reviewer`
- Public proof packet: `https://ship-shape-web.onrender.com/fleetgraph-observability/proof/latest.html`
- Machine-readable public proof: `web/public/fleetgraph-observability/proof/latest.json`
- Final claim boundary: [`FLEETGRAPH.md`](../../../FLEETGRAPH.md)

Verification:

```bash
pnpm fleetgraph:proof:check
pnpm fleetgraph:proof:verify-traces
```
