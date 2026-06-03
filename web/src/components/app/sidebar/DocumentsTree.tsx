import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import type { WikiDocument } from '@/contexts/DocumentsContext';
import { buildDocumentTree } from '@/lib/documentTree';
import { SidebarDocumentTreeItem } from '@/components/app/SidebarDocumentTreeItem';
import { GlobeIcon, LockIcon } from './sidebar-icons.js';

export const SIDEBAR_ITEM_LIMIT = 10;

export function DocumentsTree({ documents, activeId }: { documents: WikiDocument[]; activeId?: string }) {
  // Split documents by visibility and build separate trees
  const { privateTree, workspaceTree } = useMemo(() => {
    // Group documents by visibility (root documents determine the section)
    const privateDocs = documents.filter(d => d.visibility === 'private');
    const workspaceDocs = documents.filter(d => d.visibility !== 'private');
    return {
      privateTree: buildDocumentTree(privateDocs),
      workspaceTree: buildDocumentTree(workspaceDocs),
    };
  }, [documents]);

  if (documents.length === 0) {
    return <div className="px-3 py-2 text-sm text-muted">No documents yet</div>;
  }

  // Limit items shown
  const workspaceToShow = workspaceTree.slice(0, SIDEBAR_ITEM_LIMIT);
  const workspaceHiddenCount = workspaceTree.length - SIDEBAR_ITEM_LIMIT;

  const privateToShow = privateTree.slice(0, SIDEBAR_ITEM_LIMIT);
  const privateHiddenCount = privateTree.length - SIDEBAR_ITEM_LIMIT;

  return (
    <div className="space-y-2" data-testid="document-list">
      {/* Workspace section */}
      <div>
        <div className="flex items-center gap-1.5 px-3 py-1 text-xs font-medium text-muted uppercase tracking-wider">
          <GlobeIcon className="h-3 w-3" />
          Workspace
        </div>
        <ul role="tree" aria-label="Workspace documents" aria-live="polite" className="space-y-0.5 px-2">
          {workspaceToShow.length > 0 ? (
            workspaceToShow.map((doc) => (
              <SidebarDocumentTreeItem
                key={doc.id}
                document={doc}
                activeDocumentId={activeId}
                depth={0}
              />
            ))
          ) : (
            <li role="none">
              <div role="treeitem" className="px-2 py-1 text-sm text-muted">No workspace documents</div>
            </li>
          )}
          {workspaceHiddenCount > 0 && (
            <li role="none">
              <Link
                to="/docs?filter=workspace"
                role="treeitem"
                className="block px-2 py-1.5 text-sm text-muted hover:text-foreground hover:bg-border/30 rounded-md transition-colors"
              >
                {workspaceHiddenCount} more...
              </Link>
            </li>
          )}
        </ul>
      </div>
      {/* Private section - only show if user has private docs */}
      {privateTree.length > 0 && (
        <div>
          <div className="flex items-center gap-1.5 px-3 py-1 text-xs font-medium text-muted uppercase tracking-wider">
            <LockIcon className="h-3 w-3" />
            Private
          </div>
          <ul role="tree" aria-label="Private documents" aria-live="polite" className="space-y-0.5 px-2">
            {privateToShow.map((doc) => (
              <SidebarDocumentTreeItem
                key={doc.id}
                document={doc}
                activeDocumentId={activeId}
                depth={0}
              />
            ))}
            {privateHiddenCount > 0 && (
              <li role="none">
                <Link
                  to="/docs?filter=private"
                  role="treeitem"
                  className="block px-2 py-1.5 text-sm text-muted hover:text-foreground hover:bg-border/30 rounded-md transition-colors"
                >
                  {privateHiddenCount} more...
                </Link>
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}