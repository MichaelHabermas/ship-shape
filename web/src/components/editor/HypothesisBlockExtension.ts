import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { HypothesisBlockComponent } from './HypothesisBlockComponent';

export interface HypothesisBlockOptions {
  HTMLAttributes: Record<string, unknown>;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    hypothesisBlock: {
      /**
       * Insert a hypothesis block
       */
      setHypothesisBlock: () => ReturnType;
      /**
       * Remove hypothesis block
       */
      unsetHypothesisBlock: () => ReturnType;
    };
  }
}

/**
 * HypothesisBlock Extension
 *
 * A specialized block for sprint hypothesis statements that:
 * - Has distinct visual styling (callout-like with lightbulb icon)
 * - Syncs bidirectionally with sprint.properties.hypothesis
 * - Only appears in sprint documents via /hypothesis slash command
 */
export const HypothesisBlockExtension = Node.create<HypothesisBlockOptions>({
  name: 'hypothesisBlock',

  addOptions() {
    return {
      HTMLAttributes: {},
    };
  },

  group: 'block',

  // Content model: inline content only (plain text)
  content: 'inline*',

  defining: true,

  // Store placeholder text as an attribute
  addAttributes() {
    return {
      placeholder: {
        default: 'What will get done this sprint?',
        parseHTML: (element) => element.getAttribute('data-placeholder') || 'What will get done this sprint?',
        renderHTML: (attributes) => {
          const attrs = attributes as { placeholder?: unknown };
          return { 'data-placeholder': typeof attrs.placeholder === 'string' ? attrs.placeholder : 'What will get done this sprint?' };
        },
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-type="hypothesis-block"]',
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        'data-type': 'hypothesis-block',
        class: 'hypothesis-block',
      }),
      0, // children go here
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(HypothesisBlockComponent);
  },

  addCommands() {
    return {
      setHypothesisBlock:
        () =>
        ({ chain }) => {
          return chain()
            .insertContent({
              type: this.name,
              attrs: { placeholder: 'What will get done this sprint?' },
              content: [],
            })
            .run();
        },
      unsetHypothesisBlock:
        () =>
        ({ commands }) => {
          return commands.lift(this.name);
        },
    };
  },
});
