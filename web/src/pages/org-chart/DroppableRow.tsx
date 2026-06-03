import { useDroppable } from '@dnd-kit/core';

export function DroppableRow({
  personId,
  disabled,
  isOver,
  children,
}: {
  personId: string;
  disabled: boolean;
  isOver?: boolean;
  children: (props: { isOver: boolean }) => React.ReactNode;
}) {
  const { setNodeRef, isOver: dndIsOver } = useDroppable({
    id: `drop-${personId}`,
    disabled,
    data: { personId },
  });
  return <div ref={setNodeRef}>{children({ isOver: isOver ?? dndIsOver })}</div>;
}
