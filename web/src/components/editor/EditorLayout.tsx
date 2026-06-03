import { createPortal } from 'react-dom';
import { EditorContent, BubbleMenu, type Editor } from '@tiptap/react';
import { ResilientSection } from '@/components/ui/ResilientSection';
import { cn } from '@/lib/cn';
import { Tooltip } from '@/components/ui/Tooltip';
import { ScrollFade } from '@/components/ui/ScrollFade';
import type { CollabSyncStatus, CollabUser } from '@/hooks/useCollabSession';
import { CollapseRightIcon, ExpandLeftIcon, TrashIcon } from './EditorIcons';

export interface EditorLayoutProps {
  editor: Editor | null;
  documentId: string;
  documentType?: string;
  title: string;
  titleInputRef: React.RefObject<HTMLTextAreaElement>;
  titleReadOnly: boolean;
  titleSuffix?: string;
  handleTitleChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  onBack?: () => void;
  backLabel?: string;
  headerBadge?: React.ReactNode;
  secondaryHeader?: React.ReactNode;
  onDelete?: () => void;
  isBrowserOnline: boolean;
  syncStatus: CollabSyncStatus;
  connectedUsers: CollabUser[];
  breadcrumbs?: React.ReactNode;
  contentBanner?: React.ReactNode;
  sidebar?: React.ReactNode;
  portalTarget: HTMLElement | null;
  rightSidebarCollapsed: boolean;
  setRightSidebarCollapsed: (collapsed: boolean) => void;
}

