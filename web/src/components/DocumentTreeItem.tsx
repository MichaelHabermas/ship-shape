import { useState, type KeyboardEvent } from 'react';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/cn';
import { Tooltip } from '@/components/ui/Tooltip';
import type { DocumentTreeNode } from '@/lib/documentTree';

interface DocumentTreeItemProps {
  document: DocumentTreeNode;
  activeDocumentId?: string;
  depth?: number;
  onCreateChild: (parentId: string) => void;
  onDelete?: (id: string) => void;
}

function DocumentIcon({ className }: { className?: string }) {
  return (
    <svg
      className={cn('h-4 w-4', className)}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
        d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
      />
    </svg>
  );
}

function ChevronIcon({ isOpen, className }: { isOpen: boolean; className?: string }) {
  return (
    <svg
      className={cn(
        'h-4 w-4 transition-transform',
        isOpen && 'rotate-90',
        className
      )}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M9 5l7 7-7 7"
      />
    </svg>
  );
}

function getVisibleTreeItems(tree: Element): HTMLElement[] {
  return Array.from(tree.querySelectorAll<HTMLElement>('[role="treeitem"]')).filter((item) => {
    return item.offsetParent !== null;
  });
}

function focusTreeItem(item: HTMLElement | null) {
  item?.focus();
  item?.scrollIntoView({ block: 'nearest' });
}

function handleDocumentTreeItemKeyDown(
  event: KeyboardEvent<HTMLDivElement>,
  options: {
    hasChildren: boolean;
    isOpen: boolean;
    setIsOpen: (isOpen: boolean) => void;
  }
) {
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

export function DocumentTreeItem({
  document,
  activeDocumentId,
  depth = 0,
  onCreateChild,
  onDelete,
}: DocumentTreeItemProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isHovered, setIsHovered] = useState(false);

  const isActive = activeDocumentId === document.id;
  const hasChildren = document.children.length > 0;

  return (
    <li
      role="none"
      data-testid="doc-item"
    >
      <div
        role="treeitem"
        aria-expanded={hasChildren ? isOpen : undefined}
        aria-selected={isActive}
        tabIndex={0}
        className={cn(
          'group flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm',
          'hover:bg-border/30 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset',
          isActive && 'bg-accent/10 text-accent'
        )}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        onKeyDown={(event) => handleDocumentTreeItemKeyDown(event, { hasChildren, isOpen, setIsOpen })}
      >
        {/* Expand/collapse button - always visible for accessibility */}
        {hasChildren ? (
          <Tooltip content={isOpen ? 'Collapse' : 'Expand'}>
            <button
              type="button"
              className="h-6 w-6 flex-shrink-0 flex items-center justify-center p-0 rounded hover:bg-border/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              onClick={() => setIsOpen(!isOpen)}
              aria-label={isOpen ? 'Collapse' : 'Expand'}
            >
              <ChevronIcon isOpen={isOpen} className="text-muted" />
            </button>
          </Tooltip>
        ) : (
          <div className="h-6 w-6 flex-shrink-0 flex items-center justify-center">
            <DocumentIcon className="text-muted" />
          </div>
        )}

        {/* Main navigation link - uses <a> for accessibility and proper href detection */}
        <Link
          to={`/documents/${document.id}`}
          className="flex-1 truncate text-left cursor-pointer"
          aria-current={isActive ? 'page' : undefined}
        >
          {document.title || 'Untitled'}
        </Link>

        {/* Delete button - visible on hover */}
        {onDelete && (
          <Tooltip content="Delete">
            <button
              type="button"
              className={cn(
                'flex h-6 w-6 flex-shrink-0 items-center justify-center rounded hover:bg-red-100 hover:text-red-600 transition-opacity',
                isHovered ? 'opacity-100' : 'opacity-0 focus:opacity-100 group-focus-within:opacity-100'
              )}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onDelete(document.id);
              }}
              aria-label="Delete document"
              data-testid="delete-document-button"
            >
              <svg
                className="h-3.5 w-3.5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                />
              </svg>
            </button>
          </Tooltip>
        )}

        {/* Add child button - always visible for keyboard users, enhanced on hover */}
        <Tooltip content="Add sub-document">
          <button
            type="button"
            className={cn(
              'flex h-6 w-6 flex-shrink-0 items-center justify-center rounded hover:bg-border/50 transition-opacity',
              isHovered ? 'opacity-100' : 'opacity-50 focus:opacity-100 group-focus-within:opacity-100'
            )}
            onClick={() => onCreateChild(document.id)}
            aria-label="Add sub-document"
          >
            <svg
              className="h-3.5 w-3.5 text-muted"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 4v16m8-8H4"
              />
            </svg>
          </button>
        </Tooltip>
      </div>

      {/* Children (collapsible) */}
      {hasChildren && isOpen && (
        <ul role="group" className="space-y-0.5">
          {document.children.map((child) => (
            <DocumentTreeItem
              key={child.id}
              document={child}
              activeDocumentId={activeDocumentId}
              depth={depth + 1}
              onCreateChild={onCreateChild}
              onDelete={onDelete}
            />
          ))}
        </ul>
      )}
    </li>
  );
}
