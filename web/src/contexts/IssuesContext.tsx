/**
 * @deprecated Use useUnifiedDocuments from '@/hooks/useUnifiedDocuments' instead.
 *
 * This context is maintained for backward compatibility but should not be used
 * for new code. The unified document model treats all document types consistently
 * through a single hook.
 *
 * Migration:
 *   Before: const { issues } = useIssues()
 *   After:  const { byType: { issue: issues } } = useUnifiedDocuments({ type: 'issue' })
 */
import { createContext, useContext, ReactNode } from 'react';
import { useIssues as useIssuesQuery, IssueListItem, Issue, CreateIssueOptions } from '@/hooks/useIssuesQuery';

export type { IssueListItem, Issue, CreateIssueOptions };

interface IssuesContextValue {
  issues: IssueListItem[];
  loading: boolean;
  createIssue: (options?: CreateIssueOptions) => Promise<Issue | null>;
  updateIssue: (id: string, updates: Partial<Issue>) => Promise<Issue | null>;
  refreshIssues: () => Promise<void>;
}

const IssuesContext = createContext<IssuesContextValue | null>(null);

export function IssuesProvider({ children }: { children: ReactNode }) {
  const issuesData = useIssuesQuery();

  return (
    <IssuesContext.Provider value={issuesData}>
      {children}
    </IssuesContext.Provider>
  );
}

export function useIssues() {
  const context = useContext(IssuesContext);
  if (!context) {
    throw new Error('useIssues must be used within IssuesProvider');
  }
  return context;
}
