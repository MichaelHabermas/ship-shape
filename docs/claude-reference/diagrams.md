# Ship Architecture Diagrams

Visual representations of Ship's architecture using Mermaid diagrams.

## System Overview

```mermaid
graph TB
    subgraph "Client (Browser)"
        Web[React + Vite]
        TipTap[TipTap Editor]
        Yjs[Y.Doc + IndexedDB]
        TanStack[TanStack Query]
    end

    subgraph "Server"
        API[Express API]
        Collab[Collaboration Server]
        Auth[Auth Middleware]
    end

    subgraph "Data"
        PG[(PostgreSQL)]
        S3[(S3 + CloudFront)]
    end

    Web --> API
    TipTap --> Yjs
    Yjs <-->|WebSocket| Collab
    TanStack --> API
    API --> Auth
    Auth --> PG
    Collab --> PG
    Web --> S3
```

## 4-Panel Editor Layout

```
┌────────────────────────────────────────────────────────────────────┐
│ Header Bar                                                         │
├────────┬──────────────┬─────────────────────────┬──────────────────┤
│        │              │                         │                  │
│  Icon  │  Contextual  │     Main Content        │    Properties    │
│  Rail  │   Sidebar    │      (Editor)           │     Sidebar      │
│        │              │                         │                  │
│  48px  │    224px     │       flex-1            │      256px       │
│        │              │                         │                  │
│ - Wiki │ - Doc tree   │ - TipTap editor         │ - Title          │
│ - Issue│ - Issue list │ - Slash commands        │ - Status         │
│ - Prj  │ - Filters    │ - Mentions              │ - Priority       │
│ - Team │              │ - Collaboration         │ - Assignee       │
│        │              │                         │ - Week           │
└────────┴──────────────┴─────────────────────────┴──────────────────┘
```

## Data Flow: HTTP Request

```mermaid
sequenceDiagram
    participant C as Client
    participant M as authMiddleware
    participant R as Route Handler
    participant DB as PostgreSQL

    C->>M: HTTP Request + Cookie
    M->>DB: Validate Session
    DB-->>M: Session + User
    M->>R: req.userId, req.workspaceId
    R->>DB: Query with visibility filter
    DB-->>R: Results
    R-->>C: JSON Response
```

## Data Flow: Real-time Collaboration

```mermaid
sequenceDiagram
    participant C1 as Client 1
    participant C2 as Client 2
    participant WS as WebSocket Server
    participant DB as PostgreSQL

    C1->>WS: Connect /collaboration/wiki:uuid
    WS->>DB: Validate Session
    WS->>DB: Load yjs_state
    WS-->>C1: Sync Step 1

    C2->>WS: Connect /collaboration/wiki:uuid
    WS-->>C2: Sync Step 1

    C1->>WS: Edit (Yjs update)
    WS->>C2: Broadcast update
    WS->>DB: Persist (debounced 2s)
```

## Unified Document Model

```mermaid
erDiagram
    documents {
        uuid id PK
        document_type type
        string title
        jsonb content
        bytea yjs_state
        jsonb properties
        uuid workspace_id FK
        uuid parent_id FK
        string visibility
    }

    workspaces ||--o{ documents : contains
    documents ||--o{ documents : parent_of
    documents ||--o{ document_associations : has

    document_associations {
        uuid id PK
        uuid document_id FK
        uuid related_id FK
        relationship_type relationship_type
    }
```

## Document Types

```mermaid
graph LR
    subgraph "Content Types"
        Wiki[Wiki]
        Issue[Issue]
        Standup[Standup]
    end

    subgraph "Container Types"
        Program[Program]
        Project[Project]
        Week[Week]
    end

    subgraph "People Types"
        Person[Person]
    end

    Program --> Project
    Project --> Week
    Project --> Issue
    Week --> Issue
    Week --> Standup
```

## Authentication Flow

```mermaid
stateDiagram-v2
    [*] --> Unauthenticated

    Unauthenticated --> PasswordLogin: Email + Password
    Unauthenticated --> PIVLogin: PIV Card (CAIA)

    PasswordLogin --> SessionCreated: Valid credentials
    PIVLogin --> CAIARedirect: OAuth start
    CAIARedirect --> SessionCreated: Token exchange

    SessionCreated --> Active: Session cookie set
    Active --> Active: Activity (resets inactivity timer)
    Active --> Expired: 15min inactivity OR 12hr absolute
    Expired --> Unauthenticated: Cookie cleared

    Active --> [*]: Logout
```

