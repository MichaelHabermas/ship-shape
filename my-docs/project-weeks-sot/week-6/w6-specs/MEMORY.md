# Week 6 Spec Memory

Non-canonical implementation memory only. Canon remains `Plugforge-specs.txt` / `.pdf` and explicit user decisions.

- 2026-06-02: The Agent-as-Citizen slice uses delegated Ship Agent OAuth tokens tied to the initiating user/session, not Client Credentials.
- 2026-06-02: Webhook read-context hardening replaces private issue suppression with subscription subject/scope snapshots and enqueue-time resource readability checks.
- 2026-06-02: FleetGraph-owned findings/runs stay internal. Public API gap fill is limited to source-read context: `GET /api/v1/fleetgraph/attention-contexts`.
- 2026-06-02: `docs/architecture.md` is intentionally deferred until the last docs pass for this group.
- 2026-06-03: External client proof pack is one gate: `pnpm plugforge:final`.
- 2026-06-03: GitLab links existing Ship issues through public `issue external_links` metadata and `@ship/sdk`; it does not import internals or create issues for missing markers.
- 2026-06-04: Webhook + Metrics closure is scoped to `W6-WEBHOOK-*` and `W6-METRIC-*`; keep `W6-INT-*` pending for reference integration acceptance.
