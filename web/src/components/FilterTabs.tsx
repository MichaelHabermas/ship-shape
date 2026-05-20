import { cn } from '@/lib/cn';

export interface FilterTab {
  id: string;
  label: string;
  icon?: React.ReactNode;
  count?: number;
}

export interface FilterTabsProps {
  tabs: FilterTab[];
  activeId: string;
  onChange: (id: string) => void;
  ariaLabel: string;
}

/**
 * Reusable filter tabs component for list views.
 * Used by Issues (state filters), Documents (visibility filters), etc.
 */
export function FilterTabs({ tabs, activeId, onChange, ariaLabel }: FilterTabsProps) {
  return (
    <div className="flex gap-1 border-b border-border px-6 py-2" role="tablist" aria-label={ariaLabel}>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          id={`filter-${tab.id}`}
          role="tab"
          aria-selected={activeId === tab.id}
          onClick={() => onChange(tab.id)}
          className={cn(
            'flex items-center gap-1.5 rounded-md px-3 py-1 text-sm transition-colors',
            activeId === tab.id
              ? 'bg-border text-foreground'
              : 'text-muted hover:bg-border/50 hover:text-foreground'
          )}
        >
          {tab.icon}
          {tab.label}
          {tab.count !== undefined && (
            <span className={cn(
              'ml-1 rounded-full px-1.5 py-0.5 text-xs font-medium',
              activeId === tab.id
                ? 'bg-foreground/10 text-foreground'
                : 'bg-muted/30 text-foreground'
            )}>
              {tab.count}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
