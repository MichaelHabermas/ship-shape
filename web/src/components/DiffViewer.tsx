import { useMemo } from 'react';
import DiffMatchPatch from 'diff-match-patch';

interface DiffViewerProps {
  oldContent: string;
  newContent: string;
  className?: string;
}

/**
 * DiffViewer component - displays inline text diff with visual highlighting
 *
 * Deletions are shown with strikethrough and red background.
 * Additions are shown with green background.
 * Unchanged text renders normally.
 */
export function DiffViewer({ oldContent, newContent, className = '' }: DiffViewerProps) {
  const diffs = useMemo(() => {
    const dmp = new DiffMatchPatch();
    const diff = dmp.diff_main(oldContent, newContent);
    dmp.diff_cleanupSemantic(diff);
    return diff;
  }, [oldContent, newContent]);

  return (
    <div className={`font-mono text-sm whitespace-pre-wrap ${className}`}>
      {diffs.map((part, index) => {
        const [operation, text] = part;

        if (operation === -1) {
          // Deletion - strikethrough with red background
          return (
            <span
              key={index}
              className="line-through bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300"
            >
              {text}
            </span>
          );
        }

        if (operation === 1) {
          // Addition - green background
          return (
            <span
              key={index}
              className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300"
            >
              {text}
            </span>
          );
        }

        // Unchanged text - operation === 0
        return <span key={index}>{text}</span>;
      })}
    </div>
  );
}

/**
 * Helper function to convert TipTap JSON content to plain text for diffing.
 * Recursively extracts text content from the TipTap document structure.
 */
export function tipTapToPlainText(content: Record<string, unknown> | null | undefined): string {
  if (!content) return '';

  const extractText = (node: Record<string, unknown>): string => {
    // Handle text nodes
    if (node.type === 'text' && typeof node.text === 'string') {
      return node.text;
    }

    // Handle paragraph nodes - add newline after
    if (node.type === 'paragraph') {
      const childContent = Array.isArray(node.content)
        ? node.content.map((child: unknown) => extractText(child as Record<string, unknown>)).join('')
        : '';
      return childContent + '\n';
    }

    // Handle heading nodes - add newline after
    if (node.type === 'heading') {
      const childContent = Array.isArray(node.content)
        ? node.content.map((child: unknown) => extractText(child as Record<string, unknown>)).join('')
        : '';
      return childContent + '\n';
    }

    // Handle bulletList and orderedList
    if (node.type === 'bulletList' || node.type === 'orderedList') {
      const items = Array.isArray(node.content)
        ? node.content.map((child: unknown) => extractText(child as Record<string, unknown>)).join('')
        : '';
      return items;
    }

    // Handle listItem
    if (node.type === 'listItem') {
      const childContent = Array.isArray(node.content)
        ? node.content.map((child: unknown) => extractText(child as Record<string, unknown>)).join('')
        : '';
      return '• ' + childContent;
    }

    // Handle blockquote
    if (node.type === 'blockquote') {
      const childContent = Array.isArray(node.content)
        ? node.content.map((child: unknown) => extractText(child as Record<string, unknown>)).join('')
        : '';
      return '> ' + childContent;
    }

    // Handle codeBlock
    if (node.type === 'codeBlock') {
      const childContent = Array.isArray(node.content)
        ? node.content.map((child: unknown) => extractText(child as Record<string, unknown>)).join('')
        : '';
      return '```\n' + childContent + '```\n';
    }

    // Handle hardBreak
    if (node.type === 'hardBreak') {
      return '\n';
    }

    // Handle doc node (root)
    if (node.type === 'doc' && Array.isArray(node.content)) {
      return node.content.map((child: unknown) => extractText(child as Record<string, unknown>)).join('');
    }

    // Handle any other node with content
    if (Array.isArray(node.content)) {
      return node.content.map((child: unknown) => extractText(child as Record<string, unknown>)).join('');
    }

    return '';
  };

  return extractText(content).trim();
}

export default DiffViewer;
