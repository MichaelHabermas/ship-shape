# Entity Relationships & Documentation Quality

This document describes the entity relationship improvements and documentation quality features being added to Ship.

## Overview

Ship's entity model follows a hierarchy: **Program → Project → Week → Issue**. This feature set improves visibility into these relationships, adds activity visualization, and enforces documentation quality.

## Entity Hierarchy

```
Program (Vision + Goals)
├── Projects (Hypothesis + Success Criteria)
│   ├── Weeks (Goal + Date Range + Linked Issues)
│   │   ├── Issues (flexible, can be unassigned initially)
│   │   └── Standups (daily updates, reference issues)
│   └── Issues (can belong directly to project)
└── Weeks (can belong directly to program)
```

### Key Decisions

| Entity | Required Fields for "Complete" |
|--------|------------------------------|
| Program | Vision, Goals (informational — not enforced by `checkDocumentCompleteness`) |
| Project | Plan, Success Criteria |
| Week (sprint) | At least 1 linked issue |
| Issue | Nothing required (inbox → triage model) |
| Wiki | Standalone (linked via @mentions, not hierarchy) |

## Features

### 1. Program Projects Tab

Programs now have a **Projects** tab showing all associated projects.

**Views:**
- **List View**: Table with project name, status, key metrics
- **Card View**: Visual cards with mini activity charts

Toggle between views with a button in the tab header.

### 2. Activity Charts

GitHub-style activity visualization showing 30 days of activity.

**Activity Types Tracked:**
- Document edits
- Issue state changes
- Standup posts

**Component:** `ActivityChart` - Reusable across Program, Project, Week views.

**API Endpoint:** `GET /api/activity/:entityType/:entityId`

**Response Format:**
```json
{
  "days": [
    { "date": "2026-01-14", "count": 5 },
    { "date": "2026-01-13", "count": 2 }
  ]
}
```

### 3. Hypothesis & Success Criteria Blocks

Special structured sections in Project and Week documents.

**Slash Commands:**
- `/hypothesis` - Insert Hypothesis section
- `/criteria` - Insert Success Criteria section

**Detection:**
Also detects existing H2 headings named "Hypothesis" or "Success Criteria" (case-insensitive).

**Storage Model:**
Dual storage - content is source of truth, syncs to `properties.hypothesis` and `properties.success_criteria` on save. This enables:
- Fast queries on properties
- Normal rich-text editing experience
- Search/filter by hypothesis content

### 4. Program Vision & Goals

Programs have different structured sections than Projects.

**Slash Commands (Program only):**
- `/vision` - Insert Vision section (strategic direction)
- `/goals` - Insert Goals section (objectives)

**Storage:** Syncs to `properties.vision` and `properties.goals`.

### 5. Incomplete Document Flags

Documents missing critical fields are flagged but not blocked from saving.

**Visual Indicators:**
- **Banner**: Yellow warning at top of document listing missing fields
- **Badge**: Orange indicator in sidebar and document lists

**Completeness Rules** (from `shared/src/content-extract.ts` → `checkDocumentCompleteness`):
```javascript
// Project is complete if:
properties.plan && properties.success_criteria

// Week (sprint) is complete if:
linkedIssuesCount > 0
```

### 6. Standup Auto-Linking

Automatic detection and linking of issue references in standup content.

**Patterns Detected:**
- `#123` → Link to issue with ticket_number 123
- `issue #123` → Same
- `ISS-123` → Same

**Behavior:**
- Detected patterns become clickable links
- Links navigate to `/issues/:id`
- Non-existent issue numbers render as plain text

### 7. UI Polish

**Standup Font Scaling:**
- Headings in standup feed scaled to ~60% of normal size
- Preserves hierarchy (H1 > H2 > H3)
- Body text remains readable

**Badge No-Wrap:**
- All badge/pill elements prevent text wrapping
- Long text shows ellipsis
- Applies to: state badges, tags, priority indicators

## Implementation Notes

### Database Changes

No schema migrations required. All new data stored in existing `properties` JSONB column:
- `properties.hypothesis` - text
- `properties.success_criteria` - text
- `properties.vision` - text
- `properties.goals` - text
- `properties.is_complete` - boolean

### API Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /api/activity/:entityType/:entityId` | Activity data for charts |
| Existing document endpoints | Modified to sync structured sections |

### Components

| Component | Location | Purpose |
|-----------|----------|---------|
| Completeness badges | `web/src/pages/Projects.tsx`, `web/src/components/week/WeekTimeline.tsx` | Orange indicator when `is_complete === false` |
| Slash commands | `web/src/components/editor/SlashCommands.tsx` | `/plan`, `/criteria`, `/vision`, `/goals` |

## Related

- [Unified Document Model](./unified-document-model.md) - Core data model
- [Document Model Conventions](./document-model-conventions.md) - Terminology and patterns
- [Week Documentation Philosophy](./week-documentation-philosophy.md) - Week workflow
