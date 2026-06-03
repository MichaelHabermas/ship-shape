import { useDroppable } from '@dnd-kit/core';

export function NoSupervisorDropZone() {
  const { setNodeRef, isOver } = useDroppable({
    id: 'drop-no-supervisor',
    data: { personId: null },
  });

  return (
    <div
      ref={setNodeRef}
      className={`mb-2 flex items-center justify-center rounded-md border-2 border-dashed px-4 py-2 text-xs transition-colors ${
        isOver
          ? 'border-accent bg-accent/10 text-accent'
          : 'border-border/50 text-muted'
      }`}
    >
      Drop here to remove supervisor
    </div>
  );
}
