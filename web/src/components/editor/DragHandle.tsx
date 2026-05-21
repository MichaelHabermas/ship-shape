import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, NodeSelection } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import type { Slice, Node as PMNode } from '@tiptap/pm/model';

// Selectors for blocks that should show drag handles
const BLOCK_SELECTORS = [
  'p',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'ul > li',
  'ol > li',
  'blockquote',
  'pre',
  'hr',
  '[data-document-embed]',
].join(', ');

// Store drag state for move operations
interface DragState {
  node: PMNode;
  from: number;
  to: number;
  slice: Slice;
}

let dragState: DragState | null = null;

// Create the drag handle button element
function createDragHandle(): HTMLButtonElement {
  const handle = document.createElement('button');
  handle.type = 'button';
  handle.className = 'editor-drag-handle';
  handle.draggable = true;
  handle.setAttribute('aria-label', 'Drag to reorder block');

  // Create SVG using DOM APIs to avoid innerHTML security risk
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', '14');
  svg.setAttribute('height', '14');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('aria-hidden', 'true');

  // Create the six dots (2 columns x 3 rows)
  const dots = [
    { cx: '9', cy: '5' },
    { cx: '9', cy: '12' },
    { cx: '9', cy: '19' },
    { cx: '15', cy: '5' },
    { cx: '15', cy: '12' },
    { cx: '15', cy: '19' },
  ];

  dots.forEach(({ cx, cy }) => {
    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('cx', cx);
    circle.setAttribute('cy', cy);
    circle.setAttribute('r', '1.5');
    svg.appendChild(circle);
  });

  handle.appendChild(svg);
  return handle;
}

// Find the DOM element at coordinates that matches our block selectors
function getBlockAtCoords(x: number, y: number): Element | null {
  const elements = document.elementsFromPoint(x, y);
  for (const elem of elements) {
    if (elem.matches(BLOCK_SELECTORS)) {
      return elem;
    }
    // Check if we're inside a list item
    const li = elem.closest('li');
    if (li) return li;
  }
  return null;
}

// Get ProseMirror position from DOM element
function getNodePos(node: Element, view: EditorView): number | null {
  const rect = node.getBoundingClientRect();
  const pos = view.posAtCoords({
    left: rect.left + 1,
    top: rect.top + 1,
  });
  return pos?.inside ?? null;
}

// Get the resolved position for inserting at drop coordinates
function getDropPos(view: EditorView, x: number, y: number): number | null {
  const pos = view.posAtCoords({ left: x, top: y });
  if (!pos) return null;

  // Get the position at the drop location
  const $pos = view.state.doc.resolve(pos.pos);

  // Find the block-level node
  let depth = $pos.depth;
  while (depth > 0 && !$pos.node(depth).type.isBlock) {
    depth--;
  }

  if (depth > 0) {
    // Get the DOM node to determine if we're in the top or bottom half
    const nodeStart = $pos.before(depth);
    const dom = view.nodeDOM(nodeStart);

    if (dom instanceof HTMLElement) {
      const rect = dom.getBoundingClientRect();
      const midpoint = rect.top + rect.height / 2;

      // If drop is above the midpoint, insert before; otherwise after
      if (y < midpoint) {
        return $pos.before(depth);
      } else {
        return $pos.after(depth);
      }
    }

    // Fallback: return position after the block
    return $pos.after(depth);
  }

  return pos.pos;
}

