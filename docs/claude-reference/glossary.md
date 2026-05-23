# Ship Glossary

Terminology and concepts used throughout the Ship codebase.

## Core Concepts

### Unified Document Model
The architectural pattern where all content types (wikis, issues, projects, weeks, etc.) are stored in a single `documents` table with a `document_type` discriminator. Follows Notion's paradigm where the difference between content types is properties, not structure.

### Document Type
The `document_type` enum that categorizes documents:

<!-- docs:generated start id="document-type-enum" source="shared/src/enums/document-enums.ts" -->
- **wiki**
- **issue**
- **program**
- **project**
- **sprint**
- **person**
- **weekly_plan**
- **weekly_retro**
- **standup**
- **weekly_review**
<!-- docs:generated end id="document-type-enum" -->

Note: `sprint` is the historical database name for week containers. Weekly accountability docs use `weekly_plan`, `weekly_retro`, and `weekly_review` (replacing legacy sprint terminology).

### Properties (JSONB)
Type-specific metadata stored in a JSONB column on documents. Each document type has different properties (e.g., issues have `state`, `priority`, `assignee_id`; weeks have `sprint_number` (historical field name), `plan`).

### 4-Panel Layout
The standard editor layout: Icon Rail (48px) → Contextual Sidebar (224px) → Main Content (flex-1) → Properties Sidebar (256px). All four panels are always visible.

### Workspace
Multi-tenant isolation boundary. All documents belong to a workspace. Users can be members of multiple workspaces.

## Collaboration

### Yjs
A CRDT (Conflict-free Replicated Data Type) library used for real-time collaborative editing. Enables multiple users to edit simultaneously without conflicts.

### Y.Doc
A Yjs document instance. One Y.Doc is created per document being edited. Contains the collaborative state.

### y-websocket
WebSocket provider for Yjs synchronization. Connects client Y.Doc to server.

### y-indexeddb
IndexedDB persistence for Yjs. Caches collaborative state locally for offline support.

### Sync Status
The state of document synchronization: `connecting`, `cached` (loaded from IndexedDB), `synced` (WebSocket connected), `disconnected`.

### Awareness
Yjs feature that tracks user presence (cursor positions, selections). Displayed as colored cursors in the editor.

## Editor

### TipTap
The rich text editor framework built on ProseMirror. Used for all document content editing.

### Extension
A TipTap extension that adds functionality (e.g., `Table`, `TaskList`, `MentionExtension`). Custom extensions are in `web/src/components/editor/`.

### Slash Commands
Editor feature triggered by typing `/`. Opens a menu to insert blocks (headings, lists, images, etc.).

### Mention
Reference to another document or person, created with `@`. Stored as a node in TipTap content.

### Document Embed
An embedded preview of another document within editor content.

## Data Layer

### Pool
The PostgreSQL connection pool (`pg.Pool`). All database queries go through `pool.query()`.

### Row Extractor
A function that converts a raw database row to a typed object. Named `extract{Type}FromRow()`.

### Visibility Filter
SQL fragment that filters documents by visibility rules. Uses `VISIBILITY_FILTER_SQL()` helper.

### Migration
A numbered SQL file in `api/src/db/migrations/` that modifies the database schema. Tracked in `schema_migrations` table.

### Document Associations
Junction table for flexible document relationships. Replaces some fixed foreign key columns.

## API

### authMiddleware
Express middleware that validates session cookies or API tokens. Sets `req.userId`, `req.workspaceId`.

### Zod Schema
Runtime type validation for API inputs. Defined at the top of route files.

### Route Handler
An Express route function that handles HTTP requests. Pattern: validate → query → transform → respond.

### Error Response
Standard JSON format: `{ error: string }` or `{ success: false, error: { code, message, details? } }`.

## Frontend

### TanStack Query
Data fetching library (formerly React Query). Handles caching, background refetching, and optimistic updates.

### Query Key
Array that identifies a query for caching. Factory pattern: `issueKeys.list(filters)`.

### stale-while-revalidate
Caching strategy where stale data is shown immediately while fresh data loads in background.

### Context Provider
React context that provides shared state. Examples: `WorkspaceContext`, `SessionContext`.

### IndexedDB
Browser database used to persist TanStack Query cache and Yjs state for offline support.

