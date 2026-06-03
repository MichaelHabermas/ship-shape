import { useState, useCallback, useRef } from 'react';
import { ArchiveIcon } from '@/components/icons/ArchiveIcon';
import type { Program } from '@/contexts/ProgramsContext';
import { cn, getContrastTextColor } from '@/lib/cn';
import { ContextMenu, ContextMenuItem, ContextMenuSeparator, ContextMenuSubmenu } from '@/components/ui/ContextMenu';
import { useToast } from '@/components/ui/Toast';
import { MoreHorizontalIcon } from './sidebar-icons.js';

const PROGRAM_COLORS = [
  { value: '#EF4444', label: 'Red' },
  { value: '#F97316', label: 'Orange' },
  { value: '#EAB308', label: 'Yellow' },
  { value: '#22C55E', label: 'Green' },
  { value: '#06B6D4', label: 'Cyan' },
  { value: '#3B82F6', label: 'Blue' },
  { value: '#8B5CF6', label: 'Purple' },
  { value: '#EC4899', label: 'Pink' },
  { value: '#6B7280', label: 'Gray' },
];

export function ProgramsList({
  programs,
  activeId,
  onSelect,
  onUpdateProgram,
}: {
  programs: Program[];
  activeId?: string;
  onSelect: (id: string) => void;
  onUpdateProgram: (id: string, updates: Partial<Program>) => Promise<Program | null>;
}) {
  const { showToast } = useToast();
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; programId: string } | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const handleContextMenu = useCallback((e: React.MouseEvent, programId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, programId });
  }, []);

  const handleMenuClick = useCallback((e: React.MouseEvent, programId: string) => {
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    setContextMenu({ x: rect.right, y: rect.bottom, programId });
  }, []);

  const handleRename = useCallback((program: Program) => {
    setContextMenu(null);
    setEditingId(program.id);
    setEditingName(program.name);
    // Focus input after render
    setTimeout(() => inputRef.current?.focus(), 0);
  }, []);

  const handleRenameSubmit = useCallback(async (programId: string) => {
    if (editingName.trim()) {
      await onUpdateProgram(programId, { name: editingName.trim() });
      showToast('Program renamed', 'success');
    }
    setEditingId(null);
    setEditingName('');
  }, [editingName, onUpdateProgram, showToast]);

  const handleRenameKeyDown = useCallback((e: React.KeyboardEvent, programId: string) => {
    if (e.key === 'Enter') {
      handleRenameSubmit(programId);
    } else if (e.key === 'Escape') {
      setEditingId(null);
      setEditingName('');
    }
  }, [handleRenameSubmit]);

  const handleChangeColor = useCallback(async (programId: string, color: string) => {
    setContextMenu(null);
    await onUpdateProgram(programId, { color });
    showToast('Color updated', 'success');
  }, [onUpdateProgram, showToast]);

  const handleArchive = useCallback(async (program: Program) => {
    setContextMenu(null);
    const originalArchivedAt = program.archived_at;
    await onUpdateProgram(program.id, { archived_at: new Date().toISOString() });
    showToast('Program archived', 'success', 5000, {
      label: 'Undo',
      onClick: async () => {
        await onUpdateProgram(program.id, { archived_at: originalArchivedAt });
        showToast('Archive undone', 'info');
      },
    });
  }, [onUpdateProgram, showToast]);

  if (programs.length === 0) {
    return <div className="px-3 py-2 text-sm text-muted">No programs yet</div>;
  }

  const contextMenuProgram = contextMenu ? programs.find(p => p.id === contextMenu.programId) : null;

  return (
    <>
      <ul className="space-y-0.5 px-2" data-testid="programs-list">
        {programs.map((program) => (
          <li key={program.id} data-testid="program-item">
            <div
              className="group relative"
              onContextMenu={(e) => handleContextMenu(e, program.id)}
            >
              {editingId === program.id ? (
                <div className="flex items-center gap-2 px-2 py-1.5">
                  <span
                    className="h-4 w-4 rounded flex-shrink-0 flex items-center justify-center text-[10px] font-bold"
                    style={{ backgroundColor: program.color, color: getContrastTextColor(program.color) }}
                  >
                    {program.emoji || program.name?.[0]?.toUpperCase() || '?'}
                  </span>
                  <input
                    ref={inputRef}
                    type="text"
                    value={editingName}
                    onChange={(e) => setEditingName(e.target.value)}
                    onBlur={() => handleRenameSubmit(program.id)}
                    onKeyDown={(e) => handleRenameKeyDown(e, program.id)}
                    className="flex-1 bg-transparent border-none outline-none text-sm text-foreground"
                  />
                </div>
              ) : (
                <button
                  onClick={() => onSelect(program.id)}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors',
                    activeId === program.id
                      ? 'bg-border/50 text-foreground'
                      : 'text-muted hover:bg-border/30 hover:text-foreground'
                  )}
                >
                  <span
                    className="h-4 w-4 rounded flex-shrink-0 flex items-center justify-center text-[10px] font-bold"
                    style={{ backgroundColor: program.color, color: getContrastTextColor(program.color) }}
                  >
                    {program.emoji || program.name?.[0]?.toUpperCase() || '?'}
                  </span>
                  <span className="flex-1 truncate">{program.name}</span>
                </button>
              )}
              {/* Three-dot menu button */}
              {editingId !== program.id && (
                <button
                  type="button"
                  onClick={(e) => handleMenuClick(e, program.id)}
                  className="absolute right-1 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-border/50 opacity-0 group-hover:opacity-100 transition-opacity"
                  aria-label={`Actions for ${program.name}`}
                >
                  <MoreHorizontalIcon />
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>

      {/* Context Menu */}
      {contextMenu && contextMenuProgram && (
        <ContextMenu x={contextMenu.x} y={contextMenu.y} onClose={() => setContextMenu(null)}>
          <ContextMenuItem onClick={() => handleRename(contextMenuProgram)}>
            <EditIcon className="h-4 w-4" />
            Rename
          </ContextMenuItem>
          <ContextMenuSubmenu label="Change Color">
            {PROGRAM_COLORS.map((color) => (
              <ContextMenuItem
                key={color.value}
                onClick={() => handleChangeColor(contextMenuProgram.id, color.value)}
              >
                <span
                  className="h-3 w-3 rounded-full"
                  style={{ backgroundColor: color.value }}
                />
                {color.label}
              </ContextMenuItem>
            ))}
          </ContextMenuSubmenu>
          <ContextMenuSeparator />
          <ContextMenuItem onClick={() => handleArchive(contextMenuProgram)}>
            <ArchiveIcon className="h-4 w-4" />
            Archive
          </ContextMenuItem>
        </ContextMenu>
      )}
    </>
  );
}

function EditIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
    </svg>
  );
}