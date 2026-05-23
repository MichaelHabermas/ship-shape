---
title: Shared Collaborative Editor Component Pattern
category: patterns
tags: [react, tiptap, yjs, collaboration, component-reuse]
created: 2024-12-30
problem_type: code_duplication
root_cause: separate_implementations
---

# Shared Collaborative Editor Component Pattern

## Problem

When building multiple document types (documents, issues, notes) that all need collaborative editing, it's tempting to duplicate the TipTap + Yjs setup in each editor component. This leads to:

- ~150+ lines of duplicate WebSocket/Yjs setup per editor
- Inconsistent behavior when one editor is updated but not others
- Harder maintenance when collaboration logic needs changes

**Symptom:** UI changes (like adding a large title) only affect one document type.

## Root Cause

Each document type had its own:
- Yjs document instantiation
- WebSocket provider setup
- Awareness/presence tracking
- TipTap extension configuration
- Editor UI layout

## Solution

Create a single `Editor` component with props for customization:

```typescript
interface EditorProps {
  documentId: string;
  userName: string;
  onTitleChange?: (title: string) => void;
  initialTitle?: string;
  onBack?: () => void;

  // Customization props
  roomPrefix?: string;      // 'doc' | 'issue' - for collaboration room name
  placeholder?: string;     // Editor placeholder text
  headerBadge?: ReactNode;  // Optional badge in header (e.g., issue number)
  sidebar?: ReactNode;      // Optional sidebar content (e.g., issue properties)
}
```

### Key Implementation Details

**1. Room prefix for collaboration isolation:**
```typescript
const wsProvider = new WebsocketProvider(
  wsUrl,
  `${documentType}:${documentId}`,  // e.g., "wiki:abc123" or "issue:xyz789"
  ydoc
);
```

**2. Conditional sidebar rendering:**
```typescript
<div className="flex flex-1 overflow-hidden">
  <div className="flex-1 overflow-auto p-8">
    {/* Editor content */}
  </div>
  {sidebar}  {/* Only renders if provided */}
</div>
```

**3. Header badge slot:**
```typescript
{headerBadge}  {/* e.g., <span>#{issue.ticket_number}</span> */}
<span className="flex-1 truncate">{title}</span>
```

### Usage Examples

**Document Editor (via UnifiedDocumentPage):**
```typescript
// web/src/pages/UnifiedDocumentPage.tsx — /documents/:id
<UnifiedEditor
  document={document}
  sidebarData={sidebarData}
  onUpdate={handleUpdate}
/>
```

**Issue Editor (same route, type-specific sidebar):**
```typescript
// Also rendered by UnifiedDocumentPage when document_type === 'issue'
<UnifiedEditor
  document={issue}
  sidebarData={{ /* issue properties */ }}
  onUpdate={handleUpdate}
/>
```

## Results

- **Before:** IssueEditor.tsx was ~360 lines with duplicate TipTap/Yjs code
- **After:** IssueEditor.tsx is ~196 lines, using shared Editor component
- **Benefit:** Any Editor changes (large title, sync status, presence) apply to all document types

## Prevention

When adding a new document type that needs collaborative editing:
1. Use the shared `Editor` component
2. Add new props if customization is needed
3. Never duplicate the TipTap/Yjs setup

## Related Files

- `web/src/components/Editor.tsx` - Shared editor component
- `web/src/components/UnifiedEditor.tsx` - Type-specific wrapper with sidebars
- `web/src/pages/UnifiedDocumentPage.tsx` - Unified `/documents/:id` route
