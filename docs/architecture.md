# Architecture Document

Required by Plugforge: 1–2 pages at `docs/architecture.md`. Section requirements from `my-docs/project-weeks-sot/week-6/w6-specs/Plugforge-specs.txt` (Required Documentation → Architecture Document).

---

## Module Layout

<!--
Tree of api/src/platform/ and sdk/ with one sentence per module (apps,
oauth, scopes, ratelimit, webhooks, api/v1, openapi, audit).
-->

---

## SOLID Rationale

<!--
One paragraph per principle showing exactly where it appears in your
code, with a file path reference. ScopeRegistry as OCP, IEventBus as DIP,
resource-segregated SDK clients as ISP are strong candidates.
-->

---

## Composition Root

<!--
Annotated pseudo-code of api/src/app.ts wiring concrete OAuth,
rate-limiter, event-bus, and webhook-deliverer implementations. Include
the in-memory test wiring as a sibling diagram.
-->

---

## Public/Internal Boundary

<!--
Sequence diagram showing how /api/v1/ routes call the same domain
services as internal routes, with auth/scope/audit/webhook attaching only
at the public layer.
-->

---

## OAuth Flows

<!--
Sequence diagrams for Authorization Code + PKCE and Device
Authorization Grant. Mark where PKCE verifier is validated and where
refresh-token rotation happens.
-->

---

## Webhook Pipeline

<!--
Event source → IEventBus → subscription matcher → signer →
IWebhookDeliverer → retry scheduler → delivery log. Mark where the
signature is computed and where Idempotency-Key originates.
-->

---

## SDK Surface

<!--
Public surface of @ship/sdk: resource clients, auth helpers, async iterators,
error union, webhook verifier. Mark which surfaces are stable and which
are pre-1.0.
-->

---

## Agent-as-Citizen

<!--
Before/after diagram of the agent's call path. Before: direct domain calls.
After: OAuth app → SDK → public API → same domain services. Mark the
audit-log payoff.
-->

---

## Failure Modes

<!--
What happens when: the token store is corrupted, a subscriber's signing
secret is rotated mid-flight, the queue deliverer crashes, the OpenAPI
generator throws at boot. One paragraph each.
-->
