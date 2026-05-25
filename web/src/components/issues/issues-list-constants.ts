import type { ColumnDefinition } from '@/hooks/useColumnVisibility';
import type { FilterTab } from '@/components/FilterTabs';
import { ISSUE_STATE_LABELS } from '@ship/shared';

export const ALL_COLUMNS: ColumnDefinition[] = [
  { key: 'id', label: 'ID', hideable: true },
  { key: 'title', label: 'Title', hideable: false },
  { key: 'status', label: 'Status', hideable: true },
  { key: 'source', label: 'Source', hideable: true },
  { key: 'program', label: 'Program', hideable: true },
  { key: 'sprint', label: 'Week', hideable: true },
  { key: 'priority', label: 'Priority', hideable: true },
  { key: 'assignee', label: 'Assignee', hideable: true },
  { key: 'updated', label: 'Updated', hideable: true },
];

export const SORT_OPTIONS = [
  { value: 'updated', label: 'Updated' },
  { value: 'created', label: 'Created' },
  { value: 'priority', label: 'Priority' },
  { value: 'title', label: 'Title' },
];

export const STATE_LABELS: Record<string, string> = ISSUE_STATE_LABELS;

export const SOURCE_STYLES: Record<string, string> = {
  internal: 'bg-blue-500/20 text-blue-300',
  external: 'bg-purple-500/20 text-purple-300',
  action_items: 'bg-amber-500/20 text-amber-300',
};

export const PRIORITY_COLORS: Record<string, string> = {
  urgent: 'text-red-500',
  high: 'text-orange-500',
  medium: 'text-yellow-500',
  low: 'text-blue-500',
  none: 'text-muted',
};

export const STATUS_COLORS: Record<string, string> = {
  triage: 'bg-yellow-500/20 text-yellow-300',
  backlog: 'bg-zinc-500/20 text-zinc-300',
  todo: 'bg-blue-500/20 text-blue-300',
  in_progress: 'bg-amber-500/20 text-amber-300',
  in_review: 'bg-purple-500/20 text-purple-300',
  done: 'bg-green-500/20 text-green-300',
  cancelled: 'bg-red-500/20 text-red-300',
};

export const DEFAULT_FILTER_TABS: FilterTab[] = [
  { id: '', label: 'All' },
  { id: 'triage', label: 'Needs Triage' },
  { id: 'todo,in_progress,in_review', label: 'Active' },
  { id: 'backlog', label: 'Backlog' },
  { id: 'done', label: 'Done' },
  { id: 'cancelled', label: 'Cancelled' },
];
