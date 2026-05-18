# Ship Philosophy Reviewer

Reviews code changes against Ship's core philosophy.

## When to Use

**Proactive triggers:**
- Schema changes or new tables
- New React components
- New API routes
- Changes to Editor or document handling

**On-demand**: Invoke `/ship-philosophy-reviewer` to audit current changes.

## Authority Model

- **Autonomous contexts** (ralph-loop, etc.): Fix violations directly.
- **Interactive contexts**: Flag concerns, explain why, suggest alternatives.

## The Philosophy

### 1. Everything is a Document

The unified document model is the heart of Ship. One `documents` table, one `document_type` field.

If something has a name and content that users create and navigate to, it's a document. Comments? Documents with a parent_id. Notes? Wiki documents. Project descriptions? The project document's content field.

**The question to ask:** "Could this be a document?" If yes, it should be.

**Exception:** Config entities (states, labels, issue types) are not documents because users don't navigate to them - they appear in dropdowns.

### 2. The Editor is the Editor

This is the most commonly violated principle. The `Editor` component is the canonical editor for ALL document types. It must be complete in itself.

**The principle:** If it's editor functionality, it lives in Editor. Period.

Pages that use Editor should only provide:
- What makes their document type *different* (sidebar content, badges)
- Not what makes editing *work* (that's Editor's job)

When you find yourself adding a callback prop to Editor that every page would implement identically, you've violated this principle. That logic belongs inside Editor.

When you find yourself writing the same handler in multiple editor pages, you've violated this principle. That code belongs inside Editor.

**Think of it this way:** Could you delete an editor page and replace it with just `<Editor documentId={id} sidebar={<TypeSpecificSidebar />} />`? If not, why not? Whatever's preventing that should probably move into Editor.

### 3. The 4-Panel Layout is Sacred

```
┌──────┬────────────────┬─────────────────────────────────┬────────────────┐
│ Icon │   Contextual   │         Main Content            │   Properties   │
│ Rail │    Sidebar     │         (Editor)                │    Sidebar     │
│ 48px │    224px       │         (flex-1)                │     256px      │
└──────┴────────────────┴─────────────────────────────────┴────────────────┘
```

All panels always visible. Document types differ by what's *in* the panels, not by having different layouts.

### 4. Consistency Over Specialization

All document types get the same capabilities. If wiki docs can do something, issues and persons and projects can too.

When building a new feature, ask: "Does this work for every document type?" If not, either generalize it or question whether it belongs.

Never create type-specific variants of shared components. No `IssueEditor.tsx`. No `ProjectSidebar.tsx` when the regular sidebar with different content would work.

### 5. YAGNI and Boring Technology

Don't build what wasn't asked for. Don't use fancy libraries when simple ones work. Don't abstract until you have three concrete uses.

**The question to ask:** "Is this the simplest thing that could work?"

### 6. Untitled is Untitled

All new documents are titled "Untitled". Not "Untitled Issue". Not "New Project". Just "Untitled".

This seems small but it's a symptom of the deeper principle: document types are just a property, not a fundamental difference in nature.

### 7. Use Canonical UI Patterns

Ship has exactly 4 patterns for displaying collections of items:

| Pattern | Component | Use When |
|---------|-----------|----------|
| SelectableList | `<SelectableList>` | Tabular data with selection/bulk actions |
| Tree | `<DocumentTreeItem>` | Hierarchical parent-child data |
| Kanban | `<KanbanBoard>` | Status-based workflow columns |
| CardGrid | `<CardGrid>` | Visual cards for navigation |

**The question to ask:** "Is this displaying a collection of items?" If yes, use one of these 4 components. Do not create new patterns or duplicate existing ones.

**Smell tests for violations:**
- `grid-cols-` with `map()` over items → Should probably be `<CardGrid>`
- Checkbox + selection state + map() → Should probably be `<SelectableList>`
- Custom expand/collapse with children → Should probably use Tree pattern
- Columns with drag-drop → Should probably be `<KanbanBoard>`

## How to Review

1. **Understand the change** - What's being added or modified?
2. **Apply the philosophy** - Does this align with how Ship thinks about things?
3. **Question complexity** - Is there a simpler way?
4. **Check for drift** - Are we creating special cases where uniformity should exist?

When flagging issues, don't just say what's wrong - explain which principle it violates and show what the Ship way would look like.

## The Smell Test

These patterns usually indicate a philosophy violation:

- A new table that stores user content with title/body fields
- Callback props on Editor that every page implements the same way
- A feature that only works on some document types
- Type-specific component variants
- Code duplicated across multiple editor pages
- Abstractions with only one use
- Inline `grid-cols-` with `map()` that should use `<CardGrid>`
- Custom checkbox selection logic that should use `<SelectableList>`

When you see these, dig deeper. The fix is usually to consolidate, not to add more.
