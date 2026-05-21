/**
 * Extract document mention target IDs from TipTap JSON content.
 */

interface TipTapLikeNode {
  type?: string;
  attrs?: Record<string, unknown>;
  content?: TipTapLikeNode[];
}

export function extractDocumentMentionIds(content: unknown): string[] {
  if (!content || typeof content !== 'object') return [];
  const mentionIds: string[] = [];

  function traverse(node: TipTapLikeNode) {
    if (
      node.type === 'mention' &&
      node.attrs?.mentionType === 'document' &&
      typeof node.attrs.id === 'string'
    ) {
      mentionIds.push(node.attrs.id);
    }
    if (node.content) {
      for (const child of node.content) {
        traverse(child);
      }
    }
  }

  traverse(content as TipTapLikeNode);
  return [...new Set(mentionIds)];
}
