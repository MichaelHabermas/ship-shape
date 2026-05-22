import { useSyncExternalStore } from 'react';
import { NodeViewWrapper, NodeViewProps } from '@tiptap/react';
import { subscribeToArchivedIds, getArchivedIdsSnapshot } from '@/contexts/ArchivedPersonsContext';

interface MentionNodeAttrs {
  id: string;
  label: string;
  mentionType: string;
  documentType: string | null;
}

/**
 * React NodeView component for rendering mentions.
 * Checks if person mentions are for archived users and displays accordingly.
 * Uses useSyncExternalStore to reactively update when archived status changes.
 */
export function MentionNodeView({ node }: NodeViewProps) {
  const { id, label, mentionType, documentType } = node.attrs as MentionNodeAttrs;
  const isPerson = mentionType === 'person';

  // Subscribe to archived IDs changes so we re-render when someone is archived/restored
  const archivedIds = useSyncExternalStore(subscribeToArchivedIds, getArchivedIdsSnapshot);

  // Check if this person is archived
  const isArchived = isPerson && archivedIds.has(id);

  // Build the href - all documents use the unified /documents/:id route
  const href = isPerson
    ? `/team/${id}`
    : `/documents/${id}`;

  // Build CSS classes
  const classes = [
    'mention',
    `mention-${mentionType}`,
    documentType && `mention-${documentType}`,
    isArchived && 'mention-archived',
  ].filter(Boolean).join(' ');

  // Build the display text
  const displayText = isArchived ? `@${label} (archived)` : `@${label}`;

  return (
    <NodeViewWrapper as="span" className="inline">
      <a
        href={href}
        className={classes}
        data-id={id}
        data-label={label}
        data-mention-type={mentionType}
        data-document-type={documentType || undefined}
      >
        {displayText}
      </a>
    </NodeViewWrapper>
  );
}
