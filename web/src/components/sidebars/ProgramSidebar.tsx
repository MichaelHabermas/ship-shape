import { useState } from 'react';
import { cn } from '@/lib/cn';
import { PersonCombobox, Person } from '@/components/PersonCombobox';
import { MultiPersonCombobox } from '@/components/MultiPersonCombobox';
import { PropertyRow } from '@/components/ui/PropertyRow';
import { MergeProgramDialog } from '@/components/dialogs/MergeProgramDialog';

const PROGRAM_COLORS = [
  '#6366f1', // Indigo
  '#8b5cf6', // Violet
  '#ec4899', // Pink
  '#f43f5e', // Rose
  '#ef4444', // Red
  '#f97316', // Orange
  '#eab308', // Yellow
  '#22c55e', // Green
  '#14b8a6', // Teal
  '#06b6d4', // Cyan
  '#3b82f6', // Blue
];

interface Program {
  id: string;
  title?: string;
  name?: string;
  color?: string;
  emoji?: string | null;
  owner_id?: string | null;
  // RACI fields
  accountable_id?: string | null;
  consulted_ids?: string[];
  informed_ids?: string[];
}

interface ProgramSidebarProps {
  program: Program;
  people: Person[];
  onUpdate: (updates: Partial<Program>) => Promise<void>;
  /** Fields to highlight as missing */
  highlightedFields?: string[];
}

export function ProgramSidebar({
  program,
  people,
  onUpdate,
  highlightedFields = [],
}: ProgramSidebarProps) {
  const [mergeDialogOpen, setMergeDialogOpen] = useState(false);

  // Helper to check if a field should be highlighted
  const isHighlighted = (field: string) => highlightedFields.includes(field);

  const programName = program.title || program.name || 'Untitled';

  return (
    <div className="flex flex-col gap-1 p-4">
      {/* Color Selector */}
      <PropertyRow label="Color">
        <div className="flex flex-wrap gap-1">
          {PROGRAM_COLORS.map((color) => (
            <button
              key={color}
              className={cn(
                'w-5 h-5 rounded border-2',
                program.color === color ? 'border-foreground' : 'border-transparent'
              )}
              style={{ backgroundColor: color }}
              onClick={() => onUpdate({ color })}
              title={color}
            />
          ))}
        </div>
      </PropertyRow>

      {/* RACI Section */}
      <div className="mt-4 mb-2">
        <h4 className="text-xs font-medium text-muted uppercase tracking-wider">RACI Assignments</h4>
      </div>

      {/* Owner (R - Responsible) */}
      <PropertyRow
        label="Owner"
        tooltip="R - Responsible: Person who owns and leads this program"
        highlighted={isHighlighted('owner_id')}
      >
        <PersonCombobox
          people={people}
          value={program.owner_id || null}
          onChange={(ownerId) => onUpdate({ owner_id: ownerId })}
          placeholder="Select owner..."
        />
      </PropertyRow>

      {/* Accountable (A - Accountable) */}
      <PropertyRow
        label="Accountable"
        tooltip="A - Accountable: Person who approves hypotheses and reviews"
        highlighted={isHighlighted('accountable_id')}
      >
        <PersonCombobox
          people={people}
          value={program.accountable_id || null}
          onChange={(accountableId) => onUpdate({ accountable_id: accountableId })}
          placeholder="Select approver..."
        />
      </PropertyRow>

      {/* Consulted (C - Consulted) */}
      <PropertyRow
        label="Consulted"
        tooltip="C - Consulted: People whose opinions are sought (two-way communication)"
      >
        <MultiPersonCombobox
          people={people}
          value={program.consulted_ids || []}
          onChange={(consultedIds) => onUpdate({ consulted_ids: consultedIds })}
          placeholder="Select people..."
        />
      </PropertyRow>

      {/* Informed (I - Informed) */}
      <PropertyRow
        label="Informed"
        tooltip="I - Informed: People who are kept updated on progress (one-way communication)"
      >
        <MultiPersonCombobox
          people={people}
          value={program.informed_ids || []}
          onChange={(informedIds) => onUpdate({ informed_ids: informedIds })}
          placeholder="Select people..."
        />
      </PropertyRow>

      {/* Actions */}
      <div className="mt-6 border-t border-border pt-4">
        <h4 className="mb-2 text-xs font-medium text-muted uppercase tracking-wider">Actions</h4>
        <button
          onClick={() => setMergeDialogOpen(true)}
          className="w-full rounded border border-border px-3 py-1.5 text-left text-sm text-muted hover:border-red-500/50 hover:text-red-400 transition-colors"
        >
          Merge into another program
        </button>
      </div>

      <MergeProgramDialog
        isOpen={mergeDialogOpen}
        onClose={() => setMergeDialogOpen(false)}
        sourceId={program.id}
        sourceName={programName}
      />
    </div>
  );
}
