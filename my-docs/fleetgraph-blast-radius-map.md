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

## UI

The reviewer page shows the map in the right rail as visible impact context. Copy should say "visible impact" or "blast radius"; it should not claim affected users, causality, or complete organizational impact unless the backend actually computes those facts.

## Follow-Up

The 10x next step is to reuse this map on PM-facing finding surfaces, not only reviewer proof. Keep the same endpoint and response shape; do not fork a reviewer-only version.
