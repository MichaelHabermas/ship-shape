import { Node, mergeAttributes } from '@tiptap/core';
import { NodeViewWrapper, NodeViewProps, ReactNodeViewRenderer } from '@tiptap/react';
import { useState, useCallback, useRef, useEffect } from 'react';

// Type declaration for setImage command
declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    image: {
      setImage: (options: { src: string; alt?: string; title?: string; width?: number }) => ReturnType;
    };
  }
}

// Resizable Image Component
function ResizableImageComponent({ node, updateAttributes, selected }: NodeViewProps) {
  const attrs = node.attrs as {
    width?: number | string;
    src: string;
    alt?: string | null;
    title?: string | null;
  };
  const [isResizing, setIsResizing] = useState(false);
  const imageRef = useRef<HTMLImageElement>(null);
  const startX = useRef(0);
  const startWidth = useRef(0);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsResizing(true);
    startX.current = e.clientX;
    startWidth.current = imageRef.current?.offsetWidth || 300;
  }, []);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isResizing) return;
    const diff = e.clientX - startX.current;
    const newWidth = Math.max(100, Math.min(800, startWidth.current + diff));
    updateAttributes({ width: newWidth });
  }, [isResizing, updateAttributes]);

  const handleMouseUp = useCallback(() => {
    setIsResizing(false);
  }, []);

  useEffect(() => {
    if (isResizing) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      return () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [isResizing, handleMouseMove, handleMouseUp]);

  const width = attrs.width || 'auto';

  return (
    <NodeViewWrapper className="relative inline-block my-4">
      <div
        className={`relative inline-block ${selected ? 'ring-2 ring-accent ring-offset-2 ring-offset-background' : ''}`}
        style={{ width: width === 'auto' ? 'auto' : `${width}px` }}
      >
        <img
          ref={imageRef}
          src={attrs.src}
          alt={attrs.alt || ''}
          title={attrs.title || undefined}
          className="max-w-full rounded-lg block"
          style={{ width: '100%', height: 'auto' }}
          draggable={false}
        />
        {/* Resize handle - bottom right corner */}
        {selected && (
          <div
            onMouseDown={handleMouseDown}
            className="absolute bottom-0 right-0 w-4 h-4 bg-accent cursor-se-resize rounded-tl-sm opacity-80 hover:opacity-100 transition-opacity"
            style={{ transform: 'translate(25%, 25%)' }}
          />
        )}
      </div>
      {/* Size indicator when resizing */}
      {isResizing && (
        <div className="absolute -bottom-6 left-1/2 -translate-x-1/2 px-2 py-0.5 bg-muted text-xs text-muted-foreground rounded">
          {width}px
        </div>
      )}
    </NodeViewWrapper>
  );
}

// Custom Resizable Image Extension
export const ResizableImage = Node.create({
  name: 'image',

  group: 'block',

  atom: true,

  draggable: true,

  addAttributes() {
    return {
      src: {
        default: null,
      },
      alt: {
        default: null,
      },
      title: {
        default: null,
      },
      width: {
        default: null,
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'img[src]',
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    const { width, ...rest } = HTMLAttributes;
    return ['img', mergeAttributes(rest, width ? { style: `width: ${width}px` } : {})];
  },

  addNodeView() {
    return ReactNodeViewRenderer(ResizableImageComponent);
  },

  addCommands() {
    return {
      setImage:
        (options: { src: string; alt?: string; title?: string; width?: number }) =>
        ({ commands }: { commands: { insertContent: (content: { type: string; attrs: typeof options }) => boolean } }) => {
          return commands.insertContent({
            type: this.name,
            attrs: options,
          });
        },
    };
  },
});
