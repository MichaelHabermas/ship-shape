import { DocumentListToolbar } from '@/components/DocumentListToolbar';
import type { ViewMode } from '@/hooks/useListFilters';
import { Combobox } from '@/components/ui/Combobox';
import { cn } from '@/lib/cn';
import { ALL_COLUMNS, SORT_OPTIONS } from '@/components/issues/issues-list-constants';

export interface IssuesListHeaderProps {
  headerContent?: React.ReactNode;
  storageKeyPrefix: string;
  sortBy: string;
  onSortChange: (value: string) => void;
  viewModes: ViewMode[];
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  visibleColumns: Set<string>;
  onToggleColumn: (key: string) => void;
  hiddenCount: number;
  programFilterContent: React.ReactNode;
  projectFilterContent: React.ReactNode;
  sprintFilterContent: React.ReactNode;
  toolbarContent?: React.ReactNode;
  showBacklogPicker: boolean;
  canShowBacklogPicker: boolean;
  onOpenBacklogPicker: () => void;
  allowShowAllIssues: boolean;
  shouldSelfFetch: boolean;
  showAllIssues: boolean;
  onToggleShowAllIssues: () => void;
  showCreateButton: boolean;
  canCreateIssue: boolean;
  onCreateIssue: () => void;
  createButtonLabel: string;
  createButtonTestId?: string;
}

export function IssuesListHeader({
  headerContent,
  storageKeyPrefix,
  sortBy,
  onSortChange,
  viewModes,
  viewMode,
  onViewModeChange,
  visibleColumns,
  onToggleColumn,
  hiddenCount,
  programFilterContent,
  projectFilterContent,
  sprintFilterContent,
  toolbarContent,
  showBacklogPicker,
  canShowBacklogPicker,
  onOpenBacklogPicker,
  allowShowAllIssues,
  shouldSelfFetch,
  showAllIssues,
  onToggleShowAllIssues,
  showCreateButton,
  canCreateIssue,
  onCreateIssue,
  createButtonLabel,
  createButtonTestId,
}: IssuesListHeaderProps) {
  const combinedFilterContent = (programFilterContent || projectFilterContent || sprintFilterContent || toolbarContent) ? (
    <div className="flex items-center gap-2">
      {programFilterContent}
      {projectFilterContent}
      {sprintFilterContent}
      {toolbarContent}
    </div>
  ) : null;

  return (
    <div className="flex items-center justify-between border-b border-border px-6 py-4 gap-4">
      {headerContent || <div className="flex-shrink-0" />}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2 overflow-x-auto flex-shrink min-w-0">
          <DocumentListToolbar
            sortOptions={SORT_OPTIONS}
            sortBy={sortBy}
            onSortChange={onSortChange}
            viewModes={viewModes}
            viewMode={viewMode}
            onViewModeChange={onViewModeChange}
            allColumns={ALL_COLUMNS}
            visibleColumns={visibleColumns}
            onToggleColumn={onToggleColumn}
            hiddenCount={hiddenCount}
            showColumnPicker={viewMode === 'list'}
            filterContent={combinedFilterContent}
          />
          {showBacklogPicker && canShowBacklogPicker && (
            <button
              onClick={onOpenBacklogPicker}
              className="rounded-md border border-border px-2 py-1.5 text-sm text-muted hover:text-foreground hover:bg-border/30 transition-colors flex items-center gap-1.5 flex-shrink-0"
              title="Add from Backlog"
            >
              <svg className="h-4 w-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
              </svg>
              <span className="hidden lg:inline whitespace-nowrap">Add from Backlog</span>
            </button>
          )}
          {allowShowAllIssues && shouldSelfFetch && (
            <button
              onClick={onToggleShowAllIssues}
              className={cn(
                'rounded-md border px-2 py-1.5 text-sm transition-colors flex items-center gap-1.5 flex-shrink-0',
                showAllIssues
                  ? 'border-accent bg-accent/10 text-accent'
                  : 'border-border text-muted hover:text-foreground hover:bg-border/30'
              )}
              aria-pressed={showAllIssues}
              title={showAllIssues ? 'Showing all issues - click to show only in-context' : 'Click to show all issues'}
            >
              <svg className="h-4 w-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                {showAllIssues ? (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                ) : (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                )}
              </svg>
              <span className="hidden lg:inline whitespace-nowrap">{showAllIssues ? 'All Issues' : 'In Context'}</span>
            </button>
          )}
        </div>
        {showCreateButton && canCreateIssue && (
          <button
            onClick={onCreateIssue}
            className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent/90 transition-colors flex-shrink-0 whitespace-nowrap"
            data-testid={createButtonTestId}
          >
            {createButtonLabel}
          </button>
        )}
      </div>
    </div>
  );
}

export function IssuesListFilterCombobox({
  storageKeyPrefix,
  suffix,
  options,
  value,
  onChange,
  placeholder,
  ariaLabel,
}: {
  storageKeyPrefix: string;
  suffix: string;
  options: { value: string; label: string }[];
  value: string | null;
  onChange: (value: string | null) => void;
  placeholder: string;
  ariaLabel: string;
}) {
  if (options.length === 0) return null;
  return (
    <div className="w-40">
      <Combobox
        options={options}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        aria-label={ariaLabel}
        id={`${storageKeyPrefix}-${suffix}-filter`}
        allowClear={true}
        clearLabel={placeholder}
      />
    </div>
  );
}
