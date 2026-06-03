# Reviewer Guide

This guide is for external reviewers evaluating the Plugforge platform work (Week 6) on the deployed Render sites. No local `pnpm dev`, database, or code checkout is required.

## Primary Reviewer Pages (open these in your browser)

1. **Public API Contract Viewer (Redoc)**
   - URL: https://ship-shape-web.onrender.com/platform-docs.html
   - What it shows: Interactive, generated OpenAPI 3.1 documentation for the new public `/api/v1/*` surface.
   - Includes: all endpoints, required OAuth scopes (e.g. `documents:read`, `webhooks:manage`), request/response schemas, examples, auth flows.
   - The full contract spec it loads is also directly available at:
     - https://ship-shape-web.onrender.com/api/v1/openapi.json
     - https://ship-shape-web.onrender.com/openapi.json

2. **Reviewer Packet (self-contained narrative + evidence)**
   - URL: https://ship-shape-web.onrender.com/plugforge-reviewer-packet.html
   - What it contains:
     - The signature "5-line developer story" / Time-to-First-Event (TTFE) drill (the real acceptance bar).
     - Live surfaces and how to demo them (viewer, SDK demo page, in-app Developer portal, OAuth device verification, CLI drill).
     - Complete table of the public contract (every route + required scope + SDK client method).
     - Key proofs, fitness tests, boundary enforcement, webhook reliability details.
     - Architecture highlights and SOLID rationale pointers.
     - Exact repro steps a reviewer can follow on the deployed site.
     - Links to source-of-truth docs (spec, PRD, PRESEARCH, architecture.md, etc.).
   - This is the main artifact designed so the platform work does not get buried in the rest of the app or the general category ledger.

(These files are committed to `web/public/` so they are served as static assets on every web deploy. The packet was previously only in `my-docs/` and not reviewer-visible on prod.)

## API Base and Live Endpoints

- Deployed API: https://ship-shape-api.onrender.com
  - Health: https://ship-shape-api.onrender.com/health (should return `{"status":"ok"}`)
- Public platform endpoints live under `/api/v1/` (OAuth-protected with scopes). See the full list + shapes in the Redoc viewer above.
  - Examples (not exhaustive):
    - `GET /api/v1/me`
    - `GET /api/v1/documents`, `GET /api/v1/documents/:id`, `POST /api/v1/documents`
    - `GET /api/v1/issues`, `POST /api/v1/issues`, `PATCH /api/v1/issues/:id`
    - `GET /api/v1/sprints`, `GET /api/v1/sprints/:id`, `GET /api/v1/sprints/:id/issues`
    - `GET /api/v1/webhooks`, `POST /api/v1/webhooks`, deliveries list + replay
    - `GET /api/v1/openapi.json` (public, no auth)
    - `GET /api/v1/fleetgraph/attention-contexts` (agent surface)
  - OAuth provider (device flow, PKCE, etc.): `/oauth/authorize`, `/oauth/token`, `/oauth/device/code`, `/oauth/device/verify` on the API host.
- The in-app **Developer Portal** (self-service for OAuth apps, webhook subs, delivery log + replay) is inside the web app (see repro steps in the packet).

## Repro / Demo Steps for Reviewers (follow the packet)

See the "Repro for Reviewers (live demo script)" section inside the packet for the exact flow.

High-level:
- Open the main web: https://ship-shape-web.onrender.com/
- (Optional but recommended for portal demo) Log in as an admin user in a workspace.
- Go to Workspace Settings → Developer tab to create OAuth apps (client secret shown once), manage webhooks, view/replay deliveries.
- Use the viewer (link above) or the SDK demo page (`/sdk-demo`) with a created client ID for PKCE flow.
- For the signature TTFE experience: use the CLI (`ship login` via device flow against the deployed API, create doc, `ship webhooks tail` to receive and verify signed webhook). The packet has the exact commands.
- The 5-line story that proves the platform contract: `pnpm install @ship/sdk` → `ship login` → `ship docs create` → `ship webhooks tail` (verified signed delivery arrives).

Pre-registered OAuth apps with read-only scopes may be provided for graders (see packet or ask for credentials). The packet also covers negative cases (bad verifier, etc.) and the agent rewire proof.

## Other Useful Deployed Links

- Main web app: https://ship-shape-web.onrender.com/
- API health: https://ship-shape-api.onrender.com/health
- (If needed for other evidence) Reviewer evidence bundle (currently contains week-4 artifacts + security submission material): https://ship-shape-reviewer-evidence.onrender.com/

## Notes for This Deploy

- The public `/api/v1` surface (and its OpenAPI) is the core of the Plugforge work. The viewer + packet are the two pages a reviewer should open first.
- The backend API deploy must include the platform code (oauth apps, scopes, event bus, webhooks deliverer, public v1 router, etc.) for live calls to succeed. Health may be green even if the v1 surface is not yet wired in a particular deploy.
- Login for the in-app portal (if you want to demo app registration / deliveries): use the documented dev credentials or a pre-provisioned grader account (see the packet for details).
- The viewer on the production web origin defaults to loading the spec from the same origin (`/api/v1/openapi.json`). We published the full committed snapshot there so reviewers see the complete contract.
- The packet is now also published statically on the web so it is directly reachable.

## Background / Submission Context

See the packet itself and `my-docs/project-weeks-sot/week-6/` (PRD.md, PRESEARCH.md, DECISION_LOG-w6.md, w6-specs/Plugforge-specs.txt) for the full requirements, architecture decisions, and proof artifacts. The TTFE drill (`pnpm drill ttfe`) is the canonical end-to-end proof that a stranger can go from `pnpm install @ship/sdk` to a verified signed webhook.

If anything is missing or the spec in the viewer looks stale after a deploy, re-run the web build after ensuring `docs/openapi.json` (the authoritative full snapshot) and the packet are present under `web/public/`.