## Authentication

### Session
Server-side session stored in database. Cookie contains session ID only.

### Session Timeout
- **Inactivity**: 15 minutes of no activity
- **Absolute**: 12 hours maximum session length

### API Token
Long-lived token for programmatic access. Format: `ship_` + 64 hex characters.

### PIV
Personal Identity Verification. Government smartcard authentication via CAIA OAuth.

### CAIA
Customer Authentication & Identity Architecture. Treasury's OAuth server for PIV authentication.

## Authorization

### Visibility
Document access level: `workspace` (all members) or `private` (creator + admins only).

### Workspace Admin
User with `role = 'admin'` in workspace membership. Can see all documents, manage members.

### Super Admin
System-wide admin (`is_super_admin = true` on user). Can access all workspaces, manage system settings.

## Infrastructure

### Elastic Beanstalk (EB)
AWS service for deploying the API. Manages EC2 instances, load balancer, auto-scaling.

### Aurora Serverless
PostgreSQL-compatible database with automatic scaling. Used for production database.

### CloudFront
AWS CDN for serving static frontend assets from S3.

### SSM Parameter Store
AWS service for storing configuration and secrets. Source of truth for environment variables.

## Development

### Monorepo
Repository structure with multiple packages: `api/`, `web/`, `shared/`.

### pnpm Workspaces
Package manager feature that links packages together for monorepo development.

### Worktree
Git feature for multiple working directories from same repo. Each worktree gets its own database and ports.

### Pre-commit Hook
Script that runs before commit. Checks for secrets, empty tests, etc.

## Testing

### Vitest
Unit test framework. Runs API and web unit tests.

### Playwright
E2E test framework. Runs browser tests against the full application.

### Isolated Environment
E2E test fixture that creates per-worker PostgreSQL containers.

### test.fixme()
Playwright marker for unimplemented tests. Prevents silent passing of empty tests.

## Week Concepts

### Week
Derived 7-day time window computed from workspace start date. Not a container you assign things to -- weeks are inferred time periods. Database document type is `'sprint'` (historical DB name retained for compatibility). Uses `sprint_number` field (historical name) and computed dates.

### Weekly Plan
Document declaring intent for the week -- what you plan to accomplish and why. Plans are the unit of intent. Written before the week starts. Database document type is `'weekly_plan'` (replacing legacy `sprint_plan` naming). Issues are a trailing indicator (what was done); the plan is the leading indicator (what to do).

### Standup
Daily status update document. Tracks what was done, what's planned, blockers.

### Week Review
Document for end-of-week demonstration and stakeholder feedback. Database document type is `'weekly_review'` (replacing legacy `sprint_review` naming).

### Weekly Retro (Retrospective)
Document for team reflection. What went well, what to improve, plan vs. reality. Database document type is `'weekly_retro'` (replacing legacy `sprint_retro` naming).

### ICE Score
Project prioritization metric: Impact x Confidence x Ease. Stored in project properties.

## Document Hierarchy

### Program
Top-level container for related projects. Has `prefix`, `color`, `emoji`.

### Project
Time-bounded deliverable within a program. Contains issues and weeks.

### Issue
Work item with state machine (`triage` → `backlog` → `todo` → `in_progress` → `in_review` → `done`/`cancelled`).

### Ticket Number
Unique identifier for issues: `{prefix}-{number}` (e.g., `SHIP-123`). Auto-generated from program prefix.

### Sub-issue
Issue with `parent_id` pointing to another issue. Creates hierarchical task breakdown.

## Abbreviations

| Abbreviation | Meaning |
|-------------|---------|
| AAL | Authenticator Assurance Level (NIST) |
| ALB | Application Load Balancer |
| CRDT | Conflict-free Replicated Data Type |
| EB | Elastic Beanstalk |
| E2E | End-to-End (testing) |
| FK | Foreign Key |
| IDB | IndexedDB |
| JSONB | JSON Binary (PostgreSQL type) |
| MCP | Model Context Protocol |
| PII | Personally Identifiable Information |
| PIV | Personal Identity Verification |
| PRD | Product Requirements Document |
| SSM | Systems Manager (AWS) |
| UAT | User Acceptance Testing |
| WS | WebSocket |
