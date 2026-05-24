/**
 * TipTap File Attachment Extension
 * Handles file attachments (PDF, DOCX, etc.) as embedded cards with download links
 * Supports drag-and-drop and paste for non-image files
 */
import { Editor, Node, mergeAttributes, type CommandProps } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { ReactNodeViewRenderer, NodeViewWrapper, type ReactNodeViewProps } from '@tiptap/react';
import { uploadFile, isAllowedFileType, getMimeTypeFromExtension, isImageFile, MAX_FILE_SIZE, MAX_FILE_SIZE_DISPLAY } from '@/services/upload';
import { registerUpload, updateUploadProgress, unregisterUpload } from '@/services/uploadTracker';
import { useState } from 'react';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    fileAttachment: {
      setFileAttachment: (options: FileAttachmentAttrs) => ReturnType;
    };
  }
}

const API_URL = import.meta.env.VITE_API_URL ?? '';

// File type icons mapping
const FILE_ICONS: Record<string, string> = {
  'application/pdf': '📄',
  'application/msword': '📝',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '📝',
  'application/vnd.ms-excel': '📊',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '📊',
  'application/vnd.ms-powerpoint': '📽️',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': '📽️',
  'text/plain': '📃',
  'text/csv': '📊',
  'text/markdown': '📃',
  'application/zip': '📦',
  'application/x-zip-compressed': '📦',
};

const DEFAULT_ICON = '📎';

function getFileIcon(mimeType: string): string {
  return FILE_ICONS[mimeType] || DEFAULT_ICON;
}

function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}

// React component for rendering file attachment
interface FileAttachmentAttrs {
  filename: string;
  url: string;
  size: number;
  mimeType: string;
  uploading: boolean;
}

function FileAttachmentComponent({ node }: ReactNodeViewProps) {
  const { filename, url, size, mimeType, uploading } = node.attrs as FileAttachmentAttrs;
  const [uploadProgress, _setUploadProgress] = useState(uploading ? 0 : 100);

  const fileIcon = getFileIcon(mimeType);
  const formattedSize = size ? formatFileSize(size) : '';

  return (
    <NodeViewWrapper className="file-attachment-wrapper" data-file-attachment>
      <div className="file-attachment" contentEditable={false}>
        <div className="file-attachment-icon">{fileIcon}</div>
        <div className="file-attachment-info">
          <div className="file-attachment-name">{filename}</div>
          {formattedSize && (
            <div className="file-attachment-meta">{formattedSize}</div>
          )}
          {uploading && (
            <div className="file-attachment-progress">
              <div className="file-attachment-progress-bar" style={{ width: `${uploadProgress}%` }} />
            </div>
          )}
        </div>
        {!uploading && url && (
          <a
            href={url}
            download={filename}
            target="_blank"
            rel="noopener noreferrer"
            className="file-attachment-download"
            title="Download file"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </a>
        )}
      </div>
    </NodeViewWrapper>
  );
}

