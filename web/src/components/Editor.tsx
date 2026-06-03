import { useEffect, useState, useCallback, useRef, useMemo, useLayoutEffect } from 'react';
import { useEditor } from '@tiptap/react';
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
import { AIScoringDisplayExtension } from './editor/AIScoringDisplay';
import { PlanReferenceBlockExtension } from './editor/PlanReferenceBlock';
import { useCommentsQuery, useCreateComment, useUpdateComment } from '@/hooks/useCommentsQuery';
import { useCollabSession } from '@/hooks/useCollabSession';
import { stringToColor, type EditorProps } from './editor/EditorProps';
import { useEditorSyncEffects } from './editor/useEditorSyncEffects';
import { EditorLayout } from './editor/EditorLayout';
import 'tippy.js/dist/tippy.css';

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
      documentId,
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
      codeBlock: codeBlockExtension ? false : {
        HTMLAttributes: {
          class: 'code-block-lowlight',
        },
      },
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
    FileAttachmentExtension.configure({ documentId }),
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

  useEditorSyncEffects({
    editor,
    documentId,
    comments,
    pendingCommentId,
    setPendingCommentId,
    createComment,
    updateComment,
    aiScoringAnalysis,
    onPlanChange,
  });

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

  // Handle title changes
  const handleTitleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newTitle = e.target.value;
    hasLocalChangesRef.current = true; // Mark as having local changes to prevent stale overwrites
    setTitle(newTitle);
    onTitleChange?.(newTitle);
  }, [onTitleChange]);

  return (
    <EditorLayout
      editor={editor}
      documentId={documentId}
      documentType={documentType}
      title={title}
      titleInputRef={titleInputRef}
      titleReadOnly={titleReadOnly}
      titleSuffix={titleSuffix}
      handleTitleChange={handleTitleChange}
      onBack={onBack}
      backLabel={backLabel}
      headerBadge={headerBadge}
      secondaryHeader={secondaryHeader}
      onDelete={onDelete}
      isBrowserOnline={isBrowserOnline}
      syncStatus={syncStatus}
      connectedUsers={connectedUsers}
      breadcrumbs={breadcrumbs}
      contentBanner={contentBanner}
      sidebar={sidebar}
      portalTarget={portalTarget}
      rightSidebarCollapsed={rightSidebarCollapsed}
      setRightSidebarCollapsed={setRightSidebarCollapsed}
    />
  );
}
