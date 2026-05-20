import { cn, getContrastTextColor } from '@/lib/cn';
import { EmojiPickerPopover } from '@/components/EmojiPicker';
import { PersonCombobox, Person } from '@/components/PersonCombobox';
import { MultiPersonCombobox } from '@/components/MultiPersonCombobox';
import { ProgramCombobox } from '@/components/ProgramCombobox';
import { PropertyRow } from '@/components/ui/PropertyRow';
import { ApprovalButton } from '@/components/ApprovalButton';
import { computeICEScore, type ApprovalTracking } from '@ship/shared';

const PROJECT_COLORS = [
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

const ICE_VALUES = [1, 2, 3, 4, 5] as const;

interface Project {
  id: string;
  title: string;
  impact: number | null;
  confidence: number | null;
  ease: number | null;
  ice_score?: number | null;
  color: string;
  emoji: string | null;
  program_id: string | null;
  owner?: { id: string; name: string; email: string } | null;
  owner_id?: string | null;
  // RACI fields
  accountable_id?: string | null;
  consulted_ids?: string[];
  informed_ids?: string[];
  sprint_count?: number;
  issue_count?: number;
  converted_from_id?: string | null;
  // Approval tracking
  plan?: string | null;
  plan_approval?: ApprovalTracking | null;
  retro_approval?: ApprovalTracking | null;
  has_retro?: boolean;
  // Design review
  has_design_review?: boolean | null;
  design_review_notes?: string | null;
}

interface Program {
  id: string;
  name: string;
  color: string;
  emoji?: string | null;
}

interface ProjectSidebarProps {
  project: Project;
  programs: Program[];
  people: Person[];
  onUpdate: (updates: Partial<Project>) => Promise<void>;
  onConvert?: () => void;
  onUndoConversion?: () => void;
  isConverting?: boolean;
  isUndoing?: boolean;
  /** Fields to highlight as missing (e.g., after type conversion) */
  highlightedFields?: string[];
  /** Whether current user can approve (is accountable or workspace admin) */
  canApprove?: boolean;
  /** Map of user ID to name for displaying approver */
  userNames?: Record<string, string>;
  /** Callback when approval state changes */
  onApprovalUpdate?: () => void;
}

export function ProjectSidebar({
  project,
  programs,
  people,
  onUpdate,
  onConvert,
  onUndoConversion,
  isConverting = false,
  isUndoing = false,
  highlightedFields = [],
  canApprove = false,
  userNames = {},
  onApprovalUpdate,
}: ProjectSidebarProps) {
  // Helper to check if a field should be highlighted
  const isHighlighted = (field: string) => highlightedFields.includes(field);
  // Compute ICE score from current values (null if any value is unset)
  const iceScore = computeICEScore(project.impact, project.confidence, project.ease);

  return (
    <div className="space-y-4 p-4">
      {/* Undo Conversion Banner */}
      {project.converted_from_id && onUndoConversion && (
        <div className="mb-4 rounded-lg border border-blue-500/30 bg-blue-500/10 p-3">
          <p className="mb-2 text-sm text-blue-300">This project was promoted from an issue.</p>
          <button
            onClick={onUndoConversion}
            disabled={isUndoing}
            className="w-full rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
          >
            {isUndoing ? (
              <>
                <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                Undoing...
              </>
            ) : (
              <>
                <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M7.707 3.293a1 1 0 010 1.414L5.414 7H11a7 7 0 017 7v2a1 1 0 11-2 0v-2a5 5 0 00-5-5H5.414l2.293 2.293a1 1 0 11-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
                Undo Conversion
              </>
            )}
          </button>
          <p className="mt-1 text-xs text-blue-300/70 text-center">Restore the original issue</p>
        </div>
      )}

      {/* ICE Score Display */}
      <div className="rounded-lg border border-border bg-accent/10 p-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-medium text-muted uppercase tracking-wide">ICE Score</span>
          <span className="text-2xl font-bold text-accent tabular-nums">{iceScore ?? '—'}</span>
        </div>
        <div className="text-xs text-muted">
          {project.impact ?? '—'} × {project.confidence ?? '—'} × {project.ease ?? '—'} = {iceScore ?? '—'}
        </div>
      </div>

      {/* Impact Slider */}
      <PropertyRow
        label="Impact"
        tooltip={`Expected value in next 12 months:\n5 - More than $1b\n4 - More than $100m\n3 - More than $10m\n2 - More than $1m\n1 - More than $100k`}
        highlighted={isHighlighted('impact')}
      >
        <p className="text-xs text-muted mb-2">How much value will this deliver?</p>
        <ICESlider
          value={project.impact}
          onChange={(value) => onUpdate({ impact: value })}
          aria-label="Impact"
          highlighted={isHighlighted('impact')}
        />
      </PropertyRow>

      {/* Confidence Slider */}
      <PropertyRow
        label="Confidence"
        tooltip={`How likely is this to succeed?\n5 - 100% certain, trivial complexity\n4 - 80% certain, familiar territory\n3 - 60% certain, somewhat complex\n2 - 40% certain, somewhat novel\n1 - 20% certain, pathfinding required`}
        highlighted={isHighlighted('confidence')}
      >
        <p className="text-xs text-muted mb-2">How sure are we about the outcome?</p>
        <ICESlider
          value={project.confidence}
          onChange={(value) => onUpdate({ confidence: value })}
          aria-label="Confidence"
          highlighted={isHighlighted('confidence')}
        />
      </PropertyRow>

      {/* Ease Slider */}
      <PropertyRow
        label="Ease"
        tooltip={`Labor hours to deliver:\n5 - Less than 1 week\n4 - Less than 1 month\n3 - Less than 1 quarter\n2 - Less than 1 year\n1 - More than 1 year`}
        highlighted={isHighlighted('ease')}
      >
        <p className="text-xs text-muted mb-2">How easy is this to implement?</p>
        <ICESlider
          value={project.ease}
          onChange={(value) => onUpdate({ ease: value })}
          aria-label="Ease"
          highlighted={isHighlighted('ease')}
        />
      </PropertyRow>

      {/* Owner (R - Responsible) */}
      <PropertyRow label="Owner" tooltip="R - Responsible: Person who does the work">
        <PersonCombobox
          people={people}
          value={project.owner?.id || null}
          onChange={(ownerId) => onUpdate({ owner_id: ownerId })}
          placeholder="Select owner..."
        />
      </PropertyRow>

      {/* Accountable (A - Accountable) */}
      <PropertyRow label="Accountable" tooltip="A - Accountable: Person who approves hypotheses and reviews">
        <PersonCombobox
          people={people}
          value={project.accountable_id || null}
          onChange={(accountableId) => onUpdate({ accountable_id: accountableId })}
          placeholder="Select approver..."
        />
      </PropertyRow>

      {/* Consulted (C - Consulted) */}
      <PropertyRow label="Consulted" tooltip="C - Consulted: People whose opinions are sought (two-way communication)">
        <MultiPersonCombobox
          people={people}
          value={project.consulted_ids || []}
          onChange={(consultedIds) => onUpdate({ consulted_ids: consultedIds })}
          placeholder="Select people..."
        />
      </PropertyRow>

      {/* Informed (I - Informed) */}
      <PropertyRow label="Informed" tooltip="I - Informed: People kept up-to-date on progress (one-way communication)">
        <MultiPersonCombobox
          people={people}
          value={project.informed_ids || []}
          onChange={(informedIds) => onUpdate({ informed_ids: informedIds })}
          placeholder="Select people..."
        />
      </PropertyRow>

      {/* Design Review */}
      <div className="pt-4 border-t border-border">
        <PropertyRow label="Design Review">
          <div className="space-y-3">
            <label className="flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={project.has_design_review || false}
                onChange={(e) => onUpdate({ has_design_review: e.target.checked })}
                className="h-4 w-4 rounded border-gray-300 text-accent focus:ring-accent focus:ring-offset-background"
              />
              <span className="ml-2 text-sm text-foreground">Design review approved</span>
            </label>
            {(project.has_design_review || project.design_review_notes) && (
              <textarea
                placeholder="Optional notes about design review..."
                value={project.design_review_notes || ''}
                onChange={(e) => onUpdate({ design_review_notes: e.target.value })}
                className="w-full p-2 text-sm border border-border rounded-lg bg-background text-foreground placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent resize-none"
                rows={3}
                maxLength={2000}
              />
            )}
          </div>
        </PropertyRow>
      </div>

      {/* Approvals Section - only show if user can approve AND there's content to approve */}
      {canApprove && (!!project.plan?.trim() || project.has_retro) && (
        <div className="pt-4 border-t border-border space-y-4">
          <h4 className="text-xs font-medium text-muted uppercase tracking-wide">Approvals</h4>

          {/* Plan Approval - only show when plan exists */}
          {!!project.plan?.trim() && (
            <PropertyRow label="Plan">
              <ApprovalButton
                type="plan"
                approval={project.plan_approval}
                hasContent={!!project.plan?.trim()}
                canApprove={canApprove}
                approveEndpoint={`/api/projects/${project.id}/approve-plan`}
                approverName={project.plan_approval?.approved_by ? userNames[project.plan_approval.approved_by] : undefined}
                currentContent={project.plan || ''}
                onApproved={onApprovalUpdate}
              />
            </PropertyRow>
          )}

          {/* Retro Approval - only show when retro exists */}
          {project.has_retro && (
            <PropertyRow label="Retrospective">
              <ApprovalButton
                type="retro"
                approval={project.retro_approval}
                hasContent={project.has_retro ?? false}
                canApprove={canApprove}
                approveEndpoint={`/api/projects/${project.id}/approve-retro`}
                approverName={project.retro_approval?.approved_by ? userNames[project.retro_approval.approved_by] : undefined}
                onApproved={onApprovalUpdate}
              />
            </PropertyRow>
          )}
        </div>
      )}

      {/* Icon (Emoji) */}
      <PropertyRow label="Icon">
        <EmojiPickerPopover
          value={project.emoji}
          onChange={(emoji) => onUpdate({ emoji })}
        >
          <div
            className="flex h-10 w-10 items-center justify-center rounded-lg text-lg cursor-pointer hover:ring-2 hover:ring-accent transition-all"
            style={{ backgroundColor: project.color, color: getContrastTextColor(project.color) }}
          >
            {project.emoji || project.title?.[0]?.toUpperCase() || '?'}
          </div>
        </EmojiPickerPopover>
        <p className="mt-1 text-xs text-muted">Click to change</p>
      </PropertyRow>

      {/* Color */}
      <PropertyRow label="Color">
        <div className="flex flex-wrap gap-1.5">
          {PROJECT_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => onUpdate({ color: c })}
              className={cn(
                'h-6 w-6 rounded-full transition-transform',
                project.color === c ? 'ring-2 ring-white ring-offset-1 ring-offset-background scale-110' : 'hover:scale-105'
              )}
              style={{ backgroundColor: c }}
              aria-label={`Select ${c} color`}
            />
          ))}
        </div>
      </PropertyRow>

      {/* Program (Optional) */}
      <PropertyRow label="Program">
        <ProgramCombobox
          programs={programs}
          value={project.program_id}
          onChange={(programId) => onUpdate({ program_id: programId })}
          placeholder="No program"
        />
      </PropertyRow>

      {/* Stats */}
      <div className="pt-4 border-t border-border space-y-2">
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted">Weeks</span>
          <span className="text-foreground">{project.sprint_count ?? 0}</span>
        </div>
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted">Issues</span>
          <span className="text-foreground">{project.issue_count ?? 0}</span>
        </div>
      </div>

      {/* Document Conversion */}
      {onConvert && (
        <div className="pt-4 mt-4 border-t border-border">
          <button
            onClick={onConvert}
            disabled={isConverting}
            className="w-full rounded bg-border px-3 py-2 text-sm font-medium text-muted hover:bg-border/80 hover:text-foreground disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
          >
            {isConverting ? (
              <>
                <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                Converting...
              </>
            ) : (
              <>
                <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm.707-10.293a1 1 0 00-1.414-1.414l-3 3a1 1 0 000 1.414l3 3a1 1 0 001.414-1.414L9.414 11H13a1 1 0 100-2H9.414l1.293-1.293z" clipRule="evenodd" />
                </svg>
                Convert to Issue
              </>
            )}
          </button>
          <p className="mt-1 text-xs text-muted text-center">Convert this project into an issue</p>
        </div>
      )}
    </div>
  );
}


// ICE Slider component (1-5 segmented buttons)
function ICESlider({
  value,
  onChange,
  'aria-label': ariaLabel,
  highlighted,
}: {
  value: number | null;
  onChange: (value: number) => void;
  'aria-label': string;
  highlighted?: boolean;
}) {
  return (
    <div className={cn('flex gap-1 rounded p-0.5', highlighted && 'ring-1 ring-amber-500 bg-amber-500/10')} role="group" aria-label={ariaLabel}>
      {ICE_VALUES.map((v) => (
        <button
          key={v}
          type="button"
          onClick={() => onChange(v)}
          aria-pressed={value === v}
          className={cn(
            'flex-1 py-1.5 text-sm font-medium rounded transition-colors',
            value === v
              ? 'bg-accent text-white'
              : 'bg-border/50 text-muted hover:bg-border hover:text-foreground'
          )}
        >
          {v}
        </button>
      ))}
    </div>
  );
}
