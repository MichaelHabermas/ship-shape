import Mention from '@tiptap/extension-mention';
import { ReactRenderer, ReactNodeViewRenderer } from '@tiptap/react';
import tippy, { Instance as TippyInstance } from 'tippy.js';
import { MentionList, MentionItem } from './MentionList';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { MentionNodeView } from './MentionNodeView';
import { fetchMentionSuggestions } from '@/lib/mention-search';

interface MentionListRef {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean;
}

interface MentionAttributes {
  id?: string | null;
  label?: string | null;
  mentionType?: string | null;
  documentType?: string | null;
}

interface CreateMentionExtensionOptions {
  /** Callback to navigate to a document or person */
  onNavigate?: (type: 'person' | 'document', id: string) => void;
}
export function createMentionExtension(options: CreateMentionExtensionOptions = {}) {
  return Mention.extend({
    // Add custom attributes for mention type
    addAttributes() {
      return {
        id: {
          default: null,
          parseHTML: (element) => element.getAttribute('data-id'),
          renderHTML: (attributes: MentionAttributes) => ({
            'data-id': attributes.id,
          }),
        },
        label: {
          default: null,
          parseHTML: (element) => element.getAttribute('data-label'),
          renderHTML: (attributes: MentionAttributes) => ({
            'data-label': attributes.label,
          }),
        },
        mentionType: {
          default: 'person',
          parseHTML: (element) => element.getAttribute('data-mention-type') || 'person',
          renderHTML: (attributes: MentionAttributes) => ({
            'data-mention-type': attributes.mentionType,
          }),
        },
        documentType: {
          default: null,
          parseHTML: (element) => element.getAttribute('data-document-type'),
          renderHTML: (attributes: MentionAttributes) => {
            if (!attributes.documentType) return {};
            return {
              'data-document-type': attributes.documentType,
            };
          },
        },
      };
    },

    // Use React NodeView for dynamic rendering (supports archived status)
    addNodeView() {
      return ReactNodeViewRenderer(MentionNodeView, {
        // Render inline, not as a block
        as: 'span',
      });
    },

    // Fallback rendering for SSR or non-React contexts
    renderHTML({ node, HTMLAttributes }) {
      const attrs = node.attrs as MentionAttributes;
      const mentionType = attrs.mentionType || 'person';
      const documentType = attrs.documentType;
      const id = attrs.id;

      return [
        'a',
        {
          ...HTMLAttributes,
          class: `mention mention-${mentionType}${documentType ? ` mention-${documentType}` : ''}`,
          href: mentionType === 'person'
            ? `/team/${id}`
            : `/${documentType || 'documents'}/${id}`,
        },
        `@${attrs.label}`,
      ];
    },

    // Add click handler for mentions (while keeping parent's suggestion plugins)
    addProseMirrorPlugins() {
      const { onNavigate } = options;

      // Get parent's plugins (includes the Suggestion plugin for @ detection)
      const parentPlugins = this.parent?.() || [];

      return [
        ...parentPlugins,
        new Plugin({
          key: new PluginKey('mentionClickHandler'),
          props: {
            handleClick(view, pos, event) {
              const target = event.target as HTMLElement;
              if (target.classList.contains('mention')) {
                event.preventDefault();
                const mentionType = target.getAttribute('data-mention-type') as 'person' | 'document';
                const mentionId = target.getAttribute('data-id');

                if (mentionId && onNavigate) {
                  onNavigate(mentionType || 'person', mentionId);
                  return true;
                }
              }
              return false;
            },
          },
        }),
      ];
    },
  }).configure({
    HTMLAttributes: {
      class: 'mention',
    },
    suggestion: {
      char: '@',
      allowSpaces: true,
      items: async ({ query }): Promise<MentionItem[]> => {
        return fetchMentionSuggestions(query);
      },
      command: ({ editor, range, props }) => {
        // Insert the mention node with all custom attributes
        const mentionProps = props as MentionItem;
        editor
          .chain()
          .focus()
          .insertContentAt(range, [
            {
              type: 'mention',
              attrs: {
                id: mentionProps.id,
                label: mentionProps.label,
                mentionType: mentionProps.type,
                documentType: mentionProps.documentType,
              },
            },
            {
              type: 'text',
              text: ' ',
            },
          ])
          .run();
      },
      render: () => {
        let component: ReactRenderer<MentionListRef> | null = null;
        let popup: TippyInstance[] | null = null;

        return {
          onStart: (props) => {
            component = new ReactRenderer(MentionList, {
              props: {
                items: props.items,
                command: props.command,
                query: props.query,
              },
              editor: props.editor,
            });

            if (!props.clientRect) {
              return;
            }

            popup = tippy('body', {
              getReferenceClientRect: props.clientRect as () => DOMRect,
              appendTo: () => document.body,
              content: component.element,
              showOnCreate: true,
              interactive: true,
              trigger: 'manual',
              placement: 'bottom-start',
            });
          },

          onUpdate(props) {
            component?.updateProps({
              items: props.items,
              command: props.command,
              query: props.query,
            });

            if (!props.clientRect) {
              return;
            }

            popup?.[0]?.setProps({
              getReferenceClientRect: props.clientRect as () => DOMRect,
            });
          },

          onKeyDown(props) {
            if (props.event.key === 'Escape') {
              popup?.[0]?.hide();
              return true;
            }

            return component?.ref?.onKeyDown(props) ?? false;
          },

          onExit() {
            popup?.[0]?.destroy();
            component?.destroy();
          },
        };
      },
    },
  });
}
