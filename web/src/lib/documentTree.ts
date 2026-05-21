import type { WikiDocument } from '@/contexts/DocumentsContext';

export interface DocumentTreeNode extends WikiDocument {
  children: DocumentTreeNode[];
}

/**
 * Build a tree structure from flat documents list.
 * Documents with parent_id become children of their parent.
 * Returns only root-level documents (parent_id is null).
 */
export function buildDocumentTree(documents: WikiDocument[]): DocumentTreeNode[] {
  const nodeMap = new Map<string, DocumentTreeNode>();
  const rootNodes: DocumentTreeNode[] = [];

  // Create tree nodes for all documents
  for (const doc of documents) {
    nodeMap.set(doc.id, { ...doc, children: [] });
  }

  // Build parent-child relationships
  for (const doc of documents) {
    const node = nodeMap.get(doc.id);
    if (!node) continue;
    const parent = doc.parent_id ? nodeMap.get(doc.parent_id) : undefined;
    if (parent) {
      parent.children.push(node);
    } else {
      rootNodes.push(node);
    }
  }

  // Sort by position, then by created_at descending
  const sortNodes = (a: DocumentTreeNode, b: DocumentTreeNode) => {
    if (a.position !== b.position) return a.position - b.position;
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  };

  rootNodes.sort(sortNodes);
  nodeMap.forEach(node => node.children.sort(sortNodes));

  return rootNodes;
}

/**
 * Get all ancestor IDs for a document (for breadcrumbs, etc.)
 */
export function getAncestorIds(documents: WikiDocument[], documentId: string): string[] {
  const ancestors: string[] = [];
  const docMap = new Map(documents.map(d => [d.id, d]));

  let current = docMap.get(documentId);
  while (current?.parent_id) {
    ancestors.unshift(current.parent_id);
    current = docMap.get(current.parent_id);
  }

  return ancestors;
}
