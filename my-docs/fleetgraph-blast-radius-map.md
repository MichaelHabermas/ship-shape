# FleetGraph Blast Radius Map

Added 2026-05-31.

FleetGraph blast radius is a deterministic, read-only projection for a finding. It answers: what visible issue, week, project, program, person, and related finding context is implicated if this finding stays unresolved?

## Boundary

- Source truth remains Ship documents, `document_associations`, and FleetGraph findings.
- No new persistence table.
- No model call.
- No Ship mutation.
- No broad workspace graph endpoint.
- Hidden graph nodes are omitted, not redacted.

## API

`GET /api/fleetgraph/findings/:findingId/blast-radius-map`

The route returns semantic nodes and edges only. The web owns layout. The route returns `404` when the finding is absent or not safely visible to the actor.

Implementation notes (2026-05-31):

- Document anchor rows are fetched in one SQL query, then filtered with batch `filterReadableDocumentIds` for session/API-token actors.
- Person document rows batch-filter the same way; user-name fallback rows follow D087 when the root finding is already visible.
- Document, people, and related-finding subgraphs assemble in parallel after the root finding passes `visibleOutputForFinding`.
- Related findings stop after three visible matches instead of scanning a fixed over-fetch window.

## UI

The reviewer page shows the map in the right rail as visible impact context via `web/src/components/fleetgraph-reviewer/BlastRadiusPanel.tsx`. Copy should say "visible impact" or "blast radius"; it should not claim affected users, causality, or complete organizational impact unless the backend actually computes those facts.

## Follow-Up

The 10x next step is to reuse this map on PM-facing finding surfaces, not only reviewer proof. Keep the same endpoint and response shape; do not fork a reviewer-only version.
