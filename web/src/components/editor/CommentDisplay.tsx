import { Extension } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { Comment } from '@/hooks/useCommentsQuery';
import { formatRelativeTime } from '@/lib/date-utils';

/**
 * Groups comments by their comment_id (thread identifier).
 * Returns a map of commentId -> array of comments (root + replies).
 */
function groupByThread(comments: Comment[]): Map<string, Comment[]> {
  const threads = new Map<string, Comment[]>();
  for (const comment of comments) {
    const existing = threads.get(comment.comment_id) || [];
    existing.push(comment);
    threads.set(comment.comment_id, existing);
  }
  return threads;
}

/**
 * Find all comment mark positions in the document.
 * Returns a map of commentId -> end position of the containing block.
 */
function findCommentPositions(doc: ProseMirrorNode): Map<string, number> {
  const positions = new Map<string, number>();

  doc.descendants((node: ProseMirrorNode, pos: number) => {
    if (node.isText) {
      for (const mark of node.marks) {
        if (mark.type.name === 'commentMark' && mark.attrs.commentId) {
          const commentId = mark.attrs.commentId;
          // Always overwrite — doc.descendants iterates in document order,
          // so the last block containing the mark wins.
          const $pos = doc.resolve(pos);
          const blockEnd = $pos.end(Math.max(1, $pos.depth));
          positions.set(commentId, blockEnd);
        }
      }
    }
  });

  return positions;
}

export const commentDisplayPluginKey = new PluginKey('commentDisplay');

export interface CommentDisplayStorage {
  comments: Comment[];
  onReply: ((commentId: string, content: string) => void) | null;
  onResolve: ((commentId: string, resolved: boolean) => void) | null;
  pendingCommentId: string | null;
  onSubmitComment: ((commentId: string, content: string) => void) | null;
  onCancelComment: ((commentId: string) => void) | null;
}

/**
 * InlineCommentThread component rendered inside widget decorations.
 * Displays a GitHub-style comment card that breaks the document flow.
 */
function InlineCommentThread({
  thread,
  quotedText,
  onReply: _onReply,
  onResolve: _onResolve,
}: {
  thread: Comment[];
  quotedText: string;
  onReply: ((commentId: string, content: string) => void) | null;
  onResolve: ((commentId: string, resolved: boolean) => void) | null;
}) {
  const root = thread[0];
  const replies = thread.slice(1);
  const resolvedAt = root.resolved_at;
  const isResolved = resolvedAt !== null;

  const container = document.createElement('div');

  // Create a simple DOM structure (no React inside decorations for simplicity)
  container.className = 'comment-thread-inline';
  container.setAttribute('data-comment-thread', root.comment_id);
  container.contentEditable = 'false';

  if (isResolved) {
    container.innerHTML = `
      <div class="comment-thread-resolved" data-comment-id="${escapeHtml(root.comment_id)}">
        <span class="comment-resolved-icon">✓</span>
        <span class="comment-resolved-text">Resolved by ${escapeHtml(root.author.name)} · ${formatRelativeTime(resolvedAt)}</span>
        <span class="comment-resolved-toggle">Show thread</span>
      </div>
    `;
  } else {
    const quotedHtml = quotedText
      ? `<div class="comment-quoted-text">"${escapeHtml(quotedText)}"</div>`
      : '';

    let repliesHtml = '';
    for (const reply of replies) {
      repliesHtml += `
        <div class="comment-reply">
          <div class="comment-header">
            <span class="comment-author">${escapeHtml(reply.author.name)}</span>
            <span class="comment-time">${formatRelativeTime(reply.created_at)}</span>
          </div>
          <div class="comment-body">${escapeHtml(reply.content)}</div>
        </div>
      `;
    }

    container.innerHTML = `
      ${quotedHtml}
      <div class="comment-root">
        <div class="comment-header">
          <span class="comment-author">${escapeHtml(root.author.name)}</span>
          <span class="comment-time">${formatRelativeTime(root.created_at)}</span>
          <button class="comment-resolve-btn" data-comment-id="${escapeHtml(root.comment_id)}" title="Resolve">✓</button>
        </div>
        <div class="comment-body">${escapeHtml(root.content)}</div>
      </div>
      ${repliesHtml}
      <div class="comment-reply-area">
        <input type="text" class="comment-reply-input" placeholder="Reply..." data-comment-id="${escapeHtml(root.comment_id)}" />
      </div>
    `;
  }

  return container;
}

