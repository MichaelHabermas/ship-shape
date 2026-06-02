<p align="center">
  <a href="https://github.com/US-Department-of-the-Treasury/ship">
    <img src="web/public/icons/blue/android-chrome-512x512.png" alt="Ship logo" width="120">
  </a>
</p>

<h1 align="center">Ship</h1>

<p align="center">
  <strong>Project management that helps teams learn and improve</strong>
</p>

<p align="center">
  <a href="./LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License"></a>
  <a href="https://github.com/US-Department-of-the-Treasury/ship/pulls"><img src="https://img.shields.io/badge/PRs-welcome-brightgreen.svg" alt="PRs Welcome"></a>
  <img src="https://img.shields.io/badge/Section_508-Target-blue.svg" alt="Section 508 Target">
  <img src="https://img.shields.io/badge/WCAG_2.1_AA-Target-blue.svg" alt="WCAG 2.1 AA Target">
</p>

---

## What is Ship?

Ship is a project management tool that combines documentation, issue tracking, and plan-driven weekly workflows in one place. Instead of switching between a wiki, a task tracker, and a spreadsheet, everything lives together.

**Built by the U.S. Department of the Treasury** for government teams, but useful for any organization that wants to work more effectively.

---

## How to Use Ship

Ship has four main views, each designed for different questions:

| View | What it answers |
|------|-----------------|
| **Docs** | "Where's that document?" — Wiki-style pages for team knowledge |
| **Issues** | "What needs to be done?" — Track tasks, bugs, and features |
| **Projects** | "What are we building?" — Group issues into deliverables |
| **Teams** | "Who's doing what?" — See workload across people and weeks |

### The Basics

1. **Create documents** for anything your team needs to remember — meeting notes, specs, onboarding guides
2. **Create issues** for work that needs to get done — assign them to people and track progress
3. **Group issues into projects** to organize related work
4. **Write weekly plans** to declare what you intend to accomplish each week

Everyone on the team can edit documents at the same time. You'll see other people's cursors as they type.

---

## The Ship Philosophy

### Everything is a Document

In Ship, there's no difference between a "wiki page" and an "issue" at the data level. They're all documents with different properties. This means:

- You can link any document to any other document
- Issues can have rich content, not just a title and description
- Projects and weeks are documents too — they can contain notes, decisions, and context

### Plans Are the Unit of Intent

Ship is plan-driven: each week starts with a written plan declaring what you intend to accomplish and ends with a retro capturing what you learned. Issues are a trailing indicator of what was done, not a leading indicator of what to do.

1. **Plan (Weekly Plan)** — Before the week, write down what you intend to accomplish and why
2. **Execute (The Week)** — Do the work; issues track what was actually done
3. **Reflect (Weekly Retro)** — After the week, write down what actually happened and what you learned

This isn't paperwork for paperwork's sake. Teams that skip retrospectives repeat the same mistakes. Teams that write things down learn and improve.

### Learning, Not Compliance

Documentation requirements in Ship are visible but not blocking. You can start a new week without finishing the last retro. But the system makes missing documentation obvious — it shows up as a visual indicator that escalates from yellow to red over time.

The goal isn't to check boxes. It's to capture what your team learned so you can get better.

