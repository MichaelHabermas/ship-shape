import type { Editor, Range } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { slashCommandIcons } from './slash-command-icons';

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

export interface CreateSlashCommandItemsOptions {
  onCreateSubDocument?: () => Promise<{ id: string; title: string } | null>;
  onNavigateToDocument?: (id: string) => void;
  /** Document type for filtering document-specific commands */
  documentType?: string;
  /** Current document ID for document-bound uploads */
  documentId?: string;
  /** AbortSignal for cancelling async operations on navigation/cleanup */
  abortSignal?: AbortSignal;
}

export function createSlashCommandItems({
  onCreateSubDocument,
  onNavigateToDocument,
  documentId,
  abortSignal,
}: CreateSlashCommandItemsOptions): SlashCommandItem[] {
  const icons = slashCommandIcons;

  return [
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
        const { triggerFileUpload } = await import('../FileAttachment');
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
}