function escapeHtml(str: string): string {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/**
 * CommentDisplay extension - Renders inline comment threads as widget decorations.
 *
 * Comments appear as bordered cards between content blocks, pushing content down
 * (like GitHub code review). The extension reads comment data from its storage,
 * which is updated by the parent Editor component via React Query.
 */
export const CommentDisplayExtension = Extension.create<Record<string, never>, CommentDisplayStorage>({
  name: 'commentDisplay',

  addStorage() {
    return {
      comments: [],
      onReply: null,
      onResolve: null,
      pendingCommentId: null,
      onSubmitComment: null,
      onCancelComment: null,
    };
  },

  addProseMirrorPlugins() {
    const storage = this.storage;

    return [
      new Plugin({
        key: commentDisplayPluginKey,
        props: {
          decorations: (state) => {
            const { doc } = state;
            const comments = storage.comments;
            const positions = findCommentPositions(doc);
            const decorations: Decoration[] = [];

            // Add pending comment input widget (before saved comments so it renders inline)
            const pendingId = storage.pendingCommentId;
            if (pendingId) {
              const pendingPos = positions.get(pendingId);
              if (pendingPos !== undefined) {
                const pendingWidget = Decoration.widget(pendingPos, () => {
                  const container = document.createElement('div');
                  container.className = 'comment-thread-inline comment-pending-input';
                  container.contentEditable = 'false';
                  container.innerHTML = `
                    <div class="comment-pending-label">Add your comment:</div>
                    <input type="text" class="comment-pending-field" placeholder="Write a comment..." data-pending-comment-id="${escapeHtml(pendingId)}" />
                    <div class="comment-pending-hint">Press Enter to submit, Escape to cancel</div>
                  `;
                  // Auto-focus the input after it's added to the DOM
                  requestAnimationFrame(() => {
                    const input = container.querySelector('.comment-pending-field') as HTMLInputElement;
                    input?.focus();
                  });
                  return container;
                }, {
                  side: 1,
                  key: `pending-comment-${pendingId}`,
                });
                decorations.push(pendingWidget);
              }
            }

            if (!comments || comments.length === 0) {
              return DecorationSet.create(doc, decorations);
            }

            const threads = groupByThread(comments);

            // Sort positions by document order (ascending)
            const sortedEntries = [...positions.entries()].sort(
              (a, b) => a[1] - b[1]
            );

            // Add inline decorations to dim resolved comment highlights
            for (const [commentId, thread] of threads.entries()) {
              const isResolved = thread[0].resolved_at !== null;
              if (isResolved) {
                doc.descendants((node: ProseMirrorNode, pos: number) => {
                  if (node.isText) {
                    for (const mark of node.marks) {
                      if (mark.type.name === 'commentMark' && mark.attrs.commentId === commentId) {
                        decorations.push(
                          Decoration.inline(pos, pos + node.nodeSize, {
                            class: 'comment-highlight-resolved',
                          })
                        );
                      }
                    }
                  }
                });
              }
            }

            for (const [commentId, blockEndPos] of sortedEntries) {
              const thread = threads.get(commentId);
              if (!thread || thread.length === 0) continue;

              // Find the quoted text for this comment
              let quotedText = '';
              doc.descendants((node: ProseMirrorNode) => {
                if (node.isText) {
                  for (const mark of node.marks) {
                    if (
                      mark.type.name === 'commentMark' &&
                      mark.attrs.commentId === commentId
                    ) {
                      quotedText += node.text;
                    }
                  }
                }
              });

              const widget = Decoration.widget(blockEndPos, () => {
                return InlineCommentThread({
                  thread,
                  quotedText,
                  onReply: storage.onReply,
                  onResolve: storage.onResolve,
                });
              }, {
                side: 1, // Render after the position
                key: `comment-${commentId}-${thread.length}-${thread[0].resolved_at || 'open'}`,
              });

              decorations.push(widget);
            }

            return DecorationSet.create(doc, decorations);
          },

          handleDOMEvents: {
            click: (view, event) => {
              const target = event.target as HTMLElement;

              // Handle resolve button click
              const resolveBtn = target.closest('.comment-resolve-btn') as HTMLElement;
              if (resolveBtn) {
                const commentId = resolveBtn.dataset.commentId;
                if (commentId && storage.onResolve) {
                  storage.onResolve(commentId, true);
                }
                event.preventDefault();
                return true;
              }

              // Handle "Show thread" click on resolved comments
              const resolvedToggle = target.closest('.comment-resolved-toggle') as HTMLElement;
              if (resolvedToggle) {
                const threadEl = resolvedToggle.closest('.comment-thread-inline') as HTMLElement;
                if (threadEl) {
                  const commentId = threadEl.dataset.commentThread;
                  if (commentId && storage.onResolve) {
                    storage.onResolve(commentId, false);
                  }
                }
                event.preventDefault();
                return true;
              }

              return false;
            },

            keydown: (view, event) => {
              const target = event.target as HTMLElement;

              // Cancel pending comment on Escape even if focus did not land in the widget input yet
              if (
                event.key === 'Escape' &&
                storage.pendingCommentId &&
                storage.onCancelComment
              ) {
                storage.onCancelComment(storage.pendingCommentId);
                event.preventDefault();
                return true;
              }

              // Handle Enter/Escape on pending comment input
              if (target.classList.contains('comment-pending-field')) {
                const input = target as HTMLInputElement;
                const commentId = input.dataset.pendingCommentId;

                if (event.key === 'Enter' && !event.shiftKey) {
                  const content = input.value.trim();
                  if (commentId && content && storage.onSubmitComment) {
                    storage.onSubmitComment(commentId, content);
                  }
                  event.preventDefault();
                  return true;
                }

                if (event.key === 'Escape') {
                  if (commentId && storage.onCancelComment) {
                    storage.onCancelComment(commentId);
                  }
                  event.preventDefault();
                  return true;
                }

                // Prevent other keys from propagating to ProseMirror
                event.stopPropagation();
                return true;
              }

              // Handle Enter on reply input
              if (
                target.classList.contains('comment-reply-input') &&
                event.key === 'Enter' &&
                !event.shiftKey
              ) {
                const input = target as HTMLInputElement;
                const commentId = input.dataset.commentId;
                const content = input.value.trim();

                if (commentId && content && storage.onReply) {
                  storage.onReply(commentId, content);
                  input.value = '';
                }
                event.preventDefault();
                return true;
              }

              return false;
            },
          },
        },
      }),
    ];
  },
});
