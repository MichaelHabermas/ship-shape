# Editor Module

TipTap-based rich text editor with Yjs collaborative editing. Every document type in Ship uses the same Editor component.

## Main Components

| File | Purpose |
|------|---------|
| `web/src/components/Editor.tsx` | Core editor with Yjs collaboration |
| `web/src/components/UnifiedEditor.tsx` | Wrapper that adds type-specific sidebars |

## Architecture Overview

```
Editor.tsx
├── useCollabSession() hook (IndexedDB + WebSocket transport)
├── TipTap useEditor() hook
├── Yjs Y.Doc (per documentId)
└── Extensions (see below)
```

**Critical Pattern**: Y.Doc is created in `useMemo` keyed by `documentId`. Collaboration transport lives in `useCollabSession`, keeping TipTap setup separate from WebSocket/IndexedDB lifecycle.

## TipTap Extensions

### Core Extensions (from StarterKit)

StarterKit is configured with `history: false` (Yjs handles undo/redo) and `codeBlock: false` (replaced with CodeBlockLowlight).

Includes: Document, Paragraph, Text, Bold, Italic, Strike, Blockquote, HorizontalRule, Heading, BulletList, OrderedList, ListItem, HardBreak, Gapcursor.

### Formatting & Structure

| Extension | Import | Purpose |
|-----------|--------|---------|
| `CodeBlockLowlight` | `@tiptap/extension-code-block-lowlight` | Syntax highlighting with lowlight |
| `Link` | `@tiptap/extension-link` | Clickable links |
| `Table/TableRow/TableCell/TableHeader` | `@tiptap/extension-table` | Resizable tables |
| `TaskList/TaskItem` | `@tiptap/extension-task-*` | Checkbox lists |
| `Placeholder` | `@tiptap/extension-placeholder` | Placeholder text |
| `Dropcursor` | `@tiptap/extension-dropcursor` | Visual drop indicator |

### Custom Extensions (in `web/src/components/editor/`)

| Extension | File | Trigger | Purpose |
|-----------|------|---------|---------|
| `SlashCommands` | `SlashCommands.tsx` | `/` | Block insertion menu |
| `MentionExtension` | `MentionExtension.ts` | `@` | @mentions for people/docs |
| `EmojiExtension` | `EmojiExtension.ts` | `:` | Emoji shortcodes |
| `DocumentEmbed` | `DocumentEmbed.tsx` | Slash command | Embed linked documents |
| `ImageUploadExtension` | `ImageUpload.tsx` | Paste/drop | Image upload handling |
| `FileAttachmentExtension` | `FileAttachment.tsx` | Slash command | File attachment cards |
| `ResizableImage` | `ResizableImage.tsx` | - | Drag-to-resize images |
| `DetailsExtension` | `DetailsExtension.ts` | Slash command | Collapsible toggle blocks |
| `DragHandleExtension` | `DragHandle.tsx` | Hover | Block drag-and-drop |
| `TableOfContentsExtension` | `TableOfContents.tsx` | Slash command | Auto-generated TOC |

## Yjs Integration

### Client-Side Setup

Collaboration transport is owned by `web/src/hooks/useCollabSession.ts`:

```typescript
// Y.Doc created per documentId (critical for isolation)
const ydoc = useMemo(() => new Y.Doc(), [documentId]);

const { provider, syncStatus, connectedUsers } = useCollabSession({
  documentId,
  documentType,   // preferred — builds room name as {documentType}:{documentId}
  roomPrefix,     // legacy fallback when documentType omitted
  userName,
  userColor: color,
  ydoc,
  onBack,
  onDocumentConverted,
});
```

IndexedDB key: `ship-{documentType}-{documentId}`. WebSocket URL is derived from `VITE_API_URL`.

### Collaboration Extensions

```typescript
Collaboration.configure({ document: ydoc }),
CollaborationCursor.configure({
  provider: provider,
  user: { name: userName, color: color },
}),
```

### Room Naming Convention

Format: `{documentType}:{documentId}` via `buildCollaborationRoomName()`

Examples:
- `wiki:550e8400-e29b-41d4-a716-446655440000`
- `issue:550e8400-e29b-41d4-a716-446655440000`
- `program:550e8400-e29b-41d4-a716-446655440000`

Legacy `doc:` prefix is accepted for wiki documents only.

### Server-Side (API)

File: `api/src/collaboration/index.ts`

- WebSocket server at `/collaboration`
- Rate limiting: 30 connections/minute/IP, 50 messages/second/connection
- Persistence: Debounced save (2s after changes) to `documents.yjs_state`
- Extracts structured data (hypothesis, success criteria, vision, goals) from content on save

### Sync Status States

| Status | Indicator | Meaning |
|--------|-----------|---------|
| `connecting` | Yellow pulse | Initial WebSocket connection |
| `cached` | Blue | Loaded from IndexedDB, WebSocket pending |
| `synced` | Green | WebSocket connected and synced |
| `disconnected` | Red | Offline (falls back to cached if available) |

## Slash Commands

Triggered by typing `/`. Commands registered in `SlashCommands.tsx`:

### Universal Commands

