import { Extension, type Editor, type Range } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { ReactRenderer } from '@tiptap/react';
import Suggestion, { SuggestionKeyDownProps, SuggestionOptions, SuggestionProps } from '@tiptap/suggestion';
import tippy, { Instance as TippyInstance } from 'tippy.js';
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useState,
  useCallback,
} from 'react';
import { cn } from '@/lib/cn';
import { fetchWikiDocumentsForEmbed } from '@/lib/mention-search';

const API_URL = import.meta.env.VITE_API_URL ?? '';
export interface SlashCommandItem {
  title: string;
  description: string;
  aliases: string[];
  icon: React.ReactNode;
  command: (props: { editor: Editor; range: Range }) => void;
  /** If set, command only shows for these document types (e.g., ['program']) */
  documentTypes?: string[];
  /** If true, command requires onCreateSubDocument callback to function */
  requiresSubDocumentCallback?: boolean;
}

interface CommandListProps {
  items: SlashCommandItem[];
  command: (item: SlashCommandItem) => void;
}

interface CommandListRef {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean;
}

const CommandList = forwardRef<CommandListRef, CommandListProps>(
  ({ items, command }, ref) => {
    const [selectedIndex, setSelectedIndex] = useState(0);

    const selectItem = useCallback(
      (index: number) => {
        const item = items[index];
        if (item) {
          command(item);
        }
      },
      [items, command]
    );

    useEffect(() => {
      setSelectedIndex(0);
    }, [items]);

    useImperativeHandle(ref, () => ({
      onKeyDown: ({ event }: { event: KeyboardEvent }) => {
        if (event.key === 'ArrowUp') {
          setSelectedIndex((prev) => (prev + items.length - 1) % items.length);
          return true;
        }

        if (event.key === 'ArrowDown') {
          setSelectedIndex((prev) => (prev + 1) % items.length);
          return true;
        }

        if (event.key === 'Enter') {
          selectItem(selectedIndex);
          return true;
        }

        return false;
      },
    }));

    if (items.length === 0) {
      return null;
    }

    return (
      <div className="z-50 min-w-[200px] overflow-hidden rounded-lg border border-border bg-background shadow-lg">
        {items.map((item, index) => (
          <button
            key={item.title}
            onClick={() => selectItem(index)}
            className={cn(
              'flex w-full items-center gap-3 px-3 py-2 text-left text-sm',
              'hover:bg-border/50 transition-colors',
              index === selectedIndex && 'bg-border/50'
            )}
          >
            <span className="flex h-8 w-8 items-center justify-center rounded bg-border/30 text-muted">
              {item.icon}
            </span>
            <div className="flex-1">
              <div className="font-medium text-foreground">{item.title}</div>
              <div className="text-xs text-muted">{item.description}</div>
            </div>
          </button>
        ))}
      </div>
    );
  }
);

CommandList.displayName = 'CommandList';

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

// Icons for slash commands
const icons = {
  document: (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
    </svg>
  ),
  heading1: (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <text x="4" y="17" fontSize="14" fontWeight="bold" fill="currentColor" stroke="none">H1</text>
    </svg>
  ),
  heading2: (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <text x="4" y="17" fontSize="14" fontWeight="bold" fill="currentColor" stroke="none">H2</text>
    </svg>
  ),
  heading3: (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <text x="4" y="17" fontSize="14" fontWeight="bold" fill="currentColor" stroke="none">H3</text>
    </svg>
  ),
  bulletList: (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
      <circle cx="2" cy="6" r="1" fill="currentColor" />
      <circle cx="2" cy="12" r="1" fill="currentColor" />
      <circle cx="2" cy="18" r="1" fill="currentColor" />
    </svg>
  ),
  numberedList: (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 6h13M7 12h13M7 18h13" />
      <text x="1" y="8" fontSize="8" fill="currentColor" stroke="none">1</text>
      <text x="1" y="14" fontSize="8" fill="currentColor" stroke="none">2</text>
      <text x="1" y="20" fontSize="8" fill="currentColor" stroke="none">3</text>
    </svg>
  ),
  quote: (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
    </svg>
  ),
  code: (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
    </svg>
  ),
  divider: (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 12h16" />
    </svg>
  ),
  image: (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
    </svg>
  ),
  file: (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
    </svg>
  ),
  toggle: (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
    </svg>
  ),
  table: (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M3 14h18m-9-4v8m-7 0h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
    </svg>
  ),
  tableOfContents: (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h12M4 14h12M4 18h8" />
    </svg>
  ),
  plan: (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
    </svg>
  ),
  criteria: (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  ),
  taskList: (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4" />
    </svg>
  ),
  vision: (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
    </svg>
  ),
  goals: (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 18.657A8 8 0 016.343 7.343S7 9 9 10c0-2 .5-5 2.986-7C14 5 16.09 5.777 17.656 7.343A7.975 7.975 0 0120 13a7.975 7.975 0 01-2.343 5.657z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.879 16.121A3 3 0 1012.015 11L11 14H9c0 .768.293 1.536.879 2.121z" />
    </svg>
  ),
};