export const DragHandleExtension = Extension.create({
  name: 'dragHandle',

  addProseMirrorPlugins() {
    let dragHandle: HTMLButtonElement | null = null;
    let currentBlock: Element | null = null;
    let isDragging = false;
    let isDragHandleHovered = false;
    let hideTimeout: ReturnType<typeof setTimeout> | null = null;

    const hideDragHandle = () => {
      // Don't hide if mouse is over the drag handle
      if (isDragHandleHovered) return;

      // Clear any existing timeout
      if (hideTimeout) {
        clearTimeout(hideTimeout);
      }

      // Delay hiding to allow moving cursor to drag handle
      hideTimeout = setTimeout(() => {
        if (!isDragHandleHovered && !isDragging && dragHandle) {
          dragHandle.style.opacity = '0';
          dragHandle.style.pointerEvents = 'none';
        }
      }, 300);
    };

    const showDragHandle = () => {
      // Cancel any pending hide
      if (hideTimeout) {
        clearTimeout(hideTimeout);
        hideTimeout = null;
      }

      if (dragHandle) {
        dragHandle.style.opacity = '1';
        dragHandle.style.pointerEvents = 'auto';
      }
    };

    const positionDragHandle = (block: Element, view: EditorView) => {
      if (!dragHandle) return;

      const rect = block.getBoundingClientRect();
      const editorRect = view.dom.getBoundingClientRect();

      // Position to the left of the block
      const left = rect.left - editorRect.left - 28;
      const top = rect.top - editorRect.top;

      // Adjust for line height to center vertically
      const style = window.getComputedStyle(block);
      const lineHeight = parseInt(style.lineHeight, 10) || 24;
      const topOffset = (lineHeight - 20) / 2;

      dragHandle.style.left = `${left}px`;
      dragHandle.style.top = `${top + topOffset}px`;
    };

    return [
      new Plugin({
        key: new PluginKey('dragHandle'),
        view: (view) => {
          // Create and append drag handle to editor container
          dragHandle = createDragHandle();
          dragHandle.style.position = 'absolute';
          dragHandle.style.opacity = '0';
          dragHandle.style.pointerEvents = 'none';
          dragHandle.style.zIndex = '50';
          dragHandle.style.cursor = 'grab';

          // Ensure editor container has relative positioning
          const container = view.dom.parentElement;
          if (container) {
            container.style.position = 'relative';
            container.appendChild(dragHandle);
          }

          // Click handler - select the block
          dragHandle.addEventListener('click', (e) => {
            e.preventDefault();
            if (!currentBlock) return;

            const pos = getNodePos(currentBlock, view);
            if (pos === null || pos < 0) return;

            view.focus();
            const nodeSelection = NodeSelection.create(view.state.doc, pos);
            view.dispatch(view.state.tr.setSelection(nodeSelection));
          });

          // Drag start handler
          dragHandle.addEventListener('dragstart', (e) => {
            if (!currentBlock || !e.dataTransfer) return;

            isDragging = true;
            view.dom.classList.add('dragging');

            const pos = getNodePos(currentBlock, view);
            if (pos === null || pos < 0) return;

            // Resolve position to get the actual node
            const $pos = view.state.doc.resolve(pos);
            const node = $pos.parent.child($pos.index());
            const from = $pos.before($pos.depth + 1);
            const to = from + node.nodeSize;

            view.focus();
            const nodeSelection = NodeSelection.create(view.state.doc, from);
            view.dispatch(view.state.tr.setSelection(nodeSelection));

            const slice = view.state.selection.content();
            const { dom, text } = view.serializeForClipboard(slice);

            // Store drag state for drop handling
            dragState = { node, from, to, slice };

            e.dataTransfer.clearData();
            e.dataTransfer.setData('text/html', dom.innerHTML);
            e.dataTransfer.setData('text/plain', text);
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setDragImage(currentBlock, 0, 0);

            view.dragging = { slice, move: true };
          });

          // Drag end handler
          dragHandle.addEventListener('dragend', () => {
            isDragging = false;
            dragState = null;
            view.dom.classList.remove('dragging');
            hideDragHandle();
          });

          // Track hover state on drag handle itself
          dragHandle.addEventListener('mouseenter', () => {
            isDragHandleHovered = true;
            // Cancel any pending hide
            if (hideTimeout) {
              clearTimeout(hideTimeout);
              hideTimeout = null;
            }
          });

          dragHandle.addEventListener('mouseleave', () => {
            isDragHandleHovered = false;
            hideDragHandle();
          });

          return {
            destroy: () => {
              if (hideTimeout) {
                clearTimeout(hideTimeout);
              }
              dragHandle?.remove();
              dragHandle = null;
            },
          };
        },
        props: {
          handleDOMEvents: {
            mousemove: (view, event) => {
              if (!view.editable || isDragging) return false;

              // Don't clear currentBlock if mouse is over the drag handle
              if (isDragHandleHovered) return false;

              // Also check if the event target is the drag handle itself
              const target = event.target as HTMLElement;
              if (target.closest('.editor-drag-handle')) return false;

              const block = getBlockAtCoords(event.clientX, event.clientY);

              if (!block) {
                // Only clear currentBlock if drag handle is not visible
                // This preserves the block reference when moving through the gap to reach the handle
                if (dragHandle && dragHandle.style.opacity !== '1') {
                  hideDragHandle();
                  currentBlock = null;
                }
                return false;
              }

              // Don't show for the prosemirror container itself
              if (block.classList.contains('ProseMirror')) {
                hideDragHandle();
                currentBlock = null;
                return false;
              }

              currentBlock = block;
              positionDragHandle(block, view);
              showDragHandle();

              return false;
            },
            mouseleave: () => {
              hideDragHandle();
              return false;
            },
            drop: (view, event) => {
              view.dom.classList.remove('dragging');
              hideDragHandle();

              // If we have stored drag state from our drag handle, handle the move
              if (dragState && event.clientX && event.clientY) {
                event.preventDefault();

                const dropPos = getDropPos(view, event.clientX, event.clientY);
                if (dropPos === null) {
                  dragState = null;
                  return false;
                }

                const { node, from, to } = dragState;

                // Don't do anything if dropping in the same place
                if (dropPos >= from && dropPos <= to) {
                  dragState = null;
                  return true;
                }

                // Create a transaction to move the node
                let tr = view.state.tr;

                // Calculate adjusted positions based on whether we're moving up or down
                if (dropPos < from) {
                  // Moving up: insert first, then delete (positions shift)
                  tr = tr.insert(dropPos, node);
                  tr = tr.delete(from + node.nodeSize, to + node.nodeSize);
                } else {
                  // Moving down: delete first, then insert (positions shift)
                  tr = tr.delete(from, to);
                  const adjustedDropPos = dropPos - (to - from);
                  tr = tr.insert(adjustedDropPos, node);
                }

                view.dispatch(tr);
                view.focus();

                dragState = null;
                return true;
              }

              return false;
            },
            dragover: (_view, event) => {
              // CRITICAL: Must preventDefault on dragover for drop to work
              if (dragState) {
                event.preventDefault();
                return true;
              }
              return false;
            },
            dragenter: (view) => {
              view.dom.classList.add('dragging');
              return false;
            },
            dragend: (view) => {
              view.dom.classList.remove('dragging');
              return false;
            },
          },
        },
      }),
    ];
  },
});