---

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) 20 or newer
- [pnpm](https://pnpm.io/) (`npm install -g pnpm`)
- PostgreSQL 14 or newer for normal local development
- [Docker](https://www.docker.com/) for E2E tests and optional full-stack Docker Compose

### Setup

```bash
# 1. Clone the repository
git clone https://github.com/US-Department-of-the-Treasury/ship.git
cd ship

# 2. Install dependencies
pnpm install

# 3. Start the application
pnpm dev
```

`pnpm dev` creates `api/.env.local` if needed, creates a local PostgreSQL database for this checkout, runs migrations and seed data for a fresh database, picks open API/web ports, and starts both servers.

If you prefer a containerized local stack, use:

```bash
pnpm docker:up
```

That starts PostgreSQL, the API, and the web app through `docker-compose.local.yml`. E2E tests also require Docker because Playwright uses Testcontainers-backed PostgreSQL isolation.

### Open the App

Once it's running, open your browser to:

**http://localhost:5173**

Log in with the demo account:
- **Email:** `dev@ship.local`
- **Password:** `admin123`

### What's Running

| Service | URL | Description |
|---------|-----|-------------|
| Web app | http://localhost:5173 | The Ship interface |
| API server | http://localhost:3000 | Backend services |
| Swagger UI | http://localhost:3000/api/docs | Interactive API documentation |
| Internal OpenAPI spec | http://localhost:3000/api/openapi.json | Internal `/api` OpenAPI specification |
| Public API OpenAPI spec | http://localhost:3000/api/v1/openapi.json | Generated `/api/v1` OpenAPI 3.1 specification |
| PostgreSQL | local instance | Database used by `pnpm dev` |

### Common Commands

```bash
pnpm dev          # Start everything
pnpm dev:web      # Start just the web app
pnpm dev:api      # Start just the API
pnpm docker:up    # Start the optional Docker Compose stack
pnpm db:seed      # Reset database with sample data
pnpm db:migrate   # Run database migrations
pnpm test         # Run tests
```

---

## Technical Details

### Architecture

Ship is a monorepo with three packages:

- **web/** — React frontend with TipTap editor for real-time collaboration
- **api/** — Express backend with WebSocket support
- **shared/** — TypeScript types used by both

### Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | React, Vite, TailwindCSS |
| Editor | TipTap + Yjs (real-time collaboration) |
| Backend | Express, Node.js |
| Database | PostgreSQL |
| Real-time | WebSocket |

### Design Decisions

- **Everything is a document** — Single `documents` table with a `document_type` field
- **Server is truth** — Offline-tolerant, syncs when reconnected
- **Boring technology** — Well-understood tools over cutting-edge experiments
- **E2E testing** — 71 Playwright specs, organized into focused lanes for real user flows

See [docs/application-architecture.md](docs/application-architecture.md) for more.

### Repository Structure

```
ship/
├── api/                    # Express backend
│   ├── src/
│   │   ├── routes/         # REST endpoints
│   │   ├── collaboration/  # WebSocket + Yjs sync
│   │   └── db/             # Database queries
│   └── package.json
│
├── web/                    # React frontend
│   ├── src/
│   │   ├── components/     # UI components
│   │   ├── pages/          # Route pages
│   │   └── hooks/          # Custom hooks
│   └── package.json
│
├── shared/                 # Shared TypeScript types
├── e2e/                    # Playwright E2E tests
└── docs/                   # Architecture documentation
```

---

## Testing

```bash
# Run API unit tests
pnpm test

# Install Playwright Chromium on a fresh machine / after Playwright updates
pnpm test:e2e:setup

# Run all E2E tests without streaming 600+ test lines into Codex
pnpm test:e2e:run

# Rerun only Playwright's last failed tests
pnpm test:e2e:run -- --last-failed
```

Ship uses Playwright for end-to-end testing with Testcontainers-backed PostgreSQL isolation. Docker must be running for E2E tests.

---

## Week 4 Audit Evidence

This fork includes reviewer-facing evidence for the ShipShape audit and improvement sprint:

| Artifact | Purpose |
|----------|---------|
| [`my-docs/project-weeks-sot/week-4/SUBMISSION_CHECKLIST.md`](./my-docs/project-weeks-sot/week-4/SUBMISSION_CHECKLIST.md) | Start-here checklist, proof map, deploy smoke, and final verification commands |
| [`my-docs/project-weeks-sot/week-4/reviewer-dashboard.html`](./my-docs/project-weeks-sot/week-4/reviewer-dashboard.html) | Generated visual dashboard for Categories 1-8 |
| [`my-docs/evidence/submission-ledger.json`](./my-docs/evidence/submission-ledger.json) | Structured source of truth for category claims |
| [`my-docs/project-weeks-sot/week-4/IMPROVEMENT_REPORT.md`](./my-docs/project-weeks-sot/week-4/IMPROVEMENT_REPORT.md) | Narrative improvement history and claim boundaries |
| [`my-docs/project-weeks-sot/week-4/AUDIT_REPORT.md`](./my-docs/project-weeks-sot/week-4/AUDIT_REPORT.md) | Baseline audit report |
| [`my-docs/project-weeks-sot/week-4/discovery-research-log.md`](./my-docs/project-weeks-sot/week-4/discovery-research-log.md) | Discovery write-up and disposition log |
| [`my-docs/AI_COST_ANALYSIS.md`](./my-docs/AI_COST_ANALYSIS.md) | AI usage, cost basis, and reflection |

Submission gates:

```bash
pnpm submission:validate
pnpm submission:render
pnpm submission:check
pnpm docs:check:strict
```

The ledger is the claim authority. The dashboard and Current Ledger Truth block are generated from it; do not hand-edit generated proof.

---

## Week 5 FleetGraph Evidence

Start with [`REVIEWER_GUIDE.md`](./REVIEWER_GUIDE.md). The final Week 5 deliverables are [`FLEETGRAPH.md`](./FLEETGRAPH.md) and [`PRESEARCH.md`](./PRESEARCH.md). The canonical public proof snapshot is [`web/public/fleetgraph-observability/proof/latest.html`](./web/public/fleetgraph-observability/proof/latest.html); broader observability history dashboards are local scratch output from `pnpm fleetgraph:observe:dashboard`.

## Week 6 PlugForge Evidence

Week 6 source of truth lives under [`my-docs/project-weeks-sot/week-6/`](./my-docs/project-weeks-sot/week-6/). Current public platform surfaces:

| Surface | Local path |
|---------|------------|
| Public OpenAPI route | http://localhost:3000/api/v1/openapi.json |
| Generated public OpenAPI artifact | [`docs/openapi.json`](./docs/openapi.json) |
| Browser SDK demo | http://localhost:5173/sdk-demo |
| OAuth app registration | `POST /api/platform/apps` with session auth and workspace admin role |
| OAuth authorize | `GET /oauth/authorize` |
| Device verification | http://localhost:5173/oauth/device |
| TTFE drill | `pnpm drill ttfe` |

Demo login remains `dev@ship.local` / `admin123`. OAuth client IDs and shown-once client secrets are created through the app registration endpoint; this branch does not seed a fixed public demo client.

---

## Deployment

Ship currently has a Render deployment path for public/demo evidence and an AWS/Terraform path for future government-style infrastructure work.

| Environment | Recommended Approach |
|-------------|---------------------|
| **Local development** | `pnpm dev` with local PostgreSQL |
| **Optional local container stack** | `pnpm docker:up` |
| **Public/demo deployment** | Render (`render.yaml`) |
| **Future government deployment** | AWS/Terraform docs in `DEPLOYMENT.md` and `terraform/` |

Public demo URLs used for final smoke evidence:

| Service | URL |
|---------|-----|
| Web app | https://ship-shape-web.onrender.com/ |
| API health | https://ship-shape-api.onrender.com/health |
| Reviewer evidence bundle | https://ship-shape-reviewer-evidence.onrender.com/ |

Final smoke evidence lives in [`my-docs/evidence/deploy-smoke-2026-05-24.md`](./my-docs/evidence/deploy-smoke-2026-05-24.md).

### Docker

```bash
# Run the local Docker Compose stack
pnpm docker:up
```

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | Required |
| `SESSION_SECRET` | Cookie signing secret | Required |
| `PORT` | API server port | `3000` |

---

## Security

- **No external telemetry** — No Sentry, PostHog, or third-party analytics
- **No external CDN** — All assets served from your infrastructure
- **Session timeout** — 15-minute idle timeout (government standard)
- **Audit logging** — Track all document operations

> **Reporting Vulnerabilities:** See [SECURITY.md](./SECURITY.md) for our vulnerability disclosure policy.

---

## Accessibility

Ship targets Section 508 and WCAG 2.1 AA accessibility:

- All color contrasts meet 4.5:1 minimum
- Full keyboard navigation
- Screen reader support
- Visible focus indicators

---

## Contributing

We welcome contributions. See [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines.

---

## Documentation

- [Application Architecture](./docs/application-architecture.md) — Tech stack and design decisions
- [Unified Document Model](./docs/unified-document-model.md) — Data model and sync architecture
- [Document Model Conventions](./docs/document-model-conventions.md) — Terminology and patterns
- [Week Documentation Philosophy](./docs/week-documentation-philosophy.md) — Why weekly plans and retros work the way they do
- [Accountability Philosophy](./docs/accountability-philosophy.md) — How Ship enforces accountability
- [Accountability Manager Guide](./docs/accountability-manager-guide.md) — Using approval workflows
- [Contributing Guidelines](./CONTRIBUTING.md) — How to contribute
- [Security Policy](./SECURITY.md) — Vulnerability reporting

---

## License

[MIT License](./LICENSE)
