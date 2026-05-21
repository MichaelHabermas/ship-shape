import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { DetailsComponent } from './DetailsComponent';

export interface DetailsOptions {
  HTMLAttributes: Record<string, unknown>;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    details: {
      /**
       * Insert a details/toggle block
       */
      setDetails: () => ReturnType;
      /**
       * Remove details block
       */
      unsetDetails: () => ReturnType;
      /**
       * Toggle the open state of a details block
       */
      toggleDetailsOpen: () => ReturnType;
    };
  }
}

/**
 * Details/Toggle Extension
 *
 * Creates a collapsible toggle block with:
 * - Editable title/summary
 * - Expandable/collapsible content area
 * - Nested block support
 */
export const DetailsExtension = Node.create<DetailsOptions>({
  name: 'details',

  addOptions() {
    return {
      HTMLAttributes: {},
    };
  },

  group: 'block',

  // Content model: first child is the summary (inline content), rest is block content
  content: 'detailsSummary detailsContent',

  defining: true,

  addAttributes() {
    return {
      open: {
        default: true, // Start expanded so user can add content
        parseHTML: (element) => element.hasAttribute('open'),
        renderHTML: (attributes) => {
          if (attributes.open) {
            return { open: '', 'data-open': 'true' };
          }
          return { 'data-open': 'false' };
        },
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'details',
        getAttrs: (node) => {
          if (typeof node === 'string') return {};
          const element = node;
          return {
            open: element.hasAttribute('open'),
          };
        },
      },
      {
        tag: 'div[data-type="details"]',
        getAttrs: (node) => {
          if (typeof node === 'string') return {};
          const element = node;
          return {
            open: element.getAttribute('data-open') === 'true',
          };
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        'data-type': 'details',
        class: 'details-block',
      }),
      0, // children go here
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(DetailsComponent);
  },

  addCommands() {
    return {
      setDetails:
        () =>
        ({ chain }) => {
          return chain()
            .insertContent({
              type: this.name,
              attrs: { open: true },
              content: [
                {
                  type: 'detailsSummary',
                  content: [{ type: 'text', text: 'Toggle' }],
                },
                {
                  type: 'detailsContent',
                  content: [{ type: 'paragraph' }],
                },
              ],
            })
            .run();
        },
      unsetDetails:
        () =>
        ({ commands }) => {
          return commands.lift(this.name);
        },
      toggleDetailsOpen:
        () =>
        ({ tr, state }) => {
          const { selection } = state;
          const node = state.doc.nodeAt(selection.from);
          if (node?.type.name === this.name) {
            tr.setNodeMarkup(selection.from, undefined, {
              ...node.attrs,
              open: !node.attrs.open,
            });
            return true;
          }
          return false;
        },
    };
  },

  addKeyboardShortcuts() {
    return {
      'Mod-Shift-t': () => this.editor.commands.setDetails(),
    };
  },
});

/**
 * Details Summary Node - the clickable title part
 * No group - can only exist inside a details node
 */
export const DetailsSummary = Node.create({
  name: 'detailsSummary',

  content: 'inline*',

  defining: true,

  parseHTML() {
    return [
      { tag: 'summary' },
      { tag: 'div[data-type="details-summary"]' },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'details-summary',
        class: 'details-summary',
      }),
      0,
    ];
  },
});

/**
 * Details Content Node - the collapsible content part
 * No group - can only exist inside a details node
 */
export const DetailsContent = Node.create({
  name: 'detailsContent',

  content: 'block+',

  defining: true,

  parseHTML() {
    return [
      { tag: 'div[data-type="details-content"]' },
      { tag: 'div.details-content' },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'details-content',
        class: 'details-content',
      }),
      0,
    ];
  },
});
