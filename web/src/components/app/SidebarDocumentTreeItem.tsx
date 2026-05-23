/**
 * Sidebar adapter: binds DocumentsContext hooks to the shared DocumentTreeItem.
 */
import { useCallback, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { DocumentTreeItem } from '@/components/DocumentTreeItem';
import { ContextMenu, ContextMenuItem, ContextMenuSeparator, ContextMenuSubmenu } from '@/components/ui/ContextMenu';
import { useToast } from '@/components/ui/Toast';
import { useDocuments } from '@/contexts/DocumentsContext';
import { VISIBILITY_OPTIONS } from '@/lib/contextMenuActions';
import type { DocumentTreeNode } from '@/lib/documentTree';

function MoreHorizontalIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="1" fill="currentColor" />
      <circle cx="19" cy="12" r="1" fill="currentColor" />
      <circle cx="5" cy="12" r="1" fill="currentColor" />
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

function GlobeIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}

export function SidebarDocumentTreeItem({
  document,
  activeDocumentId,
  depth = 0,
}: {
  document: DocumentTreeNode;
  activeDocumentId?: string;
  depth?: number;
}) {
  const { createDocument, updateDocument, deleteDocument } = useDocuments();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  const handleCreateSubdocument = useCallback(async () => {
    closeContextMenu();
    const newDoc = await createDocument(document.id);
    if (newDoc) navigate(`/documents/${newDoc.id}`);
  }, [closeContextMenu, createDocument, document.id, navigate]);

  const handleRename = useCallback(() => {
    closeContextMenu();
    navigate(`/documents/${document.id}`);
  }, [closeContextMenu, document.id, navigate]);

  const handleChangeVisibility = useCallback(async (visibility: 'private' | 'workspace') => {
    closeContextMenu();
    await updateDocument(document.id, { visibility });
    showToast(`Visibility changed to ${visibility}`, 'success');
  }, [closeContextMenu, document.id, showToast, updateDocument]);

  const handleDelete = useCallback(async () => {
    closeContextMenu();
    const docTitle = document.title || 'Untitled';
    const childCount = document.children.length;
    const docData = {
      title: document.title,
      visibility: document.visibility,
      parent_id: document.parent_id,
    };

    const success = await deleteDocument(document.id);
    if (!success) return;

    const message = childCount > 0
      ? `Deleted "${docTitle}" and ${childCount} child document${childCount > 1 ? 's' : ''}`
      : `Deleted "${docTitle}"`;

    showToast(message, 'info', 5000, {
      label: 'Undo',
      onClick: async () => {
        const restored = await createDocument(docData.parent_id || undefined);
        if (restored) {
          await updateDocument(restored.id, {
            title: docData.title,
            visibility: docData.visibility,
          });
          showToast('Document restored', 'success');
        }
      },
    });
  }, [closeContextMenu, createDocument, deleteDocument, document, showToast, updateDocument]);

  return (
    <>
      <DocumentTreeItem
        document={document}
        activeDocumentId={activeDocumentId}
        depth={depth}
        autoExpandActive
        variant="sidebar"
        showVisibilityBadge
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setContextMenu({ x: event.clientX, y: event.clientY });
        }}
        menuButton={
          <button
            ref={menuButtonRef}
            type="button"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              if (menuButtonRef.current) {
                const rect = menuButtonRef.current.getBoundingClientRect();
                setContextMenu({ x: rect.right - 180, y: rect.bottom + 4 });
              }
            }}
            className="flex h-6 w-6 items-center justify-center rounded hover:bg-border/50 opacity-0 group-hover:opacity-100 focus:opacity-100 group-focus-within:opacity-100 transition-opacity focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            aria-label="Document actions"
            aria-haspopup="menu"
            aria-expanded={contextMenu !== null}
          >
            <MoreHorizontalIcon className="h-3.5 w-3.5" />
          </button>
        }
        renderChild={(child) => (
          <SidebarDocumentTreeItem
            key={child.id}
            document={child}
            activeDocumentId={activeDocumentId}
            depth={depth + 1}
          />
        )}
      />
      {contextMenu && (
        <ContextMenu x={contextMenu.x} y={contextMenu.y} onClose={closeContextMenu}>
          <ContextMenuItem onClick={handleCreateSubdocument}>Create sub-document</ContextMenuItem>
          <ContextMenuItem onClick={handleRename}>Rename</ContextMenuItem>
          <ContextMenuSubmenu label="Change visibility">
            {VISIBILITY_OPTIONS.map((opt) => (
              <ContextMenuItem
                key={opt.value}
                onClick={() => handleChangeVisibility(opt.value)}
              >
                {opt.value === 'private' && <LockIcon className="h-3.5 w-3.5 mr-2" />}
                {opt.value === 'workspace' && <GlobeIcon className="h-3.5 w-3.5 mr-2" />}
                {opt.label}
              </ContextMenuItem>
            ))}
          </ContextMenuSubmenu>
          <ContextMenuSeparator />
          <ContextMenuItem onClick={handleDelete} destructive>Delete</ContextMenuItem>
        </ContextMenu>
      )}
    </>
  );
}
