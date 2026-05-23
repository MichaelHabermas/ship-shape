import { useEffect, useState, useCallback, useRef, useMemo, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Collaboration from '@tiptap/extension-collaboration';
import CollaborationCursor from '@tiptap/extension-collaboration-cursor';
import Placeholder from '@tiptap/extension-placeholder';
import Link from '@tiptap/extension-link';
import { ResizableImage } from './editor/ResizableImage';
import Dropcursor from '@tiptap/extension-dropcursor';
import type { AnyExtension } from '@tiptap/core';
import { createCodeBlockLowlightExtension } from './editor/lowlight-setup';
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import * as Y from 'yjs';
import { ResilientSection } from '@/components/ui/ResilientSection';
import { cn } from '@/lib/cn';
import { Tooltip } from '@/components/ui/Tooltip';
import { ScrollFade } from '@/components/ui/ScrollFade';
import { apiPost } from '@/lib/api';
import { createSlashCommands } from './editor/SlashCommands';
import { DocumentEmbed } from './editor/DocumentEmbed';
import { DragHandleExtension } from './editor/DragHandle';
import { createMentionExtension } from './editor/MentionExtension';
import { ImageUploadExtension } from './editor/ImageUpload';
import { FileAttachmentExtension } from './editor/FileAttachment';
import { DetailsExtension, DetailsSummary, DetailsContent } from './editor/DetailsExtension';
import { EmojiExtension } from './editor/EmojiExtension';
import { TableOfContentsExtension } from './editor/TableOfContents';
import { HypothesisBlockExtension } from './editor/HypothesisBlockExtension';
import { CommentMark } from './editor/CommentMark';
import { CommentDisplayExtension } from './editor/CommentDisplay';
import type { CommentDisplayStorage } from './editor/CommentDisplay';
import { AIScoringDisplayExtension } from './editor/AIScoringDisplay';
import type { AIScoringStorage } from './editor/AIScoringDisplay';
import { PlanReferenceBlockExtension } from './editor/PlanReferenceBlock';
import { useCommentsQuery, useCreateComment, useUpdateComment } from '@/hooks/useCommentsQuery';
import type { ConversionDocumentType } from '@ship/shared';
import { BubbleMenu } from '@tiptap/react';
import 'tippy.js/dist/tippy.css';

interface EditorProps {
  documentId: string;
  userName: string;
  userColor?: string;
  onTitleChange?: (title: string) => void;
  initialTitle?: string;
  /** Whether the title is read-only (e.g., for weekly plans/retros with computed titles) */
  titleReadOnly?: boolean;
  onBack?: () => void;
  /** Label for back button (e.g., parent document title) */
  backLabel?: string;
  /** Room prefix for collaboration (e.g., 'doc' or 'issue') */
  roomPrefix?: string;
  /** Placeholder text for the editor */
  placeholder?: string;
  /** Badge to show in header (e.g., issue number) */
  headerBadge?: React.ReactNode;
  /** Breadcrumbs to show above the title */
  breadcrumbs?: React.ReactNode;
  /** Sidebar content (e.g., issue properties) */
  sidebar?: React.ReactNode;
  /** Callback to create a sub-document (for slash commands) */
  onCreateSubDocument?: () => Promise<{ id: string; title: string } | null>;
  /** Callback to navigate to a document (for slash commands) */
  onNavigateToDocument?: (id: string) => void;
  /** Callback to delete the document */
  onDelete?: () => void;
  /** Secondary header content (e.g., action buttons) - displayed below breadcrumb header */
  secondaryHeader?: React.ReactNode;
  /** Document type for filtering document-specific slash commands (e.g., 'program', 'project') */
  documentType?: string;
  /** Callback when the document is converted to a different type by another user */
  onDocumentConverted?: (newDocId: string, newDocType: ConversionDocumentType) => void;
  /** Callback when plan block content changes (for sprint documents) */
  onPlanChange?: (plan: string) => void;
  /** Banner content rendered between the title and editor content (e.g., AI quality check) */
  contentBanner?: React.ReactNode;
  /** Callback when editor content changes (debounced). Receives TipTap JSON content. */
  onContentChange?: (content: Record<string, unknown>) => void;
  /** AI scoring analysis data to render as inline decorations */
  aiScoringAnalysis?: { planAnalysis?: unknown; retroAnalysis?: unknown } | null;
  /** Suffix displayed after the title in the header (e.g., author name) */
  titleSuffix?: string;
}

// Generate a consistent color from a string
function stringToColor(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = hash % 360;
  return `hsl(${hue}, 70%, 60%)`;
}

import { extractDocumentMentionIds, extractHypothesisFromContent } from '@ship/shared';
import { useCollabSession } from '@/hooks/useCollabSession';

export function Editor({
  documentId,
  userName,
  userColor,
  onTitleChange,
  initialTitle = 'Untitled',
  titleReadOnly = false,
  onBack,
  backLabel,
  roomPrefix = 'doc',
  placeholder = 'Start writing...',
  headerBadge,
  breadcrumbs,
  sidebar,
  onCreateSubDocument,
  onNavigateToDocument,
  onDelete,
  secondaryHeader,
  documentType,
  onDocumentConverted,
  onPlanChange,
  contentBanner,
  onContentChange,
  aiScoringAnalysis,
  titleSuffix,
}: EditorProps) {
  const [title, setTitle] = useState(initialTitle === 'Untitled' ? '' : initialTitle);
  const titleInputRef = useRef<HTMLTextAreaElement>(null);

  // Track if user has made local changes (to prevent stale server responses from overwriting)
  const hasLocalChangesRef = useRef(false);
  const lastSyncedTitleRef = useRef(initialTitle);

  // CRITICAL: Create a new Y.Doc for each documentId using useMemo
  // This ensures the Y.Doc is atomically recreated when documentId changes,
  // preventing race conditions where the WebSocket provider might use a stale Y.Doc
  // that contains content from a different document (cross-document contamination bug)
  const ydoc = useMemo(() => new Y.Doc(), [documentId]);

  // Sync title when initialTitle prop changes (e.g., from context update)
  // Only update if user hasn't made local changes (prevents stale responses from overwriting)
  useEffect(() => {
    const newTitle = initialTitle === 'Untitled' ? '' : initialTitle;
    // Only update if this is a genuinely new value from server
    // AND user hasn't made local changes since
    if (!hasLocalChangesRef.current && initialTitle !== lastSyncedTitleRef.current) {
      setTitle(newTitle);
      lastSyncedTitleRef.current = initialTitle;
    }
  }, [initialTitle]);

  // Reset local changes flag after save completes (parent will update initialTitle)
  useEffect(() => {
    if (initialTitle === title || (initialTitle === 'Untitled' && title === '')) {
      hasLocalChangesRef.current = false;
      lastSyncedTitleRef.current = initialTitle;
    }
  }, [initialTitle, title]);

  // Auto-resize title textarea when title changes or on mount
  useEffect(() => {
    const el = titleInputRef.current;
    if (el) {
      el.style.height = 'auto';
      el.style.height = `${el.scrollHeight}px`;
    }
  }, [title]);
  const [isBrowserOnline, setIsBrowserOnline] = useState(navigator.onLine);
  const color = userColor || stringToColor(userName);

  const { provider, syncStatus, connectedUsers } = useCollabSession({
    documentId,
    documentType,
    roomPrefix,
    userName,
    userColor: color,
    ydoc,
    onBack,
    onDocumentConverted,
  });
  const [rightSidebarCollapsed, setRightSidebarCollapsed] = useState(() => {
    return localStorage.getItem('ship:rightSidebarCollapsed') === 'true';
  });
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);

  // AbortController for cancelling async uploads (images, files) when navigating away
  // This prevents uploads from completing into a different document after navigation
  const imageUploadAbortRef = useRef<AbortController>(new AbortController());

  // Find portal target for properties sidebar (for proper landmark order)
  useLayoutEffect(() => {
    const target = document.getElementById('properties-portal');
    setPortalTarget(target);
  }, []);

  // Persist right sidebar state
  useEffect(() => {
    localStorage.setItem('ship:rightSidebarCollapsed', String(rightSidebarCollapsed));
  }, [rightSidebarCollapsed]);

  // Track browser online status for sync indicator using native browser events
  useEffect(() => {
    const handleOnline = () => setIsBrowserOnline(true);
    const handleOffline = () => setIsBrowserOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Abort pending uploads when switching documents
  useEffect(() => {
    return () => {
      imageUploadAbortRef.current.abort();
      imageUploadAbortRef.current = new AbortController();
    };
  }, [documentId]);

  // Auto-focus and select title if "Untitled" (new document)
  // Uses double requestAnimationFrame to run AFTER useFocusOnNavigate's
  // requestAnimationFrame (which focuses #main-content for accessibility).
  // This ensures title gets focus for new docs while preserving a11y flow.
  useEffect(() => {
    if (!title || title === 'Untitled') {
      // First rAF: queued alongside useFocusOnNavigate's rAF
      // Second rAF: runs after useFocusOnNavigate completes
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (titleInputRef.current) {
            titleInputRef.current.focus();
            titleInputRef.current.select();
          }
        });
      });
    }
  }, []);

  // Create slash commands extension (memoized to avoid recreation)
  // documentId is in deps to ensure fresh AbortSignal when switching documents
  const slashCommandsExtension = useMemo(() => {
    return createSlashCommands({
      onCreateSubDocument,
      onNavigateToDocument,
      documentType,
      abortSignal: imageUploadAbortRef.current.signal,
    });
  }, [onCreateSubDocument, onNavigateToDocument, documentType, documentId]);

  // Create mention extension (memoized to avoid recreation)
  const mentionExtension = useMemo(() => {
    return createMentionExtension({
      onNavigate: (type, id) => {
        // Navigate to the mentioned entity
        if (type === 'person') {
          onNavigateToDocument?.(`/team/${id}`);
        } else {
          onNavigateToDocument?.(id);
        }
      },
    });
  }, [onNavigateToDocument]);

  // Comments - fetch and manage inline comments
  const { data: comments = [] } = useCommentsQuery(documentId);
  const createComment = useCreateComment(documentId);
  const updateComment = useUpdateComment(documentId);
  const [pendingCommentId, setPendingCommentId] = useState<string | null>(null);
  const [codeBlockExtension, setCodeBlockExtension] = useState<AnyExtension | null>(null);

  useEffect(() => {
    let cancelled = false;
    void createCodeBlockLowlightExtension().then((extension) => {
      if (!cancelled) {
        setCodeBlockExtension(extension);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Handle adding a new comment (called from keyboard shortcut, bubble menu, context menu)
  const handleAddComment = useCallback((commentId: string) => {
    setPendingCommentId(commentId);
  }, []);

  // Build extensions - only include CollaborationCursor when provider is ready
  const baseExtensions = [
    StarterKit.configure({
      history: false,
      dropcursor: false,
      codeBlock: false, // Disable default code block to use CodeBlockLowlight
    }),
    ...(codeBlockExtension ? [codeBlockExtension] : []),
    Placeholder.configure({ placeholder }),
    Collaboration.configure({ document: ydoc }),
    Link.configure({
      openOnClick: true,
      HTMLAttributes: {
        class: 'text-accent hover:underline cursor-pointer',
      },
    }),
    ResizableImage,
    Dropcursor.configure({
      color: '#3b82f6',
      width: 2,
    }),
    Table.configure({
      resizable: true,
      HTMLAttributes: {
        class: 'tiptap-table',
      },
    }),
    TableRow,
    TableCell,
    TableHeader,
    TaskList.configure({
      HTMLAttributes: {
        class: 'task-list',
      },
    }),
    TaskItem.configure({
      nested: true,
      HTMLAttributes: {
        class: 'task-item',
      },
    }),
    ImageUploadExtension.configure({
      onUploadStart: () => {},
      onUploadComplete: () => {},
      onUploadError: (error) => console.error('Upload error:', error),
      abortController: imageUploadAbortRef.current,
    }),
    FileAttachmentExtension,
    DocumentEmbed,
    DragHandleExtension,
    DetailsExtension,
    DetailsSummary,
    DetailsContent,
    mentionExtension,
    EmojiExtension,
    TableOfContentsExtension,
    HypothesisBlockExtension,
    CommentMark.configure({ onAddComment: handleAddComment }),
    CommentDisplayExtension,
    AIScoringDisplayExtension,
    PlanReferenceBlockExtension,
    slashCommandsExtension,
  ];

  const extensions = provider
    ? [
        ...baseExtensions,
        CollaborationCursor.configure({
          provider: provider,
          user: { name: userName, color: color },
        }),
      ]
    : baseExtensions;

  const editor = useEditor({
    extensions,
    editorProps: {
      attributes: {
        class: 'prose prose-invert prose-sm max-w-none focus:outline-none min-h-[300px]',
      },
    },
  }, [provider, documentType, codeBlockExtension]);

  // Refs for stable comment callbacks (avoid re-render loops)
  const commentsRef = useRef(comments);
  commentsRef.current = comments;
  const createCommentRef = useRef(createComment);
  createCommentRef.current = createComment;
  const updateCommentRef = useRef(updateComment);
  updateCommentRef.current = updateComment;

  // Sync comment data into the CommentDisplay extension storage
  useEffect(() => {
    if (!editor) return;
    const storage = editor.storage.commentDisplay as CommentDisplayStorage | undefined;
    if (!storage) return;

    storage.comments = comments;
    storage.pendingCommentId = pendingCommentId;
    storage.onReply = (commentId: string, content: string) => {
      const rootComment = commentsRef.current.find(c => c.comment_id === commentId && !c.parent_id);
      createCommentRef.current.mutate({
        comment_id: commentId,
        content,
        parent_id: rootComment?.id,
      });
    };
    storage.onResolve = (commentId: string, resolved: boolean) => {
      const rootComment = commentsRef.current.find(c => c.comment_id === commentId && !c.parent_id);
      if (rootComment) {
        updateCommentRef.current.mutate({
          commentId: rootComment.id,
          resolved_at: resolved ? new Date().toISOString() : null,
        });
        // Don't remove the mark -- keep it so the collapsed indicator knows where to render.
        // The CommentDisplay plugin handles showing resolved vs unresolved states.
      }
    };
    storage.onSubmitComment = (commentId: string, content: string) => {
      createCommentRef.current.mutate({ comment_id: commentId, content });
      setPendingCommentId(null);
    };
    storage.onCancelComment = (commentId: string) => {
      editor.commands.unsetComment(commentId);
      setPendingCommentId(null);
    };

    // Force ProseMirror to re-evaluate decorations
    // Delay to ensure DOM is ready and avoid init-time errors
    const timer = setTimeout(() => {
      if (!editor.isDestroyed && editor.view) {
        try {
          editor.view.updateState(editor.view.state);
        } catch {
          // Ignore DOM errors during initialization
        }
      }
    }, 100);
    return () => clearTimeout(timer);
  }, [editor, comments, pendingCommentId]);

  // Pending inline comments: capture Escape at document level so cancel works even when
  // focus is outside the ProseMirror view (Playwright/E2E and bubble-menu flows).
  useEffect(() => {
    if (!editor || pendingCommentId === null) return;

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      editor.commands.unsetComment(pendingCommentId);
      setPendingCommentId(null);
      event.preventDefault();
    };

    document.addEventListener('keydown', handleEscape, true);
    return () => document.removeEventListener('keydown', handleEscape, true);
  }, [editor, pendingCommentId]);

  // Sync AI scoring data into the AIScoringDisplay extension storage
  useEffect(() => {
    if (!editor) return;
    const storage = editor.storage.aiScoringDisplay as AIScoringStorage | undefined;
    if (!storage) return;

    storage.planAnalysis = (aiScoringAnalysis?.planAnalysis as AIScoringStorage['planAnalysis']) ?? null;
    storage.retroAnalysis = (aiScoringAnalysis?.retroAnalysis as AIScoringStorage['retroAnalysis']) ?? null;

    // Force ProseMirror to re-evaluate decorations
    const timer = setTimeout(() => {
      if (!editor.isDestroyed && editor.view) {
        try {
          editor.view.updateState(editor.view.state);
        } catch {
          // Ignore DOM errors during initialization
        }
      }
    }, 50);
    return () => clearTimeout(timer);
  }, [editor, aiScoringAnalysis]);

  // Sync document links when editor content changes (for backlinks feature)
  const lastSyncedLinksRef = useRef<string>('');
  useEffect(() => {
    if (!editor) return;

    const syncLinks = () => {
      const json = editor.getJSON();
      const targetIds = extractDocumentMentionIds(json);
      const targetIdsKey = targetIds.sort().join(',');

      // Only sync if links have changed
      if (targetIdsKey === lastSyncedLinksRef.current) {
        return;
      }
      lastSyncedLinksRef.current = targetIdsKey;

      // POST to update links (uses target_ids for API compatibility)
      // Use apiPost to handle CSRF token automatically
      apiPost(`/api/documents/${documentId}/links`, { target_ids: targetIds })
        .catch((err: unknown) => {
          console.error('[LinkSync] POST error:', err);
        });
    };

    // Debounce during editing
    let debounceTimer: ReturnType<typeof setTimeout>;
    const debouncedSync = () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(syncLinks, 500);
    };

    editor.on('update', debouncedSync);
    // Sync on initial load
    syncLinks();

    return () => {
      clearTimeout(debounceTimer);
      editor.off('update', debouncedSync);
      // Flush any pending sync - but this won't complete if navigating away
      syncLinks();
    };
  }, [editor, documentId]);

  // Notify parent of content changes (debounced 3s) for AI quality analysis etc.
  useEffect(() => {
    if (!editor || !onContentChange) return;

    let debounceTimer: ReturnType<typeof setTimeout>;
    const debouncedNotify = () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        const json = editor.getJSON();
        onContentChange(json);
      }, 3000);
    };

    editor.on('update', debouncedNotify);

    return () => {
      clearTimeout(debounceTimer);
      editor.off('update', debouncedNotify);
    };
  }, [editor, onContentChange]);

  // Sync plan content when HypothesisBlock changes (for sprint documents)
  const lastSyncedPlanRef = useRef<string | null>(null);
  useEffect(() => {
    if (!editor || !onPlanChange) return;

    const syncPlan = () => {
      const json = editor.getJSON();
      const plan = extractHypothesisFromContent(json);

      // Only sync if plan has changed (including when it becomes null/empty)
      if (plan === lastSyncedPlanRef.current) {
        return;
      }
      lastSyncedPlanRef.current = plan;

      // Call the callback with the new plan text (empty string if null)
      onPlanChange(plan || '');
    };

    // Debounce during editing (300ms per PRD spec)
    let debounceTimer: ReturnType<typeof setTimeout>;
    const debouncedSync = () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(syncPlan, 300);
    };

    editor.on('update', debouncedSync);
    // Don't sync on initial load - let the parent handle initial state

    return () => {
      clearTimeout(debounceTimer);
      editor.off('update', debouncedSync);
    };
  }, [editor, onPlanChange]);

  // Handle title changes
  const handleTitleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newTitle = e.target.value;
    hasLocalChangesRef.current = true; // Mark as having local changes to prevent stale overwrites
    setTitle(newTitle);
    onTitleChange?.(newTitle);
  }, [onTitleChange]);

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

function CollapseRightIcon() {
  return (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 5l7 7-7 7m-8-14v14" />
    </svg>
  );
}

function ExpandLeftIcon() {
  return (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11 19l-7-7 7-7m8 14V5" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
    </svg>
  );
}
