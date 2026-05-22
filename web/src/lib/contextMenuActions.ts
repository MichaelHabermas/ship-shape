/**
 * Centralized Context Menu Action Registry
 *
 * Defines available context menu actions per document type with:
 * - Action metadata (id, label, icon)
 * - Visibility conditions (single-select only, bulk-safe, destructive)
 * - Submenu definitions for nested actions
 *
 * Usage:
 *   const actions = getContextMenuActions('issue', { isBulkSelect: true });
 *   actions.forEach(action => renderMenuItem(action));
 */

import { DocumentType, IssueState, IssuePriority, DocumentVisibility, ISSUE_STATE_OPTIONS } from '@ship/shared';
import { ReactNode } from 'react';

// Action handler context passed to action handlers
export interface ActionContext {
  selectedIds: string[];
  // Callbacks provided by the consuming component
  onArchive?: () => void;
  onDelete?: () => void;
  onRestore?: () => void;
  onChangeStatus?: (status: IssueState) => void;
  onChangePriority?: (priority: IssuePriority) => void;
  onMoveToSprint?: (sprintId: string | null) => void;
  onAssignTo?: (personId: string | null) => void;
  onChangeVisibility?: (visibility: DocumentVisibility) => void;
  onRename?: () => void;
  onDuplicate?: () => void;
  onCreateSubdocument?: () => void;
  onOpen?: () => void;
  onOpenInNewTab?: () => void;
  onCopyLink?: () => void;
  onEditCapacity?: () => void;
  onRemoveFromWorkspace?: () => void;
  onStartSprint?: () => void;
  onEndSprint?: () => void;
  onViewPlan?: () => void;
  onViewRetro?: () => void;
  onChangeColor?: (color: string) => void;
  onChangeEmoji?: (emoji: string) => void;
}

// Base action definition
export interface ContextAction {
  id: string;
  label: string;
  icon?: ReactNode;
  /** Only show for single-select (not bulk) */
  singleOnly?: boolean;
  /** Safe to use with multiple selected items */
  bulkSafe?: boolean;
  /** Destructive action (shown in red, at bottom) */
  destructive?: boolean;
  /** Disabled with optional reason */
  disabled?: boolean;
  disabledReason?: string;
  /** Handler key from ActionContext */
  handlerKey?: keyof ActionContext;
}

// Submenu action with nested items
export interface ContextSubmenuAction extends ContextAction {
  type: 'submenu';
  /** Submenu items fetched dynamically or static */
  items: ContextAction[] | (() => Promise<ContextAction[]>);
}

// Simple action
export interface ContextSimpleAction extends ContextAction {
  type: 'action';
}

// Separator
export interface ContextSeparator {
  type: 'separator';
}

export type ContextMenuItem = ContextSimpleAction | ContextSubmenuAction | ContextSeparator;

// Issue priority options for submenu
export const ISSUE_PRIORITY_OPTIONS: { value: IssuePriority; label: string }[] = [
  { value: 'urgent', label: 'Urgent' },
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
];

// Visibility options for submenu
export const VISIBILITY_OPTIONS: { value: DocumentVisibility; label: string }[] = [
  { value: 'private', label: 'Private' },
  { value: 'workspace', label: 'Workspace' },
];

/**
 * Action definitions by document type
 */
