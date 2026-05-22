import type { KeyboardEvent } from 'react';
import type { DocumentTreeNode } from '@/lib/documentTree';

export function hasActiveDescendant(node: DocumentTreeNode, activeDocumentId?: string): boolean {
  if (!activeDocumentId) return false;
  for (const child of node.children) {
    if (child.id === activeDocumentId || hasActiveDescendant(child, activeDocumentId)) {
      return true;
    }
  }
  return false;
}

export function getVisibleTreeItems(tree: Element): HTMLElement[] {
  return Array.from(tree.querySelectorAll<HTMLElement>('[role="treeitem"]')).filter((item) => {
    return item.offsetParent !== null;
  });
}

export function focusTreeItem(item: HTMLElement | null): void {
  item?.focus();
  item?.scrollIntoView({ block: 'nearest' });
}

export function handleDocumentTreeItemKeyDown(
  event: KeyboardEvent<HTMLDivElement>,
  options: {
    hasChildren: boolean;
    isOpen: boolean;
    setIsOpen: (isOpen: boolean) => void;
  }
): void {
  const tree = event.currentTarget.closest('[role="tree"]');
  if (!tree) return;

  const items = getVisibleTreeItems(tree);
  const currentIndex = items.indexOf(event.currentTarget);
  if (currentIndex === -1) return;

  switch (event.key) {
    case 'ArrowDown':
      event.preventDefault();
      focusTreeItem(items[Math.min(currentIndex + 1, items.length - 1)]);
      break;
    case 'ArrowUp':
      event.preventDefault();
      focusTreeItem(items[Math.max(currentIndex - 1, 0)]);
      break;
    case 'Home':
      event.preventDefault();
      focusTreeItem(items[0]);
      break;
    case 'End':
      event.preventDefault();
      focusTreeItem(items[items.length - 1]);
      break;
    case 'ArrowRight':
      if (!options.hasChildren) return;
      event.preventDefault();
      if (!options.isOpen) {
        options.setIsOpen(true);
      } else {
        focusTreeItem(items[Math.min(currentIndex + 1, items.length - 1)]);
      }
      break;
    case 'ArrowLeft':
      event.preventDefault();
      if (options.hasChildren && options.isOpen) {
        options.setIsOpen(false);
        return;
      }
      focusTreeItem(
        event.currentTarget
          .closest('ul[role="group"]')
          ?.closest('li[data-testid="doc-item"]')
          ?.querySelector<HTMLElement>(':scope > [role="treeitem"]') ?? null
      );
      break;
    case 'Enter':
    case ' ':
      if (event.target !== event.currentTarget) return;
      event.preventDefault();
      event.currentTarget.querySelector<HTMLAnchorElement>('a[href]')?.click();
      break;
  }
}
