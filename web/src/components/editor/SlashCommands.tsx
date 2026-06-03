import { Extension, type Editor, type Range } from '@tiptap/core';
import { ReactRenderer } from '@tiptap/react';
import Suggestion, { SuggestionKeyDownProps, SuggestionOptions, SuggestionProps } from '@tiptap/suggestion';
import tippy, { Instance as TippyInstance } from 'tippy.js';
import { fetchWikiDocumentsForEmbed } from '@/lib/mention-search';
import { SlashCommandList, type CommandListRef } from './slash-commands/SlashCommandList';
import {
  createSlashCommandItems,
  type SlashCommandItem,
} from './slash-commands/slash-command-items';
import { slashCommandIcons } from './slash-commands/slash-command-icons';

export type { SlashCommandItem };

interface CreateSlashCommandsOptions {
  onCreateSubDocument?: () => Promise<{ id: string; title: string } | null>;
  onNavigateToDocument?: (id: string) => void;
  /** Document type for filtering document-specific commands */
  documentType?: string;
  /** Current document ID for document-bound uploads */
  documentId?: string;
  /** AbortSignal for cancelling async operations on navigation/cleanup */
  abortSignal?: AbortSignal;
}

export function createSlashCommands({
  onCreateSubDocument,
  onNavigateToDocument,
  documentType,
  documentId,
  abortSignal,
}: CreateSlashCommandsOptions) {
  const slashCommands = createSlashCommandItems({
    onCreateSubDocument,
    onNavigateToDocument,
    documentType,
    documentId,
    abortSignal,
  });

  return Extension.create({
    name: 'slashCommands',

    addOptions() {
      return {
        suggestion: {
          char: '/',
          command: ({ editor, range, props }: { editor: Editor; range: Range; props: SlashCommandItem }) => {
            props.command({ editor, range });
          },
        } as Partial<SuggestionOptions>,
      };
    },

    addProseMirrorPlugins() {
      const options = this.options as {
        suggestion: SuggestionOptions<
          SlashCommandItem,
          SlashCommandItem
        >;
      };
      const baseSuggestion = options.suggestion;
      return [
        Suggestion<SlashCommandItem>({
          ...baseSuggestion,
          editor: this.editor,
          items: async ({ query }: { query: string }): Promise<SlashCommandItem[]> => {
            const search = query.toLowerCase();
            const filteredCommands = slashCommands.filter(
              (item) => {
                // Filter out commands that require callback when callback is not provided
                if (item.requiresSubDocumentCallback && !onCreateSubDocument) {
                  return false;
                }
                // Filter by document type if command has restrictions
                if (item.documentTypes && item.documentTypes.length > 0) {
                  if (!documentType || !item.documentTypes.includes(documentType)) {
                    return false;
                  }
                }
                // Filter by search query
                return item.title.toLowerCase().includes(search) ||
                  item.aliases.some((alias) => alias.toLowerCase().includes(search));
              }
            );

            // If query matches document-related terms, also fetch existing documents
            const docAliases = ['doc', 'document', 'embed', 'link'];
            const isDocQuery = docAliases.some((alias) => alias.includes(search) || search.includes(alias));

            if (isDocQuery && search.length > 0) {
              const documents = await fetchWikiDocumentsForEmbed(search);
              const documentItems: SlashCommandItem[] = documents.map((doc) => ({
                title: doc.title,
                description: 'Embed this document',
                aliases: [],
                icon: slashCommandIcons.document,
                command: ({ editor, range }) => {
                  editor
                    .chain()
                    .focus()
                    .deleteRange(range)
                    .insertContent({
                      type: 'documentEmbed',
                      attrs: {
                        documentId: doc.id,
                        title: doc.title,
                      },
                    })
                    .run();
                },
              }));

              // Return static commands first, then document suggestions
              return [...filteredCommands, ...documentItems];
            }

            return filteredCommands;
          },
          render: () => {
            let component: ReactRenderer<CommandListRef> | null = null;
            let popup: TippyInstance[] | null = null;

            return {
              onStart: (props: SuggestionProps<SlashCommandItem, SlashCommandItem>) => {
                const clientRect = props.clientRect;
                component = new ReactRenderer(SlashCommandList, {
                  props,
                  editor: props.editor,
                });

                if (!clientRect) {
                  return;
                }

                popup = tippy('body', {
                  getReferenceClientRect: () => clientRect() ?? new DOMRect(),
                  appendTo: () => document.body,
                  content: component.element,
                  showOnCreate: true,
                  interactive: true,
                  trigger: 'manual',
                  placement: 'bottom-start',
                });
              },

              onUpdate(props: SuggestionProps<SlashCommandItem, SlashCommandItem>) {
                const clientRect = props.clientRect;
                component?.updateProps(props);

                if (!clientRect) {
                  return;
                }

                popup?.[0]?.setProps({
                  getReferenceClientRect: () => clientRect() ?? new DOMRect(),
                });
              },

              onKeyDown(props: SuggestionKeyDownProps) {
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
        }),
      ];
    },
  });
}