const CONTEXT_ACTIONS: Record<DocumentType, ContextMenuItem[]> = {
  // Issue actions - most comprehensive, used as template for others
  issue: [
    {
      type: 'submenu',
      id: 'change-status',
      label: 'Change Status',
      bulkSafe: true,
      handlerKey: 'onChangeStatus',
      items: ISSUE_STATE_OPTIONS.map(opt => ({
        type: 'action' as const,
        id: `status-${opt.value}`,
        label: opt.label,
        bulkSafe: true,
      })),
    },
    {
      type: 'submenu',
      id: 'assign-to',
      label: 'Assign to',
      bulkSafe: true,
      handlerKey: 'onAssignTo',
      items: [], // Populated dynamically with team members
    },
    {
      type: 'submenu',
      id: 'move-to-sprint',
      label: 'Move to Week',
      bulkSafe: true,
      handlerKey: 'onMoveToSprint',
      items: [], // Populated dynamically with weeks
    },
    {
      type: 'action',
      id: 'archive',
      label: 'Archive',
      bulkSafe: true,
      handlerKey: 'onArchive',
    },
    { type: 'separator' },
    {
      type: 'action',
      id: 'delete',
      label: 'Delete',
      destructive: true,
      bulkSafe: true,
      handlerKey: 'onDelete',
    },
  ],

  // Wiki document actions
  wiki: [
    {
      type: 'action',
      id: 'create-subdocument',
      label: 'Create sub-document',
      singleOnly: true,
      handlerKey: 'onCreateSubdocument',
    },
    {
      type: 'action',
      id: 'rename',
      label: 'Rename',
      singleOnly: true,
      handlerKey: 'onRename',
    },
    {
      type: 'submenu',
      id: 'change-visibility',
      label: 'Change visibility',
      singleOnly: true,
      handlerKey: 'onChangeVisibility',
      items: VISIBILITY_OPTIONS.map(opt => ({
        type: 'action' as const,
        id: `visibility-${opt.value}`,
        label: opt.label,
      })),
    },
    { type: 'separator' },
    {
      type: 'action',
      id: 'delete',
      label: 'Delete',
      destructive: true,
      bulkSafe: true,
      handlerKey: 'onDelete',
    },
  ],

  // Program actions
  program: [
    {
      type: 'action',
      id: 'rename',
      label: 'Rename',
      singleOnly: true,
      handlerKey: 'onRename',
    },
    {
      type: 'submenu',
      id: 'change-color',
      label: 'Change color',
      singleOnly: true,
      handlerKey: 'onChangeColor',
      items: [], // Populated with color options
    },
    {
      type: 'action',
      id: 'archive',
      label: 'Archive',
      bulkSafe: true,
      handlerKey: 'onArchive',
    },
    { type: 'separator' },
    {
      type: 'action',
      id: 'delete',
      label: 'Delete',
      destructive: true,
      bulkSafe: true,
      handlerKey: 'onDelete',
    },
  ],

  // Project actions (similar to program)
  project: [
    {
      type: 'action',
      id: 'rename',
      label: 'Rename',
      singleOnly: true,
      handlerKey: 'onRename',
    },
    {
      type: 'action',
      id: 'archive',
      label: 'Archive',
      bulkSafe: true,
      handlerKey: 'onArchive',
    },
    { type: 'separator' },
    {
      type: 'action',
      id: 'delete',
      label: 'Delete',
      destructive: true,
      bulkSafe: true,
      handlerKey: 'onDelete',
    },
  ],

  // Week actions - state-dependent
  sprint: [
    {
      type: 'action',
      id: 'start-sprint',
      label: 'Start Week',
      singleOnly: true,
      handlerKey: 'onStartSprint',
    },
    {
      type: 'action',
      id: 'end-sprint',
      label: 'End Week',
      singleOnly: true,
      handlerKey: 'onEndSprint',
    },
    { type: 'separator' },
    {
      type: 'action',
      id: 'view-plan',
      label: 'View/Create Plan',
      singleOnly: true,
      handlerKey: 'onViewPlan',
    },
    {
      type: 'action',
      id: 'view-retro',
      label: 'View/Create Retro',
      singleOnly: true,
      handlerKey: 'onViewRetro',
    },
    { type: 'separator' },
    {
      type: 'action',
      id: 'delete',
      label: 'Delete',
      destructive: true,
      singleOnly: true,
      handlerKey: 'onDelete',
    },
  ],

  // Person actions
  person: [
    {
      type: 'action',
      id: 'open',
      label: 'View profile',
      singleOnly: true,
      handlerKey: 'onOpen',
    },
    {
      type: 'action',
      id: 'edit-capacity',
      label: 'Edit capacity',
      singleOnly: true,
      handlerKey: 'onEditCapacity',
    },
    { type: 'separator' },
    {
      type: 'action',
      id: 'remove-from-workspace',
      label: 'Remove from workspace',
      destructive: true,
      singleOnly: true,
      handlerKey: 'onRemoveFromWorkspace',
    },
  ],

  // Weekly plan/retro - minimal actions (these are typically opened, not managed)
  weekly_plan: [
    {
      type: 'action',
      id: 'open',
      label: 'Open',
      singleOnly: true,
      handlerKey: 'onOpen',
    },
    {
      type: 'action',
      id: 'open-new-tab',
      label: 'Open in new tab',
      singleOnly: true,
      handlerKey: 'onOpenInNewTab',
    },
    {
      type: 'action',
      id: 'copy-link',
      label: 'Copy link',
      singleOnly: true,
      handlerKey: 'onCopyLink',
    },
  ],

  weekly_retro: [
    {
      type: 'action',
      id: 'open',
      label: 'Open',
      singleOnly: true,
      handlerKey: 'onOpen',
    },
    {
      type: 'action',
      id: 'open-new-tab',
      label: 'Open in new tab',
      singleOnly: true,
      handlerKey: 'onOpenInNewTab',
    },
    {
      type: 'action',
      id: 'copy-link',
      label: 'Copy link',
      singleOnly: true,
      handlerKey: 'onCopyLink',
    },
  ],

  // Standup document actions - minimal (view/delete)
  standup: [
    {
      type: 'action',
      id: 'open',
      label: 'Open',
      singleOnly: true,
      handlerKey: 'onOpen',
    },
    { type: 'separator' },
    {
      type: 'action',
      id: 'delete',
      label: 'Delete',
      destructive: true,
      singleOnly: true,
      handlerKey: 'onDelete',
    },
  ],

  // Weekly review document actions - minimal (view only, tied to week)
  weekly_review: [
    {
      type: 'action',
      id: 'open',
      label: 'Open',
      singleOnly: true,
      handlerKey: 'onOpen',
    },
    {
      type: 'action',
      id: 'open-new-tab',
      label: 'Open in new tab',
      singleOnly: true,
      handlerKey: 'onOpenInNewTab',
    },
    {
      type: 'action',
      id: 'copy-link',
      label: 'Copy link',
      singleOnly: true,
      handlerKey: 'onCopyLink',
    },
  ],
};