export function createSlashCommands({ onCreateSubDocument, onNavigateToDocument, documentType, documentId, abortSignal }: CreateSlashCommandsOptions) {
  const slashCommands: SlashCommandItem[] = [
    // Sub-document (requires async callback)
    {
      title: 'Sub-document',
      description: 'Create a nested document',
      aliases: ['doc', 'document', 'sub-document', 'page', 'sub-page', 'subpage', 'subdoc'],
      icon: icons.document,
      requiresSubDocumentCallback: true,
      command: async ({ editor, range }) => {
        editor.chain().focus().deleteRange(range).run();
        const doc = await onCreateSubDocument?.();
        if (doc) {
          // Navigate to the new document immediately
          onNavigateToDocument?.(doc.id);
        }
      },
    },
    // Headings
    {
      title: 'Heading 1',
      description: 'Large section heading',
      aliases: ['h1', 'heading1', 'title'],
      icon: icons.heading1,
      command: ({ editor, range }) => {
        editor.chain().focus().deleteRange(range).setNode('heading', { level: 1 }).run();
      },
    },
    {
      title: 'Heading 2',
      description: 'Medium section heading',
      aliases: ['h2', 'heading2', 'subtitle'],
      icon: icons.heading2,
      command: ({ editor, range }) => {
        editor.chain().focus().deleteRange(range).setNode('heading', { level: 2 }).run();
      },
    },
    {
      title: 'Heading 3',
      description: 'Small section heading',
      aliases: ['h3', 'heading3'],
      icon: icons.heading3,
      command: ({ editor, range }) => {
        editor.chain().focus().deleteRange(range).setNode('heading', { level: 3 }).run();
      },
    },
    // Lists
    {
      title: 'Bullet List',
      description: 'Create a simple bullet list',
      aliases: ['ul', 'unordered', 'bullet', 'list', 'bullets'],
      icon: icons.bulletList,
      command: ({ editor, range }) => {
        editor.chain().focus().deleteRange(range).toggleBulletList().run();
      },
    },
    {
      title: 'Numbered List',
      description: 'Create a numbered list',
      aliases: ['ol', 'ordered', 'number', 'numbered'],
      icon: icons.numberedList,
      command: ({ editor, range }) => {
        editor.chain().focus().deleteRange(range).toggleOrderedList().run();
      },
    },
    {
      title: 'Task List',
      description: 'Create a checklist with checkboxes',
      aliases: ['task', 'tasks', 'todo', 'todos', 'checkbox', 'checklist', 'check'],
      icon: icons.taskList,
      command: ({ editor, range }) => {
        editor.chain().focus().deleteRange(range).toggleTaskList().run();
      },
    },
    // Blocks
    {
      title: 'Quote',
      description: 'Capture a quote',
      aliases: ['blockquote', 'quotation', 'cite'],
      icon: icons.quote,
      command: ({ editor, range }) => {
        editor.chain().focus().deleteRange(range).toggleBlockquote().run();
      },
    },
    {
      title: 'Code Block',
      description: 'Capture a code snippet',
      aliases: ['code', 'codeblock', 'pre', 'snippet'],
      icon: icons.code,
      command: ({ editor, range }) => {
        editor.chain().focus().deleteRange(range).toggleCodeBlock().run();
      },
    },
    {
      title: 'Divider',
      description: 'Visually divide content',
      aliases: ['hr', 'horizontal', 'rule', 'separator', 'line'],
      icon: icons.divider,
      command: ({ editor, range }) => {
        editor.chain().focus().deleteRange(range).setHorizontalRule().run();
      },
    },
    // Image upload
    {
      title: 'Image',
      description: 'Upload an image',
      aliases: ['img', 'picture', 'photo', 'upload'],
      icon: icons.image,
      command: ({ editor, range }) => {
        editor.chain().focus().deleteRange(range).run();
        // Trigger file picker
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.onchange = async () => {
          const file = input.files?.[0];
          if (!file) return;

          // Import and use upload service
          const { uploadFile } = await import('@/services/upload');

          // Create data URL for immediate preview
          const reader = new FileReader();
          reader.onload = async () => {
            // Check if aborted before processing
            if (abortSignal?.aborted) return;

            const dataUrl = reader.result as string;

            // Insert image with data URL preview
            editor.chain().focus().setImage({ src: dataUrl, alt: file.name }).run();

            try {
              // Upload and replace with CDN URL
              const result = await uploadFile(file, undefined, abortSignal, documentId);

              // Check if aborted before updating editor
              if (abortSignal?.aborted) {
                console.log('Slash command image upload completed but was cancelled - not updating editor');
                return;
              }

              // Find and update the image node
              const { state, view } = editor;
              let imagePos: number | null = null;

              state.doc.descendants((node: ProseMirrorNode, pos: number) => {
                if (node.type.name === 'image' && node.attrs.src === dataUrl) {
                  imagePos = pos;
                  return false;
                }
                return true;
              });

              if (imagePos !== null) {
                const cdnUrl = result.cdnUrl.startsWith('http')
                  ? result.cdnUrl
                  : `${API_URL}${result.cdnUrl}`;
                const transaction = state.tr.setNodeMarkup(imagePos, undefined, {
                  ...state.doc.nodeAt(imagePos)?.attrs,
                  src: cdnUrl,
                });
                view.dispatch(transaction);
              }
            } catch (error) {
              // Don't report cancellation as an error - it's intentional
              if (error instanceof DOMException && error.name === 'AbortError') {
                console.log('Slash command image upload cancelled');
                return;
              }
              console.error('Image upload failed:', error);
            }
          };
          reader.readAsDataURL(file);
        };
        input.click();
      },
    },
    // File attachment
    {
      title: 'File',
      description: 'Upload a file attachment',
      aliases: ['file', 'attachment', 'attach', 'pdf', 'doc', 'document'],
      icon: icons.file,
      command: async ({ editor, range }) => {
        editor.chain().focus().deleteRange(range).run();
        // Import and trigger file upload
        const { triggerFileUpload } = await import('./FileAttachment');
        triggerFileUpload(editor, abortSignal, documentId);
      },
    },
    // Toggle/Details
    {
      title: 'Toggle',
      description: 'Create a collapsible section',
      aliases: ['toggle', 'collapsible', 'details', 'expand', 'collapse', 'accordion'],
      icon: icons.toggle,
      command: ({ editor, range }) => {
        editor.chain().focus().deleteRange(range).setDetails().run();
      },
    },
    // Table
    {
      title: 'Table',
      description: 'Insert a table',
      aliases: ['table', 'grid'],
      icon: icons.table,
      command: ({ editor, range }) => {
        editor.chain().focus().deleteRange(range).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
      },
    },
    // Table of Contents
    {
      title: 'Table of Contents',
      description: 'Insert a table of contents',
      aliases: ['toc', 'outline', 'contents'],
      icon: icons.tableOfContents,
      command: ({ editor, range }) => {
        editor
          .chain()
          .focus()
          .deleteRange(range)
          .insertContent({ type: 'tableOfContents' })
          .run();
      },
    },
    // Plan block (for Sprint and Project documents - syncs with properties.plan)
    {
      title: 'Plan',
      description: 'Add a plan block',
      aliases: ['plan', 'hypothesis', 'hypo', 'theory'],
      icon: icons.plan,
      documentTypes: ['sprint', 'project'],
      command: ({ editor, range }) => {
        editor
          .chain()
          .focus()
          .deleteRange(range)
          .insertContent({
            type: 'hypothesisBlock',
            attrs: { placeholder: 'What do you expect to accomplish?' },
          })
          .run();
      },
    },
    // Success Criteria section (for Project and Sprint documents)
    {
      title: 'Success Criteria',
      description: 'Add success criteria section',
      aliases: ['criteria', 'success', 'success-criteria', 'acceptance'],
      icon: icons.criteria,
      command: ({ editor, range }) => {
        editor
          .chain()
          .focus()
          .deleteRange(range)
          .insertContent([
            {
              type: 'heading',
              attrs: { level: 2 },
              content: [{ type: 'text', text: 'Success Criteria' }],
            },
            {
              type: 'paragraph',
            },
          ])
          .run();
        // Move cursor to the empty paragraph
        editor.commands.focus('end');
      },
    },
    // Vision section (Program documents only)
    {
      title: 'Vision',
      description: 'Add a vision statement section',
      aliases: ['vision', 'direction', 'strategy'],
      icon: icons.vision,
      documentTypes: ['program'],
      command: ({ editor, range }) => {
        editor
          .chain()
          .focus()
          .deleteRange(range)
          .insertContent([
            {
              type: 'heading',
              attrs: { level: 2 },
              content: [{ type: 'text', text: 'Vision' }],
            },
            {
              type: 'paragraph',
            },
          ])
          .run();
        // Move cursor to the empty paragraph
        editor.commands.focus('end');
      },
    },
    // Goals section (Program documents only)
    {
      title: 'Goals',
      description: 'Add program goals section',
      aliases: ['goals', 'objectives', 'targets'],
      icon: icons.goals,
      documentTypes: ['program'],
      command: ({ editor, range }) => {
        editor
          .chain()
          .focus()
          .deleteRange(range)
          .insertContent([
            {
              type: 'heading',
              attrs: { level: 2 },
              content: [{ type: 'text', text: 'Goals' }],
            },
            {
              type: 'paragraph',
            },
          ])
          .run();
        // Move cursor to the empty paragraph
        editor.commands.focus('end');
      },
    },
  ];

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
                icon: icons.document,
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
                component = new ReactRenderer(CommandList, {
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