export function EditorLayout({
  editor,
  documentId,
  documentType,
  title,
  titleInputRef,
  titleReadOnly,
  titleSuffix,
  handleTitleChange,
  onBack,
  backLabel,
  headerBadge,
  secondaryHeader,
  onDelete,
  isBrowserOnline,
  syncStatus,
  connectedUsers,
  breadcrumbs,
  contentBanner,
  sidebar,
  portalTarget,
  rightSidebarCollapsed,
  setRightSidebarCollapsed,
}: EditorLayoutProps) {
  return (
    <div className="flex h-full flex-col">
      {/* Compact header - breadcrumb, title, status, presence all in one row */}
      <div className="flex items-center gap-3 border-b border-border px-4 py-2">
          {/* Back button with optional parent label */}
          {onBack && (
            <Tooltip content={backLabel ? `Back to ${backLabel}` : 'Back to documents'}>
              <button
                onClick={onBack}
                className="flex items-center gap-1.5 text-muted hover:text-foreground transition-colors"
                aria-label={backLabel ? `Back to ${backLabel}` : 'Back to documents'}
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
                {backLabel && (
                  <span className="text-xs truncate max-w-[120px]">{backLabel}</span>
                )}
              </button>
            </Tooltip>
          )}

          {/* Optional header badge (e.g., issue number) */}
          {headerBadge}

          {/* Title (display only - edit via large title below) - h1 for accessibility */}
          {/* WCAG 1.4.12: min-w-[3rem] prevents collapse, overflow-visible shows text */}
          <h1 className="flex-1 min-w-[3rem] overflow-visible text-sm font-medium text-foreground m-0">
            {title || 'Untitled'}
            {titleSuffix && <span className="text-muted font-normal"> &mdash; {titleSuffix}</span>}
          </h1>

          {/* Sync status - WCAG 4.1.3 aria-live for status messages */}
          {/* Show 'Offline' when browser is offline, regardless of WebSocket state */}
          {(() => {
            const effectiveStatus = !isBrowserOnline ? 'disconnected' : syncStatus;
            return (
              <div
                role="status"
                aria-live="polite"
                aria-atomic="true"
                className="flex items-center gap-1.5"
                data-testid="sync-status"
              >
                <div
                  className={cn(
                    'h-2 w-2 rounded-full',
                    effectiveStatus === 'synced' && 'bg-green-500',
                    effectiveStatus === 'cached' && 'bg-blue-500',
                    effectiveStatus === 'connecting' && 'bg-yellow-500 animate-pulse',
                    effectiveStatus === 'disconnected' && 'bg-red-500'
                  )}
                  aria-hidden="true"
                />
                <span className="text-xs text-muted">
                  {effectiveStatus === 'synced' && 'Saved'}
                  {effectiveStatus === 'cached' && 'Cached'}
                  {effectiveStatus === 'connecting' && 'Saving'}
                  {effectiveStatus === 'disconnected' && 'Offline'}
                </span>
              </div>
            );
          })()}

          {/* Delete button */}
          {onDelete && (
            <Tooltip content="Delete document">
              <button
                onClick={onDelete}
                className="flex h-6 w-6 items-center justify-center rounded text-muted hover:bg-red-500/10 hover:text-red-500 transition-colors"
                aria-label="Delete document"
              >
                <TrashIcon />
              </button>
            </Tooltip>
          )}

        {/* Connected users */}
        <div className="flex items-center gap-1" data-testid="collab-status">
          {connectedUsers.map((user, index) => (
            <div
              key={index}
              className="flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium text-white"
              style={{ backgroundColor: user.color }}
              title={user.name}
            >
              {user.name.charAt(0).toUpperCase()}
            </div>
          ))}
        </div>
      </div>

      {/* Secondary header for actions (e.g., Submit, Accept, Reject buttons) */}
      {secondaryHeader && (
        <div className="flex items-center justify-center border-b border-border px-4 py-2">
          {secondaryHeader}
        </div>
      )}

      {/* Content area with optional sidebar */}
      <div className="flex flex-1 overflow-hidden">
        {/* Editor area - clickable to focus at end */}
        <div className="flex flex-1 flex-col overflow-auto cursor-text pb-32">
          <div className="mx-auto max-w-3xl w-full py-8 pr-8 pl-12">
            {/* Breadcrumbs above title */}
            {breadcrumbs && (
              <div className="mb-2 pl-8">
                {breadcrumbs}
              </div>
            )}
            {/* Large document title */}
            <textarea
              ref={titleInputRef}
              value={title}
              onChange={titleReadOnly ? undefined : handleTitleChange}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  editor?.commands.focus('start');
                }
              }}
              onInput={(e) => {
                const el = e.currentTarget;
                el.style.height = 'auto';
                el.style.height = `${el.scrollHeight}px`;
              }}
              placeholder="Untitled"
              readOnly={titleReadOnly}
              rows={1}
              className={cn(
                "mb-6 w-full bg-transparent text-3xl font-bold text-foreground placeholder:text-muted/30 focus:outline-none pl-8 resize-none overflow-hidden",
                titleReadOnly && "cursor-default"
              )}
            />
            {contentBanner}
            <div
              className="tiptap-wrapper"
              data-testid="tiptap-editor"
              onContextMenu={(e) => {
                if (!editor || editor.state.selection.empty) return;
                e.preventDefault();
                const menu = document.createElement('div');
                menu.className = 'comment-context-menu';
                menu.style.cssText = `position:fixed;left:${e.clientX}px;top:${e.clientY}px;z-index:9999;background:rgb(39,39,42);border:1px solid rgb(63,63,70);border-radius:6px;padding:4px 0;box-shadow:0 4px 12px rgba(0,0,0,0.4);`;
                const btn = document.createElement('button');
                btn.textContent = 'Add Comment';
                btn.style.cssText = 'display:block;width:100%;padding:6px 12px;background:none;border:none;color:rgb(228,228,231);font-size:13px;cursor:pointer;text-align:left;';
                btn.onmouseenter = () => { btn.style.background = 'rgb(63,63,70)'; };
                btn.onmouseleave = () => { btn.style.background = 'none'; };
                btn.onclick = () => {
                  editor.commands.addComment();
                  menu.remove();
                };
                menu.appendChild(btn);
                document.body.appendChild(menu);
                const dismiss = (ev: MouseEvent) => {
                  if (!menu.contains(ev.target as Node)) {
                    menu.remove();
                    document.removeEventListener('mousedown', dismiss);
                  }
                };
                setTimeout(() => document.addEventListener('mousedown', dismiss), 0);
              }}
            >
              <EditorContent editor={editor} />
            </div>
            {editor && !editor.isDestroyed && (
              <BubbleMenu
                editor={editor}
                pluginKey="commentBubbleMenu"
                shouldShow={({ state }) => {
                  if (state.selection.empty) return false;
                  const { $from } = state.selection;
                  if ($from.parent.type.name === 'codeBlock') return false;
                  return true;
                }}
                tippyOptions={{ placement: 'top', duration: 150 }}
              >
                <button
                  onClick={() => editor.commands.addComment()}
                  className="flex items-center gap-1.5 px-2.5 py-1 bg-zinc-800 border border-zinc-600 rounded-md text-xs text-zinc-200 hover:bg-zinc-700 transition-colors shadow-lg"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                  </svg>
                  Comment
                </button>
              </BubbleMenu>
            )}
            {/* Pending comment input is now rendered as a ProseMirror widget decoration in CommentDisplay */}
          </div>
          {/* Spacer to fill remaining height - clickable to focus editor at end */}
          <div
            className="flex-1 min-h-[200px]"
            onClick={() => {
              if (!editor) return;
              // Focus editor at the end
              const lastNode = editor.state.doc.lastChild;
              const isLastNodeEmpty = lastNode?.type.name === 'paragraph' && lastNode.content.size === 0;

              if (isLastNodeEmpty) {
                // Focus the existing empty paragraph at the end
                editor.chain().focus('end').run();
              } else {
                // Insert a new empty paragraph at the end of the document and focus it
                const endPos = editor.state.doc.content.size;
                editor.chain()
                  .insertContentAt(endPos, { type: 'paragraph' })
                  .focus('end')
                  .run();
              }
            }}
          />
        </div>

      </div>

      {/* Properties sidebar content - rendered via portal into the aside landmark in App.tsx */}
      {sidebar && portalTarget && createPortal(
        <div
          className={cn(
            'flex flex-col border-l border-border transition-all duration-200 overflow-hidden h-full',
            rightSidebarCollapsed ? 'w-0 border-l-0' : 'w-64'
          )}
        >
          <div className="flex w-64 flex-col h-full">
            {/* Sidebar header with collapse button */}
            <div className="flex h-10 items-center justify-between border-b border-border px-3">
              <span className="text-sm font-medium text-foreground">Properties</span>
              <Tooltip content="Collapse sidebar">
                <button
                  onClick={() => setRightSidebarCollapsed(true)}
                  className="flex h-6 w-6 items-center justify-center rounded text-muted hover:bg-border hover:text-foreground transition-colors"
                  aria-label="Collapse sidebar"
                >
                  <CollapseRightIcon />
                </button>
              </Tooltip>
            </div>
            {/* Sidebar content */}
            <ScrollFade className="flex-1">
              <div className="pb-20">
                <ResilientSection
                  name={`properties-sidebar-${documentType ?? 'document'}`}
                  fallbackTitle="Properties unavailable"
                  fallbackDescription="The document editor is still usable while this sidebar recovers."
                  resetKeys={[documentId, documentType]}
                >
                  {sidebar}
                </ResilientSection>
              </div>
            </ScrollFade>
          </div>

          {/* Expand button when right sidebar is collapsed */}
          {rightSidebarCollapsed && (
            <Tooltip content="Expand properties" side="left">
              <button
                onClick={() => setRightSidebarCollapsed(false)}
                className="absolute right-0 top-0 flex h-10 w-10 items-center justify-center border-l border-border text-muted hover:bg-border/50 hover:text-foreground transition-colors"
                aria-label="Expand properties sidebar"
              >
                <ExpandLeftIcon />
              </button>
            </Tooltip>
          )}
        </div>,
        portalTarget
      )}
    </div>
  );
}
