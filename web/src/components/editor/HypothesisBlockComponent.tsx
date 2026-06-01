import { NodeViewWrapper, NodeViewContent, NodeViewProps } from '@tiptap/react';

/**
 * PlanBlock Component (formerly HypothesisBlock)
 *
 * A visually distinct callout-style block for sprint plans.
 * Features:
 * - Light background with accent border
 * - Lightbulb icon indicating "plan"
 * - Built-in "Plan" label
 * - Editable content area
 */
export function HypothesisBlockComponent({ node }: NodeViewProps) {
  const isEmpty = node.content.size === 0;
  const attrs = node.attrs as { placeholder?: unknown };
  const placeholder = typeof attrs.placeholder === 'string' && attrs.placeholder.length > 0
    ? attrs.placeholder
    : 'What will get done this week?';

  return (
    <NodeViewWrapper
      data-type="hypothesis-block"
      className="hypothesis-block my-4 rounded-lg border border-amber-500/30 bg-amber-500/5"
    >
      <div className="flex items-start gap-3 p-4">
        {/* Lightbulb icon */}
        <div
          className="flex-shrink-0 mt-0.5 text-amber-500"
          contentEditable={false}
        >
          <svg
            className="w-5 h-5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
            />
          </svg>
        </div>

        {/* Content container */}
        <div className="flex-1 min-w-0">
          {/* Label */}
          <div
            className="text-xs font-semibold uppercase tracking-wider text-amber-500/80 mb-2"
            contentEditable={false}
          >
            Plan
          </div>

          {/* Editable content */}
          <div className="relative">
            <NodeViewContent className="hypothesis-content outline-none" />
            {/* Show placeholder when empty */}
            {isEmpty && (
              <div
                className="absolute inset-0 pointer-events-none text-muted/50"
                contentEditable={false}
              >
                {placeholder}
              </div>
            )}
          </div>
        </div>
      </div>
    </NodeViewWrapper>
  );
}
