import { Mark, mergeAttributes } from '@tiptap/core';

export interface CommentMarkOptions {
  HTMLAttributes: Record<string, unknown>;
  onAddComment?: (commentId: string) => void;
}

export interface CommentMarkStorage {
  activeCommentId: string | null;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    commentMark: {
      setComment: (commentId: string) => ReturnType;
      unsetComment: (commentId: string) => ReturnType;
      addComment: () => ReturnType;
    };
  }
}

export const CommentMark = Mark.create<CommentMarkOptions, CommentMarkStorage>({
  name: 'commentMark',

  addOptions() {
    return {
      HTMLAttributes: {},
      onAddComment: undefined,
    };
  },

  addStorage() {
    return {
      activeCommentId: null,
    };
  },

  addAttributes() {
    return {
      commentId: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute('data-comment-id'),
        renderHTML: (attributes: Record<string, unknown>) => {
          if (!attributes.commentId) return {};
          return { 'data-comment-id': attributes.commentId };
        },
      },
    };
  },

  // Don't extend the mark when typing at boundaries
  inclusive: false,

  // Allow overlapping comments on the same text
  excludes: '',

  parseHTML() {
    return [
      {
        tag: 'span[data-comment-id]',
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        class: 'comment-highlight',
      }),
      0,
    ];
  },

  addCommands() {
    return {
      setComment:
        (commentId: string) =>
        ({ commands }) => {
          return commands.setMark(this.name, { commentId });
        },
      unsetComment:
        (commentId: string) =>
        ({ tr, state, dispatch }) => {
          const { doc } = state;
          let modified = false;

          doc.descendants((node, pos) => {
            if (!node.isText) return;

            node.marks.forEach((mark) => {
              if (mark.type.name === this.name && mark.attrs.commentId === commentId) {
                const textLength = node.text?.length ?? 0;
                if (textLength === 0) return;
                // Text leaf nodeSize is 1 in the tree; use text length for doc positions.
                tr.removeMark(pos, pos + textLength, mark);
                modified = true;
              }
            });
          });

          if (modified && dispatch) {
            dispatch(tr);
          }

          return modified;
        },
      addComment:
        () =>
        ({ editor, commands }) => {
          if (editor.state.selection.empty) return false;
          const commentId = crypto.randomUUID();
          commands.setMark(this.name, { commentId });
          this.options.onAddComment?.(commentId);
          return true;
        },
    };
  },

  addKeyboardShortcuts() {
    return {
      'Mod-Shift-m': () => this.editor.commands.addComment(),
    };
  },

  onSelectionUpdate() {
    const { $from } = this.editor.state.selection;
    const marks = $from.marks();
    const commentMark = marks.find((mark) => mark.type.name === this.name);
    this.storage.activeCommentId = commentMark?.attrs.commentId ?? null;
  },
});
