import { useState, useEffect, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/cn';
import { Tooltip } from '@/components/ui/Tooltip';
import type { DocumentTreeNode } from '@/lib/documentTree';
import { handleDocumentTreeItemKeyDown, hasActiveDescendant } from '@/lib/documentTreeKeyboard';

type SharedProps = {
  document: DocumentTreeNode;
  activeDocumentId?: string;
  depth?: number;
  autoExpandActive?: boolean;
  showVisibilityBadge?: boolean;
};

type InlineDocumentTreeItemProps = SharedProps & {
  variant?: 'inline';
  onCreateChild: (parentId: string) => void;
  onDelete?: (id: string) => void;
};

type SidebarDocumentTreeItemProps = SharedProps & {
  variant: 'sidebar';
  onContextMenu: (event: React.MouseEvent<HTMLDivElement>) => void;
  menuButton: ReactNode;
  renderChild: (child: DocumentTreeNode) => ReactNode;
};

export type DocumentTreeItemProps = InlineDocumentTreeItemProps | SidebarDocumentTreeItemProps;

function DocumentIcon({ className }: { className?: string }) {
  return (
    <svg className={cn('h-4 w-4', className)} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
    </svg>
  );
}

function ChevronIcon({ isOpen, className }: { isOpen: boolean; className?: string }) {
  return (
    <svg className={cn('h-4 w-4 transition-transform', isOpen && 'rotate-90', className)} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
    </svg>
  );
}

function LockIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
    </svg>
  );
}

export function DocumentTreeItem(props: DocumentTreeItemProps) {
  const {
    document,
    activeDocumentId,
    depth = 0,
    autoExpandActive = false,
    showVisibilityBadge = false,
  } = props;

  const shouldAutoExpand = autoExpandActive && hasActiveDescendant(document, activeDocumentId);
  const [isOpen, setIsOpen] = useState(shouldAutoExpand);
  const [isHovered, setIsHovered] = useState(false);

  useEffect(() => {
    if (shouldAutoExpand && !isOpen) {
      setIsOpen(true);
    }
  }, [shouldAutoExpand, isOpen]);

  const isActive = activeDocumentId === document.id;
  const hasChildren = document.children.length > 0;
  const isSidebar = props.variant === 'sidebar';

  return (
    <li role="none" data-testid="doc-item">
      <div
        role="treeitem"
        aria-expanded={hasChildren ? isOpen : undefined}
        aria-selected={isActive}
        tabIndex={0}
        className={cn(
          'group flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm transition-colors',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset',
          isSidebar
            ? cn(
              'w-full text-left',
              isActive ? 'bg-border/50 text-foreground' : 'text-muted hover:bg-border/30 hover:text-foreground',
              'focus:bg-border/30 focus:text-foreground focus-within:bg-border/30 focus-within:text-foreground'
            )
            : cn('hover:bg-border/30', isActive && 'bg-accent/10 text-accent')
        )}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        onContextMenu={isSidebar ? props.onContextMenu : undefined}
        onKeyDown={(event) => handleDocumentTreeItemKeyDown(event, { hasChildren, isOpen, setIsOpen })}
      >
        {hasChildren ? (
          isSidebar ? (
            <button
              type="button"
              className="h-6 w-6 flex-shrink-0 flex items-center justify-center p-0 rounded hover:bg-border/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              onClick={() => setIsOpen(!isOpen)}
              aria-label={isOpen ? 'Collapse' : 'Expand'}
            >
              <ChevronIcon isOpen={isOpen} className="text-muted" />
            </button>
          ) : (
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
          )
        ) : (
          <div className="h-6 w-6 flex-shrink-0 flex items-center justify-center">
            <DocumentIcon className="text-muted" />
          </div>
        )}

        <Link
          to={`/documents/${document.id}`}
          className={cn(
            'flex min-h-6 min-w-0 flex-1 items-center truncate text-left cursor-pointer',
            isSidebar && 'gap-1'
          )}
          aria-current={isActive ? 'page' : undefined}
        >
          <span className="truncate">{document.title || 'Untitled'}</span>
          {showVisibilityBadge && document.visibility === 'private' && (
            <LockIcon className="h-3 w-3 flex-shrink-0 text-muted" />
          )}
        </Link>

        {!isSidebar && props.onDelete && (
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
                props.onDelete?.(document.id);
              }}
              aria-label="Delete document"
              data-testid="delete-document-button"
            >
              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          </Tooltip>
        )}

        {!isSidebar && (
          <Tooltip content="Add sub-document">
            <button
              type="button"
              className={cn(
                'flex h-6 w-6 flex-shrink-0 items-center justify-center rounded hover:bg-border/50 transition-opacity',
                isHovered ? 'opacity-100' : 'opacity-50 focus:opacity-100 group-focus-within:opacity-100'
              )}
              onClick={() => props.onCreateChild(document.id)}
              aria-label="Add sub-document"
            >
              <svg className="h-3.5 w-3.5 text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
            </button>
          </Tooltip>
        )}

        {isSidebar && props.menuButton}
      </div>

      {hasChildren && isOpen && (
        <ul role="group" className="space-y-0.5">
          {document.children.map((child) => (
            isSidebar
              ? props.renderChild(child)
              : (
                <DocumentTreeItem
                  key={child.id}
                  document={child}
                  activeDocumentId={activeDocumentId}
                  depth={depth + 1}
                  autoExpandActive={autoExpandActive}
                  onCreateChild={props.onCreateChild}
                  onDelete={props.onDelete}
                />
              )
          ))}
        </ul>
      )}
    </li>
  );
}