## WebSocket Connection States

```mermaid
stateDiagram-v2
    [*] --> Connecting

    Connecting --> Authenticated: Valid session
    Connecting --> Rejected: Invalid session (401)
    Connecting --> Denied: No access (403)
    Connecting --> RateLimited: Too many connections (429)

    Authenticated --> Synced: Yjs sync complete
    Synced --> Synced: Messages exchanged
    Synced --> AccessRevoked: Visibility changed (4403)
    Synced --> Converted: Document converted (4100)
    Synced --> Disconnected: Network failure

    Disconnected --> Connecting: Auto-reconnect
    AccessRevoked --> [*]: Redirect to list
    Converted --> [*]: Redirect to new doc

    Rejected --> [*]
    Denied --> [*]
    RateLimited --> [*]
```

## Deployment Architecture

```mermaid
graph TB
    subgraph "Edge"
        CF[CloudFront CDN]
        ALB[Application Load Balancer]
    end

    subgraph "Compute"
        EB1[EB Instance 1]
        EB2[EB Instance 2]
    end

    subgraph "Data"
        Aurora[(Aurora Serverless v2)]
        S3[(S3 Bucket)]
    end

    subgraph "Config"
        SSM[SSM Parameter Store]
    end

    CF -->|Static Assets| S3
    CF -->|API + WS| ALB
    ALB --> EB1
    ALB --> EB2
    EB1 --> Aurora
    EB2 --> Aurora
    EB1 --> SSM
    EB2 --> SSM
```

## Caching Strategy

```mermaid
graph LR
    subgraph "Client-Side"
        IDB[(IndexedDB)]
        TQ[TanStack Query Cache]
        YDB[(y-indexeddb)]
    end

    subgraph "Server"
        API[API Server]
        WS[WebSocket]
    end

    subgraph "Database"
        PG[(PostgreSQL)]
    end

    TQ -->|stale-while-revalidate| API
    API --> PG
    YDB <-->|Yjs sync| WS
    WS --> PG

    IDB -.->|Hydrate| TQ
    TQ -.->|Persist| IDB
```

## Week Timeline

```mermaid
gantt
    title Week Lifecycle
    dateFormat  YYYY-MM-DD
    section Planning
    Week Planning      :a1, 2024-01-08, 1d
    section Active
    Development        :a2, after a1, 5d
    Daily Standups     :a3, after a1, 5d
    section Review
    Week Review        :a4, after a2, 1d
    Retrospective      :a5, after a4, 1d
```

## Issue State Machine

```mermaid
stateDiagram-v2
    [*] --> Triage: Created

    Triage --> Backlog: Accepted
    Triage --> Cancelled: Rejected

    Backlog --> Todo: Prioritized
    Backlog --> Cancelled: Rejected

    Todo --> InProgress: Started
    Todo --> Backlog: Deprioritized
    Todo --> Cancelled: Rejected

    InProgress --> InReview: Ready for review
    InProgress --> Todo: Blocked
    InProgress --> Cancelled: Abandoned

    InReview --> Done: Approved
    InReview --> InProgress: Changes requested
    InReview --> Cancelled: Rejected

    Done --> Backlog: Reopened
    Cancelled --> Backlog: Reopened

    Done --> [*]
    Cancelled --> [*]
```

## Module Dependencies

```mermaid
graph TD
    subgraph "Packages"
        Shared[shared/]
        API[api/]
        Web[web/]
    end

    Web --> Shared
    API --> Shared

    subgraph "API Modules"
        Routes[routes/]
        Middleware[middleware/]
        Collaboration[collaboration/]
        DB[db/]
    end

    Routes --> Middleware
    Routes --> DB
    Collaboration --> DB
    Collaboration --> Middleware

    subgraph "Web Modules"
        Pages[pages/]
        Components[components/]
        Hooks[hooks/]
        Contexts[contexts/]
    end

    Pages --> Components
    Pages --> Hooks
    Components --> Hooks
    Hooks --> Contexts
```
