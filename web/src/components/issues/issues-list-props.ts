import type { Issue, IssueListItem } from '@/contexts/IssuesContext';
import type { FilterTab } from '@/components/FilterTabs';
import type { ViewMode } from '@/hooks/useListFilters';

export interface IssuesListProps {
  issues?: IssueListItem[];
  loading?: boolean;
  onUpdateIssue?: (id: string, updates: Partial<Issue>) => Promise<Issue | null>;
  onCreateIssue?: () => Promise<Issue | null>;
  onRefreshIssues?: () => Promise<void>;
  storageKeyPrefix?: string;
  filterTabs?: FilterTab[] | null;
  initialStateFilter?: string;
  onStateFilterChange?: (filter: string) => void;
  urlParamPrefix?: string;
  showProgramFilter?: boolean;
  showProjectFilter?: boolean;
  showSprintFilter?: boolean;
  lockedProgramId?: string;
  lockedProjectId?: string;
  lockedSprintId?: string;
  inheritedContext?: {
    programId?: string;
    projectId?: string;
    sprintId?: string;
    assigneeId?: string;
  };
  showCreateButton?: boolean;
  createButtonLabel?: string;
  createButtonTestId?: string;
  viewModes?: ViewMode[];
  initialViewMode?: ViewMode;
  defaultColumns?: string[];
  enableKeyboardNavigation?: boolean;
  emptyState?: React.ReactNode;
  showPromoteToProject?: boolean;
  className?: string;
  headerContent?: React.ReactNode;
  hideHeader?: boolean;
  toolbarContent?: React.ReactNode;
  selectionPersistenceKey?: string;
  enableInlineSprintAssignment?: boolean;
  showBacklogPicker?: boolean;
  allowShowAllIssues?: boolean;
}