export const FileAttachmentExtension = Node.create({
  name: 'fileAttachment',

  group: 'block',

  atom: true,

  addOptions() {
    return {
      documentId: undefined as string | undefined,
    };
  },

  addAttributes() {
    return {
      filename: {
        default: '',
      },
      url: {
        default: '',
      },
      size: {
        default: 0,
      },
      mimeType: {
        default: '',
      },
      uploading: {
        default: false,
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-file-attachment]',
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-file-attachment': '' })];
  },

  addNodeView() {
    return ReactNodeViewRenderer(FileAttachmentComponent);
  },

  addCommands() {
    return {
      setFileAttachment:
        (options: FileAttachmentAttrs) =>
        ({ commands }: CommandProps) =>
          commands.insertContent({
            type: this.name,
            attrs: options,
          }),
    };
  },

  addProseMirrorPlugins() {
    const extensionThis = this;

    return [
      new Plugin({
        key: new PluginKey('fileAttachmentDrop'),
        props: {
          handleDrop(view, event) {
            const files = Array.from(event.dataTransfer?.files || []);
            // Filter to non-image files only (images are handled by ImageUploadExtension)
            const nonImageFiles = files.filter((file) => !isImageFile(file.type));

            if (nonImageFiles.length === 0) {
              return false; // Let other handlers deal with it
            }

            event.preventDefault();

            // Upload all dropped non-image files
            nonImageFiles.forEach((file) => {
              handleFileUpload(extensionThis.editor, file, undefined, extensionThis.options.documentId);
            });

            return true;
          },

          handlePaste(view, event) {
            const items = Array.from(event.clipboardData?.items || []);
            // Find non-image file items
            const fileItems = items.filter(
              (item) => item.kind === 'file' && !item.type.startsWith('image/')
            );

            if (fileItems.length === 0) {
              return false; // Let other handlers deal with it
            }

            event.preventDefault();

            fileItems.forEach((item) => {
              const file = item.getAsFile();
              if (file) {
                handleFileUpload(extensionThis.editor, file, undefined, extensionThis.options.documentId);
              }
            });

            return true;
          },
        },
      }),
    ];
  },
});

/**
 * Handle file upload and insertion into editor
 * Used by both drag-and-drop and file picker
 * @param editor - TipTap editor instance
 * @param file - File to upload
 * @param signal - Optional AbortSignal for cancelling uploads on navigation/cleanup
 */
async function handleFileUpload(editor: Editor, file: File, signal?: AbortSignal, documentId?: string) {
  // Check if already aborted
  if (signal?.aborted) {
    return;
  }

  // Check file size before uploading
  if (file.size > MAX_FILE_SIZE) {
    console.error('File too large:', { name: file.name, size: file.size, maxSize: MAX_FILE_SIZE });
    alert(`File "${file.name}" is too large.\n\nMaximum file size is ${MAX_FILE_SIZE_DISPLAY}.`);
    return;
  }

  // Check if file type is blocked (executables/scripts are blocked for security)
  if (!isAllowedFileType(file.type, file.name)) {
    const ext = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
    console.error('File type blocked:', { name: file.name, type: file.type, extension: ext });
    alert(`Cannot upload "${ext}" files.\n\nExecutable files and scripts are blocked for security reasons.`);
    return;
  }

  // Get effective MIME type (use extension fallback if browser returns empty)
  const effectiveMimeType = file.type || getMimeTypeFromExtension(file.name) || 'application/octet-stream';

  // Generate unique upload ID for tracking navigation warnings
  const uploadId = crypto.randomUUID();
  registerUpload(uploadId, file.name);

  // Insert placeholder with uploading state
  editor
    .chain()
    .focus()
    .setFileAttachment({
      filename: file.name,
      url: '',
      size: file.size,
      mimeType: effectiveMimeType,
      uploading: true,
    })
    .run();

  try {
    // Upload file with abort signal
    const result = await uploadFile(file, (progress) => {
      // Update global tracker for navigation warning
      updateUploadProgress(uploadId, progress.progress);
    }, signal, documentId);

    // Check if aborted before updating the editor
    if (signal?.aborted) {
      console.log('File upload completed but was cancelled - not updating editor');
      return;
    }

    // Find and update the attachment node
    const { state, view } = editor;
    let attachmentPos: number | null = null;

    state.doc.descendants((node: ProseMirrorNode, nodePos: number) => {
      if (
        node.type.name === 'fileAttachment' &&
        node.attrs.filename === file.name &&
        node.attrs.uploading === true
      ) {
        attachmentPos = nodePos;
        return false; // Stop searching
      }
      return true;
    });

    if (attachmentPos !== null) {
      const cdnUrl = result.cdnUrl.startsWith('http')
        ? result.cdnUrl
        : `${API_URL}${result.cdnUrl}`;

      // Update the node with the CDN URL and remove uploading state
      const transaction = state.tr.setNodeMarkup(attachmentPos, undefined, {
        filename: file.name,
        url: cdnUrl,
        size: file.size,
        mimeType: effectiveMimeType,
        uploading: false,
      });
      view.dispatch(transaction);
    }

    // Upload complete - unregister from tracker
    unregisterUpload(uploadId);
  } catch (error) {
    // Upload failed - unregister from tracker
    unregisterUpload(uploadId);

    // Don't report cancellation as an error - it's intentional
    if (error instanceof DOMException && error.name === 'AbortError') {
      console.log('File upload cancelled');
      return;
    }

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('File upload failed:', { filename: file.name, error: errorMessage, fullError: error });
    alert(`Upload failed: ${errorMessage}\n\nPlease try again.`);

    // Remove the failed upload node
    const { state, view } = editor;
    let attachmentPos: number | null = null;

    state.doc.descendants((node: ProseMirrorNode, nodePos: number) => {
      if (
        node.type.name === 'fileAttachment' &&
        node.attrs.filename === file.name &&
        node.attrs.uploading === true
      ) {
        attachmentPos = nodePos;
        return false;
      }
      return true;
    });

    if (attachmentPos !== null) {
      const transaction = state.tr.delete(attachmentPos, attachmentPos + 1);
      view.dispatch(transaction);
    }
  }
}

/**
 * Trigger file picker for file upload
 * @param editor - TipTap editor instance
 * @param signal - Optional AbortSignal for cancelling uploads on navigation/cleanup
 */
export function triggerFileUpload(editor: Editor, signal?: AbortSignal, documentId?: string) {
  // Check if already aborted
  if (signal?.aborted) {
    return;
  }

  const input = document.createElement('input');
  input.type = 'file';
  // No accept restriction - allow any file type (blocklist enforced in isAllowedFileType)
  input.multiple = false;

  input.onchange = async () => {
    // Check if aborted while file picker was open
    if (signal?.aborted) {
      return;
    }

    const file = input.files?.[0];
    if (!file) return;

    await handleFileUpload(editor, file, signal, documentId);
  };

  input.click();
}