| Command | Aliases | Action |
|---------|---------|--------|
| Sub-document | doc, page, subdoc | Create nested wiki page |
| Heading 1-3 | h1, h2, h3 | Insert heading |
| Bullet List | ul, bullet, list | Toggle bullet list |
| Numbered List | ol, numbered | Toggle ordered list |
| Task List | task, todo, checkbox | Toggle checklist |
| Quote | blockquote, cite | Toggle blockquote |
| Code Block | code, pre, snippet | Toggle code block |
| Divider | hr, separator, line | Insert horizontal rule |
| Image | img, picture, upload | Open file picker |
| File | attachment, pdf | Upload file attachment |
| Toggle | collapsible, details | Create toggle block |
| Table | grid | Insert 3x3 table |
| Table of Contents | toc, outline | Insert auto-updating TOC |
| Plan | plan, hypo, theory | Insert Plan block (syncs to `properties.plan`) |
| Success Criteria | criteria, acceptance | Insert Success Criteria heading |

### Document-Type Specific Commands

| Command | Document Types | Action |
|---------|----------------|--------|
| Vision | program | Insert Vision heading |
| Goals | program | Insert Goals heading |

**Filtering**: Commands with `documentTypes` array only appear when `documentType` prop matches.

## Mentions (@)

Triggered by `@`. Searches `/api/search/mentions` endpoint.

### Mention Types

| Type | Attributes | Navigation |
|------|------------|------------|
| `person` | id, label, mentionType | `/team/{id}` |
| `document` | id, label, mentionType, documentType | `/{documentType}/{id}` |

### Rendering

Uses `MentionNodeView.tsx` for live rendering with archived status support. Falls back to `<a>` tag for SSR.

## Emoji (:)

Triggered by `:`. Supports:
- Suggestion menu: `:rock` shows matching emojis
- Auto-complete: `:rocket:` auto-converts to emoji

Curated list of ~50 common emojis defined in `EmojiExtension.ts`.

## File Uploads

### Image Upload Flow

1. User pastes/drops image or uses `/image` command
2. `ImageUploadExtension` creates data URL for instant preview
3. `uploadFile()` service gets presigned URL from `/api/files/upload`
4. File uploaded to S3 (or local in dev)
5. Image src updated to CDN URL

### File Attachment Flow

1. User uses `/file` command
2. `FileAttachmentExtension` inserts placeholder node with `uploading: true`
3. Same upload flow as images
4. Node updated with CDN URL and `uploading: false`

### Upload Service

File: `web/src/services/upload.ts`

```typescript
interface UploadResult {
  fileId: string;
  cdnUrl: string;
}

// Handles presigned URL flow and progress callbacks
uploadFile(file: File, onProgress?: ProgressCallback): Promise<UploadResult>
```

### Blocked File Types

Executables and scripts are blocked (security):
`.exe`, `.bat`, `.sh`, `.dll`, `.js`, `.ps1`, etc.

## Key Props

### Editor Component

```typescript
interface EditorProps {
  documentId: string;
  userName: string;
  userColor?: string;
  initialTitle?: string;
  titleReadOnly?: boolean;
  onTitleChange?: (title: string) => void;
  onBack?: () => void;
  backLabel?: string;
  roomPrefix?: string;          // Legacy fallback for room naming
  placeholder?: string;
  headerBadge?: React.ReactNode;
  breadcrumbs?: React.ReactNode;
  sidebar?: React.ReactNode;
  onCreateSubDocument?: () => Promise<{ id: string; title: string } | null>;
  onNavigateToDocument?: (path: string) => void;
  onDelete?: () => void;
  secondaryHeader?: React.ReactNode;
  documentType?: string;        // Preferred for room naming and slash command filtering
  onDocumentConverted?: (newDocId: string, newDocType: 'issue' | 'project') => void;
  onPlanChange?: (plan: string) => void;
  contentBanner?: React.ReactNode;
  onContentChange?: (content: Record<string, unknown>) => void;
  aiScoringAnalysis?: { planAnalysis?: unknown; retroAnalysis?: unknown } | null;
  titleSuffix?: string;
}
```

### UnifiedEditor Component

Wrapper that adds document-type-specific sidebars:

```typescript
interface UnifiedEditorProps {
  document: UnifiedDocument;    // Full document object
  sidebarData?: SidebarData;    // Type-specific sidebar data
  onUpdate: (updates) => Promise<void>;
  showTypeSelector?: boolean;   // Show document type dropdown
  onTypeChange?: (newType) => Promise<void>;
  // ... plus most Editor props
}
```

## Document Links (Backlinks)

The editor automatically syncs document mentions to enable backlinks:

1. On content change, `extractDocumentMentionIds()` scans for `mention` nodes with `mentionType: 'document'`
2. Debounced POST to `/api/documents/{id}/links` with `target_ids`
3. Server updates `document_links` table for bidirectional linking

## Special Close Codes

WebSocket close codes for special conditions:

| Code | Meaning | Action |
|------|---------|--------|
| 4403 | Access revoked | Shows alert, navigates back |
| 4100 | Document converted | Calls `onDocumentConverted` with new doc info |
| 4101 | Content updated via API | Clears IndexedDB cache, reconnects |

## CSS Classes

Key classes for styling:

| Class | Element |
|-------|---------|
| `.tiptap-wrapper` | Editor container |
| `.editor-drag-handle` | Block drag handle |
| `.mention` | @mention spans |
| `.mention-person`, `.mention-document` | Mention type variants |
| `.file-attachment` | File attachment cards |
| `.details-block` | Toggle/details blocks |
| `.toc-container` | Table of contents |
| `.code-block-lowlight` | Code blocks with highlighting |
| `.task-list`, `.task-item` | Checkbox lists |
| `.tiptap-table` | Table elements |
