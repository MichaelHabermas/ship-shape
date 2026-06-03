import { useEffect, useRef } from 'react';
import type { Editor } from '@tiptap/react';
import { extractDocumentMentionIds, extractHypothesisFromContent } from '@ship/shared';
import { apiPost } from '@/lib/api';
import type { CommentDisplayStorage } from './CommentDisplay';
import type { AIScoringStorage } from './AIScoringDisplay';
import type { Comment } from '@/hooks/useCommentsQuery';
import type { UseMutationResult } from '@tanstack/react-query';

interface UseEditorSyncEffectsParams {
  editor: Editor | null;
  documentId: string;
  comments: Comment[];
  pendingCommentId: string | null;
  setPendingCommentId: (id: string | null) => void;
  createComment: UseMutationResult<
    Comment,
    Error,
    { comment_id: string; content: string; parent_id?: string }
  >;
  updateComment: UseMutationResult<
    Comment,
    Error,
    { commentId: string; content?: string; resolved_at?: string | null }
  >;
  aiScoringAnalysis?: { planAnalysis?: unknown; retroAnalysis?: unknown } | null;
  onPlanChange?: (plan: string) => void;
}

export function useEditorSyncEffects({
  editor,
  documentId,
  comments,
  pendingCommentId,
  setPendingCommentId,
  createComment,
  updateComment,
  aiScoringAnalysis,
  onPlanChange,
}: UseEditorSyncEffectsParams): void {
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
}
