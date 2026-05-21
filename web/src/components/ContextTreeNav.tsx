import { Link } from 'react-router-dom';
import { useDocumentContextQuery, BreadcrumbItem } from '@/hooks/useDocumentContextQuery';
import { cn } from '@/lib/cn';

interface ContextTreeNavProps {
  documentId: string;
  documentType: 'issue' | 'wiki' | 'project' | 'sprint';
}

// Get the URL path for a document based on its type
function getDocumentPath(type: string, id: string): string {
  switch (type) {
    case 'issue':
      return `/issues/${id}`;
    case 'project':
      return `/projects/${id}`;
    case 'sprint':
      return `/sprints/${id}`;
    case 'program':
      return `/programs/${id}`;
    case 'wiki':
    default:
      return `/docs/${id}`;
  }
}

// Get icon for document type
function DocumentTypeIcon({ type, className }: { type: string; className?: string }) {
  switch (type) {
    case 'program':
      return (
        <svg className={cn('h-3.5 w-3.5', className)} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
        </svg>
      );
    case 'project':
      return (
        <svg className={cn('h-3.5 w-3.5', className)} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2" />
        </svg>
      );
    case 'sprint':
      return (
        <svg className={cn('h-3.5 w-3.5', className)} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
        </svg>
      );
    case 'issue':
      return (
        <svg className={cn('h-3.5 w-3.5', className)} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
        </svg>
      );
    default:
      return (
        <svg className={cn('h-3.5 w-3.5', className)} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
        </svg>
      );
  }
}

// Chevron icon for expandable items
function ChevronIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg
      className={cn('h-3.5 w-3.5 text-muted transition-transform', expanded && 'rotate-90')}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
    </svg>
  );
}

export function ContextTreeNav({ documentId, documentType: _documentType }: ContextTreeNavProps) {
  const { data: context, isLoading, error } = useDocumentContextQuery(documentId);

  if (isLoading) {
    return (
      <div className="px-3 py-2 text-sm text-muted">
        Loading context...
      </div>
    );
  }

  if (error || !context) {
    return null; // Fallback to regular list
  }

  const hasContext = context.ancestors.length > 0 || context.children.length > 0 || context.belongs_to.length > 0;

  if (!hasContext) {
    return null; // No context to show
  }

  return (
    <div className="space-y-1" data-testid="context-tree-nav">
      {/* Context header */}
      <div className="flex items-center gap-1.5 px-3 py-1 text-xs font-medium text-muted uppercase tracking-wider">
        <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 6h16M4 12h16M4 18h7" />
        </svg>
        Context
      </div>

      <ul className="space-y-0.5 px-2" role="tree" aria-label="Document context">
        {/* Ancestors (from root to immediate parent) */}
        {context.ancestors.map((ancestor, index) => (
          <li key={ancestor.id} role="treeitem">
            <Link
              to={getDocumentPath(ancestor.document_type, ancestor.id)}
              className={cn(
                'flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm transition-colors',
                'text-muted hover:bg-border/30 hover:text-foreground'
              )}
              style={{ paddingLeft: `${index * 8 + 8}px` }}
            >
              <DocumentTypeIcon type={ancestor.document_type} className="flex-shrink-0 text-muted" />
              <span className="truncate">
                {ancestor.ticket_number ? `#${ancestor.ticket_number} ` : ''}
                {ancestor.title || 'Untitled'}
              </span>
            </Link>
          </li>
        ))}

        {/* Current document (highlighted) */}
        <li role="treeitem" aria-current="page">
          <div
            className={cn(
              'flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm',
              'bg-border/50 text-foreground font-medium'
            )}
            style={{ paddingLeft: `${context.ancestors.length * 8 + 8}px` }}
          >
            <DocumentTypeIcon type={context.current.document_type} className="flex-shrink-0" />
            <span className="truncate">
              {context.current.ticket_number ? `#${context.current.ticket_number} ` : ''}
              {context.current.title || 'Untitled'}
            </span>
            {context.children.length > 0 && (
              <span className="ml-auto text-xs text-muted">
                {context.children.length}
              </span>
            )}
          </div>
        </li>

        {/* Children */}
        {context.children.map((child) => (
          <li key={child.id} role="treeitem">
            <Link
              to={getDocumentPath(child.document_type, child.id)}
              className={cn(
                'flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm transition-colors',
                'text-muted hover:bg-border/30 hover:text-foreground'
              )}
              style={{ paddingLeft: `${(context.ancestors.length + 1) * 8 + 8}px` }}
            >
              {child.child_count > 0 ? (
                <ChevronIcon expanded={false} />
              ) : (
                <DocumentTypeIcon type={child.document_type} className="flex-shrink-0 text-muted" />
              )}
              <span className="truncate">
                {child.ticket_number ? `#${child.ticket_number} ` : ''}
                {child.title || 'Untitled'}
              </span>
              {child.child_count > 0 && (
                <span className="ml-auto text-xs text-muted">
                  {child.child_count}
                </span>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

// Breadcrumbs component for showing full path
export function DocumentBreadcrumbs({ items }: { items: BreadcrumbItem[] }) {
  if (items.length <= 1) {
    return null; // Don't show if only current document
  }

  return (
    <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-xs text-muted overflow-hidden">
      {items.map((item, index) => {
        const isLast = index === items.length - 1;
        const displayTitle = item.ticket_number
          ? `#${item.ticket_number}`
          : item.title.length > 15
            ? item.title.substring(0, 15) + '...'
            : item.title;

        return (
          <span key={item.id} className="flex items-center gap-1 min-w-0">
            {index > 0 && (
              <svg className="h-3 w-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            )}
            {isLast ? (
              <span className="truncate font-medium text-foreground" title={item.title}>
                {displayTitle}
              </span>
            ) : (
              <Link
                to={getDocumentPath(item.type, item.id)}
                className="truncate hover:text-foreground transition-colors"
                title={item.title}
              >
                {displayTitle}
              </Link>
            )}
          </span>
        );
      })}
    </nav>
  );
}