// Backlink-specific actions (not a document type, but used in BacklinksPanel)
export const BACKLINK_ACTIONS: ContextMenuItem[] = [
  {
    type: 'action',
    id: 'open',
    label: 'Open',
    singleOnly: true,
    handlerKey: 'onOpen',
  },
  {
    type: 'action',
    id: 'open-new-tab',
    label: 'Open in new tab',
    singleOnly: true,
    handlerKey: 'onOpenInNewTab',
  },
  {
    type: 'action',
    id: 'copy-link',
    label: 'Copy link',
    singleOnly: true,
    handlerKey: 'onCopyLink',
  },
];

/**
 * Get context menu actions for a document type
 *
 * @param documentType - The document type
 * @param options - Filtering options
 * @returns Filtered list of context menu items
 */
export function getContextMenuActions(
  documentType: DocumentType,
  options: {
    /** If true, filter to only bulk-safe actions */
    isBulkSelect?: boolean;
    /** Number of selected items (shows count in header if provided) */
    selectedCount?: number;
  } = {}
): ContextMenuItem[] {
  const { isBulkSelect = false } = options;
  const actions = CONTEXT_ACTIONS[documentType] || [];

  if (!isBulkSelect) {
    // Single select: show all actions
    return actions;
  }

  // Bulk select: filter to only bulk-safe actions
  return actions.filter(action => {
    if (action.type === 'separator') {
      return true; // Keep separators, we'll clean them up later
    }
    return action.bulkSafe === true;
  }).filter((action, index, arr) => {
    // Remove consecutive separators and leading/trailing separators
    if (action.type === 'separator') {
      const prev = arr[index - 1];
      const next = arr[index + 1];
      // Remove if at start, end, or consecutive
      if (index === 0 || index === arr.length - 1) return false;
      if (prev?.type === 'separator') return false;
      if (!next || next.type === 'separator') return false;
    }
    return true;
  });
}

/**
 * Check if an action should be shown based on current state
 */
export function isActionVisible(
  action: ContextMenuItem,
  options: {
    isBulkSelect: boolean;
    isArchived?: boolean;
    sprintStatus?: 'active' | 'upcoming' | 'completed';
  }
): boolean {
  if (action.type === 'separator') return true;

  const { isBulkSelect, isArchived, sprintStatus } = options;

  // Hide single-only actions in bulk mode
  if (isBulkSelect && action.singleOnly) return false;

  // Hide non-bulk-safe actions in bulk mode
  if (isBulkSelect && !action.bulkSafe) return false;

  // Special handling for archived items
  if (isArchived) {
    // Only show restore and delete for archived items
    if (action.id !== 'restore' && action.id !== 'delete') return false;
  }

  // Sprint-specific visibility
  if (sprintStatus) {
    if (action.id === 'start-sprint' && sprintStatus !== 'upcoming') return false;
    if (action.id === 'end-sprint' && sprintStatus !== 'active') return false;
  }

  return true;
}

export { CONTEXT_ACTIONS };
