import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { PlanReferenceBlockComponent } from './PlanReferenceBlockComponent';

export interface PlanReferenceBlockOptions {
  HTMLAttributes: Record<string, unknown>;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    planReference: {
      /**
       * Insert a plan reference block
       */
      insertPlanReference: (attrs: {
        planItemText: string;
        planDocumentId: string;
        itemIndex: number;
      }) => ReturnType;
    };
  }
}

/**
 * PlanReferenceBlock Extension
 *
 * A non-editable block that displays a plan item in a retro document.
 * Used to auto-populate retros with plan items so users can address
 * each planned deliverable with evidence of what was delivered.
 *
 * Attributes:
 * - planItemText: The text of the plan item (displayed read-only)
 * - planDocumentId: UUID of the source plan document
 * - itemIndex: Position index of this item in the original plan
 */
export const PlanReferenceBlockExtension = Node.create<PlanReferenceBlockOptions>({
  name: 'planReference',

  addOptions() {
    return {
      HTMLAttributes: {},
    };
  },

  group: 'block',

  atom: true, // Non-editable, selects as a whole unit

  addAttributes() {
    return {
      planItemText: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-plan-item-text') || '',
        renderHTML: (attributes) => {
          const attrs = attributes as { planItemText?: unknown };
          return { 'data-plan-item-text': typeof attrs.planItemText === 'string' ? attrs.planItemText : '' };
        },
      },
      planDocumentId: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-plan-document-id') || '',
        renderHTML: (attributes) => {
          const attrs = attributes as { planDocumentId?: unknown };
          return { 'data-plan-document-id': typeof attrs.planDocumentId === 'string' ? attrs.planDocumentId : '' };
        },
      },
      itemIndex: {
        default: 0,
        parseHTML: (element) => parseInt(element.getAttribute('data-item-index') || '0', 10),
        renderHTML: (attributes) => {
          const attrs = attributes as { itemIndex?: unknown };
          return { 'data-item-index': typeof attrs.itemIndex === 'number' ? String(attrs.itemIndex) : '0' };
        },
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-type="plan-reference"]',
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        'data-type': 'plan-reference',
        class: 'plan-reference-block',
      }),
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(PlanReferenceBlockComponent);
  },

  addCommands() {
    return {
      insertPlanReference:
        (attrs) =>
        ({ chain }) => {
          return chain()
            .insertContent({
              type: this.name,
              attrs,
            })
            .run();
        },
    };
  },
});
