export interface PersonData {
  id: string;
  user_id: string | null;
  name: string;
  email: string;
  role?: string | null;
  reportsTo?: string | null;
  isArchived?: boolean;
  isPending?: boolean;
}

export interface OrgTreeNode {
  personId: string;
  userId: string | null;
  name: string;
  email: string;
  role: string | null;
  children: OrgTreeNode[];
}

export interface FlatRow {
  node: OrgTreeNode;
  depth: number;
  isExpanded: boolean;
  hasChildren: boolean;
}

export function buildTree(people: PersonData[]): OrgTreeNode[] {
  const byUserId = new Map<string, PersonData>();
  for (const p of people) {
    if (p.user_id) byUserId.set(p.user_id, p);
  }

  const nodeMap = new Map<string, OrgTreeNode>();
  for (const p of people) {
    nodeMap.set(p.id, {
      personId: p.id,
      userId: p.user_id,
      name: p.name,
      email: p.email,
      role: p.role || null,
      children: [],
    });
  }

  const roots: OrgTreeNode[] = [];

  for (const p of people) {
    const node = nodeMap.get(p.id);
    if (!node) continue;
    if (p.reportsTo) {
      const parent = byUserId.get(p.reportsTo);
      if (parent) {
        const parentNode = nodeMap.get(parent.id);
        if (parentNode) {
          parentNode.children.push(node);
          continue;
        }
      }
    }
    roots.push(node);
  }

  function sortChildren(nodes: OrgTreeNode[]) {
    nodes.sort((a, b) => a.name.localeCompare(b.name));
    for (const n of nodes) sortChildren(n.children);
  }
  sortChildren(roots);

  return roots;
}

export function flattenTree(nodes: OrgTreeNode[], expandedIds: Set<string>, depth = 0): FlatRow[] {
  const rows: FlatRow[] = [];
  for (const node of nodes) {
    const isExpanded = expandedIds.has(node.personId);
    const hasChildren = node.children.length > 0;
    rows.push({ node, depth, isExpanded, hasChildren });
    if (isExpanded && hasChildren) {
      rows.push(...flattenTree(node.children, expandedIds, depth + 1));
    }
  }
  return rows;
}

export function getInitials(name: string): string {
  return name.split(' ').map(p => p[0]).join('').toUpperCase().slice(0, 2);
}

export function collectAncestorIds(people: PersonData[], matchIds: Set<string>): Set<string> {
  const byUserId = new Map<string, PersonData>();
  for (const p of people) {
    if (p.user_id) byUserId.set(p.user_id, p);
  }

  const ancestorIds = new Set<string>();
  for (const p of people) {
    if (!matchIds.has(p.id)) continue;
    let current = p;
    while (current.reportsTo) {
      const parent = byUserId.get(current.reportsTo);
      if (!parent || ancestorIds.has(parent.id)) break;
      ancestorIds.add(parent.id);
      current = parent;
    }
  }
  return ancestorIds;
}

/** Collect all descendant personIds from a tree node */
export function getDescendantIds(node: OrgTreeNode): Set<string> {
  const ids = new Set<string>();
  function walk(n: OrgTreeNode) {
    for (const child of n.children) {
      ids.add(child.personId);
      walk(child);
    }
  }
  walk(node);
  return ids;
}

/** Find a node by personId in the tree */
export function findNode(nodes: OrgTreeNode[], personId: string): OrgTreeNode | null {
  for (const node of nodes) {
    if (node.personId === personId) return node;
    const found = findNode(node.children, personId);
    if (found) return found;
  }
  return null;
}
