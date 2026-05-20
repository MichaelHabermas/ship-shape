import { useEffect, useState, useCallback, useRef, useMemo, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { useEditor, EditorContent, JSONContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Collaboration from '@tiptap/extension-collaboration';
import CollaborationCursor from '@tiptap/extension-collaboration-cursor';
import Placeholder from '@tiptap/extension-placeholder';
import Link from '@tiptap/extension-link';
import { ResizableImage } from './editor/ResizableImage';
import Dropcursor from '@tiptap/extension-dropcursor';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import { common, createLowlight } from 'lowlight';
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { ErrorBoundary } from '@/components/ui/ErrorBoundary';
import { IndexeddbPersistence } from 'y-indexeddb';
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
import { AIScoringDisplayExtension } from './editor/AIScoringDisplay';
import { PlanReferenceBlockExtension } from './editor/PlanReferenceBlock';
import { useCommentsQuery, useCreateComment, useUpdateComment } from '@/hooks/useCommentsQuery';
import { BubbleMenu } from '@tiptap/react';
import 'tippy.js/dist/tippy.css';

// Create lowlight instance with common languages
const lowlight = createLowlight(common);

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
  onDocumentConverted?: (newDocId: string, newDocType: 'issue' | 'project') => void;
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

type SyncStatus = 'connecting' | 'cached' | 'synced' | 'disconnected';

// Generate a consistent color from a string
function stringToColor(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = hash % 360;
  return `hsl(${hue}, 70%, 60%)`;
}

// Extract document mention IDs from TipTap JSON content
function extractDocumentMentionIds(content: JSONContent): string[] {
  const mentionIds: string[] = [];

  function traverse(node: JSONContent) {
    if (node.type === 'mention' && node.attrs?.mentionType === 'document' && node.attrs?.id) {
      mentionIds.push(node.attrs.id);
    }
    if (node.content) {
      for (const child of node.content) {
        traverse(child);
      }
    }
  }

  traverse(content);
  return [...new Set(mentionIds)]; // Deduplicate
}

// Extract hypothesis text from hypothesisBlock node in TipTap JSON content
function extractHypothesisText(content: JSONContent): string | null {
  let hypothesisText: string | null = null;

  function traverse(node: JSONContent) {
    if (node.type === 'hypothesisBlock') {
      // Extract plain text from hypothesis block content
      const textParts: string[] = [];
      const extractText = (n: JSONContent) => {
        if (n.type === 'text' && n.text) {
          textParts.push(n.text);
        }
        if (n.content) {
          for (const child of n.content) {
            extractText(child);
          }
        }
      };
      if (node.content) {
        for (const child of node.content) {
          extractText(child);
        }
      }
      hypothesisText = textParts.join('');
      return; // Stop after first hypothesis block
    }
    if (node.content) {
      for (const child of node.content) {
        traverse(child);
      }
    }
  }

  traverse(content);
  return hypothesisText;
}

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
  const [provider, setProvider] = useState<WebsocketProvider | null>(null);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('connecting');
  const [isBrowserOnline, setIsBrowserOnline] = useState(navigator.onLine);
  const [connectedUsers, setConnectedUsers] = useState<{ name: string; color: string }[]>([]);
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

  const color = userColor || stringToColor(userName);

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

  // Setup IndexedDB persistence and WebSocket provider
  useEffect(() => {
    let wsProvider: WebsocketProvider | null = null;
    let hasCachedContent = false;
    let cancelled = false;
    // Store the updateUsers callback so we can properly remove it on cleanup
    let updateUsersCallback: (() => void) | null = null;

    // Create IndexedDB persistence for content caching
    // This loads cached content BEFORE WebSocket connects for instant navigation
    const indexeddbProvider = new IndexeddbPersistence(`ship-${roomPrefix}-${documentId}`, ydoc);

    // Wait for IndexedDB to load cached content (with timeout)
    // This ensures cached content shows instantly before WebSocket syncs
    const waitForCache = new Promise<void>((resolve) => {
      // Resolve immediately if already synced
      if (indexeddbProvider.synced) {
        hasCachedContent = true;
        setSyncStatus('cached');
        resolve();
        return;
      }

      // Wait for sync event
      const onSynced = () => {
        hasCachedContent = true;
        setSyncStatus((prev) => prev === 'connecting' ? 'cached' : prev);
        console.log(`[Editor] IndexedDB synced for ${roomPrefix}:${documentId}`);
        resolve();
      };
      indexeddbProvider.on('synced', onSynced);

      // Timeout after 300ms - don't block forever if no cache exists
      setTimeout(() => {
        indexeddbProvider.off('synced', onSynced);
        resolve();
      }, 300);
    });

    // Connect WebSocket AFTER cache loads (or timeout)
    waitForCache.then(() => {
      if (cancelled) return;

      // In production, use current host with wss:// (through CloudFront)
      // In development, Vite proxy handles /collaboration WebSocket (see vite.config.ts)
      const apiUrl = import.meta.env.VITE_API_URL ?? '';
      const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = apiUrl
        ? apiUrl.replace(/^http/, 'ws') + '/collaboration'
        : `${wsProtocol}//${window.location.host}/collaboration`;
      // Listen for custom "clear cache" message (type 3) from server
      // This is sent when the server loaded content fresh from JSON (API update/create)
      // We need to clear IndexedDB to prevent stale cached content from merging
      const MESSAGE_TYPE_CLEAR_CACHE = 3;
      const handleRawMessage = (event: MessageEvent) => {
        if (cancelled) return;
        try {
          const data = new Uint8Array(event.data);
          if (data.length > 0 && data[0] === MESSAGE_TYPE_CLEAR_CACHE) {
            console.log(`[Editor] Received cache clear signal for ${documentId}, clearing IndexedDB`);
            // Clear the Y.Doc to remove any cached content before server sync
            ydoc.transact(() => {
              const fragment = ydoc.getXmlFragment('default');
              // Delete all content from the fragment
              while (fragment.length > 0) {
                fragment.delete(0, 1);
              }
            });
            // Also clear IndexedDB for future visits
            indexeddbProvider.clearData().then(() => {
              console.log(`[Editor] IndexedDB cache cleared for ${documentId} (fresh from JSON)`);
              hasCachedContent = false;
            }).catch((err) => {
              console.error(`[Editor] Failed to clear IndexedDB cache for ${documentId}:`, err);
            });
          }
        } catch {
          // Ignore errors from processing non-binary messages
        }
      };

      // Create WebSocket provider with connect: false so we can add listener first
      wsProvider = new WebsocketProvider(wsUrl, `${roomPrefix}:${documentId}`, ydoc, {
        connect: false,
      });

      // Add raw message listener before connecting
      // y-websocket creates its own WebSocket, we need to hook into it
      const originalConnect = wsProvider.connect.bind(wsProvider);
      wsProvider.connect = () => {
        originalConnect();
        // Add listener to the new WebSocket
        if (wsProvider?.ws) {
          wsProvider.ws.addEventListener('message', handleRawMessage);
        }
      };

      // Now connect
      wsProvider.connect();

      wsProvider.on('status', (event: { status: string }) => {
        if (cancelled) return; // Don't update state if effect was cleaned up
        console.log(`[Editor] WebSocket status: ${event.status} for ${roomPrefix}:${documentId}`);
        if (event.status === 'connected') {
          setSyncStatus('synced');
        } else if (event.status === 'disconnected') {
          // If we have cached content, show 'cached' instead of 'disconnected'
          setSyncStatus(hasCachedContent ? 'cached' : 'disconnected');
        }
      });

      // Handle WebSocket close events to detect access revoked, document converted, or content updated
      wsProvider.on('connection-close', (event: CloseEvent | null) => {
        if (cancelled) return; // Don't process if effect was cleaned up
        if (event?.code === 4403) {
          console.log(`[Editor] Access revoked for document ${documentId}`);
          // Disable auto-reconnect since access was revoked
          wsProvider!.shouldConnect = false;
          // Show user-friendly message
          alert('Access to this document has been revoked. The document is now private.');
          // Navigate back if possible
          onBack?.();
        } else if (event?.code === 4100) {
          console.log(`[Editor] Document ${documentId} was converted`);
          // Disable auto-reconnect since document was converted
          wsProvider!.shouldConnect = false;
          // Parse conversion info from close reason
          try {
            const conversionInfo = JSON.parse(event.reason || '{}');
            if (conversionInfo.newDocId && conversionInfo.newDocType && onDocumentConverted) {
              onDocumentConverted(conversionInfo.newDocId, conversionInfo.newDocType);
            } else {
              // Fallback if callback not provided or info missing
              alert('This document was converted. Please refresh to view the new document.');
              onBack?.();
            }
          } catch {
            console.error('[Editor] Failed to parse conversion info:', event.reason);
            alert('This document was converted. Please refresh to view the new document.');
            onBack?.();
          }
        } else if (event?.code === 4101) {
          // Content updated via API - clear IndexedDB cache to prevent stale content merge
          console.log(`[Editor] Content updated via API for ${documentId}, clearing IndexedDB cache`);
          // Clear the IndexedDB cache so stale content doesn't merge with new content
          indexeddbProvider.clearData().then(() => {
            console.log(`[Editor] IndexedDB cache cleared for ${documentId}`);
            hasCachedContent = false;
          }).catch((err) => {
            console.error(`[Editor] Failed to clear IndexedDB cache for ${documentId}:`, err);
          });
          // y-websocket will auto-reconnect, now with fresh state from server
        }
      });

      wsProvider.on('sync', (isSynced: boolean) => {
        if (cancelled) return; // Don't update state if effect was cleaned up
        console.log(`[Editor] WebSocket sync: ${isSynced} for ${roomPrefix}:${documentId}`);
        if (isSynced) {
          setSyncStatus('synced');
        }
      });

      // Set awareness info
      wsProvider.awareness.setLocalStateField('user', {
        name: userName,
        color: color,
      });

      // Track connected users - store callback reference for proper cleanup
      // Deduplicate by user name to handle race conditions where stale awareness
      // states exist briefly during page refresh (before old connection cleanup)
      updateUsersCallback = () => {
        if (cancelled) return; // Don't update state if effect was cleaned up
        const users: { name: string; color: string }[] = [];
        const seenNames = new Set<string>();
        wsProvider!.awareness.getStates().forEach((state) => {
          if (state.user && !seenNames.has(state.user.name)) {
            seenNames.add(state.user.name);
            users.push(state.user);
          }
        });
        setConnectedUsers(users);
      };

      wsProvider.awareness.on('change', updateUsersCallback);
      updateUsersCallback();

      if (!cancelled) {
        setProvider(wsProvider);
      }
    });

    return () => {
      cancelled = true;

      // Abort any pending image uploads to prevent them from completing into wrong document
      imageUploadAbortRef.current.abort();
      // Create a new AbortController for the next document
      imageUploadAbortRef.current = new AbortController();

      if (wsProvider) {
        // CRITICAL: Clear awareness state before destroying to prevent ghost cursors
        // This notifies other clients that this user has left the document
        wsProvider.awareness.setLocalState(null);
        // Remove the awareness change listener using the stored callback reference
        if (updateUsersCallback) {
          wsProvider.awareness.off('change', updateUsersCallback);
        }
        // Destroy provider (disconnects WebSocket)
        wsProvider.destroy();
      }
      // Destroy IndexedDB persistence
      indexeddbProvider.destroy();
      // Clear provider state
      setProvider(null);
      setConnectedUsers([]);
    };
  }, [documentId, userName, color, ydoc, roomPrefix, onBack, onDocumentConverted]);

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
          onNavigateToDocument?.(`/people/${id}`);
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
    CodeBlockLowlight.configure({
      lowlight,
      HTMLAttributes: {
        class: 'code-block-lowlight',
      },
    }),
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
  }, [provider, documentType]);

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
    const ext = editor.extensionManager.extensions.find(e => e.name === 'commentDisplay');
    if (!ext) return;

    ext.storage.comments = comments;
    ext.storage.pendingCommentId = pendingCommentId;
    ext.storage.onReply = (commentId: string, content: string) => {
      const rootComment = commentsRef.current.find(c => c.comment_id === commentId && !c.parent_id);
      createCommentRef.current.mutate({
        comment_id: commentId,
        content,
        parent_id: rootComment?.id,
      });
    };
    ext.storage.onResolve = (commentId: string, resolved: boolean) => {
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
    ext.storage.onSubmitComment = (commentId: string, content: string) => {
      createCommentRef.current.mutate({ comment_id: commentId, content });
      setPendingCommentId(null);
    };
    ext.storage.onCancelComment = (commentId: string) => {
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

  // Sync AI scoring data into the AIScoringDisplay extension storage
  useEffect(() => {
    if (!editor) return;
    const ext = editor.extensionManager.extensions.find(e => e.name === 'aiScoringDisplay');
    if (!ext) return;

    ext.storage.planAnalysis = aiScoringAnalysis?.planAnalysis || null;
    ext.storage.retroAnalysis = aiScoringAnalysis?.retroAnalysis || null;

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
        .catch(err => {
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
      const plan = extractHypothesisText(json);

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
              <ErrorBoundary>
                <EditorContent editor={editor} />
              </ErrorBoundary>
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
                {sidebar}
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
