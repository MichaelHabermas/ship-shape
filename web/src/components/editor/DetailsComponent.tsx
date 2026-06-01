import { NodeViewWrapper, NodeViewContent, NodeViewProps } from '@tiptap/react';
import { useCallback } from 'react';

/**
 * Details/Toggle Component
 *
 * A Notion-like collapsible toggle block with:
 * - Clickable arrow to expand/collapse
 * - Editable title/summary
 * - Nested content area
 */
export function DetailsComponent({ node, updateAttributes }: NodeViewProps) {
  const isOpen = !!node.attrs.open;

  const toggleOpen = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    updateAttributes({ open: !isOpen });
  }, [isOpen, updateAttributes]);

  return (
    <NodeViewWrapper
      data-type="details"
      data-open={isOpen ? 'true' : 'false'}
      className={'details-block my-2 ' + (isOpen ? 'is-open' : 'is-collapsed')}
    >
      <div className="flex items-start gap-1">
        {/* Toggle arrow button */}
        <button
          type="button"
          onClick={toggleOpen}
          className="toggle-arrow flex-shrink-0 mt-1 p-0.5 rounded hover:bg-muted/50 transition-colors cursor-pointer"
          aria-expanded={isOpen}
          aria-label={isOpen ? 'Collapse' : 'Expand'}
          contentEditable={false}
        >
          <svg
            className={'w-4 h-4 text-muted-foreground transition-transform duration-200 ' + (isOpen ? 'rotate-90' : '')}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 5l7 7-7 7"
            />
          </svg>
        </button>

        {/* Content container */}
        <div className="flex-1 min-w-0">
          {/* The NodeViewContent renders the child nodes (detailsSummary and detailsContent) */}
          <NodeViewContent className="details-node-content" />
        </div>
      </div>
    </NodeViewWrapper>
  );
}
