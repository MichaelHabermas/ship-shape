import React from 'react';

/**
 * Document Tab Configuration System
 *
 * This registry defines which tabs appear for each document type when viewed
 * in the UnifiedDocumentPage. Each document type can have its own set of tabs
 * with custom labels and components.
 */

/**
 * DocumentResponse represents the shape of a document from the API.
 * This is a flexible type since documents can have various properties
 * depending on their type.
 */
export interface DocumentResponse extends Record<string, unknown> {
  id: string;
  title: string;
  document_type: string;
  properties?: Record<string, unknown>;
  workspace_id?: string;
  created_at?: string;
  updated_at?: string;
  created_by?: string | null;
  belongs_to?: unknown[];
  // Common optional fields
  program_id?: string | null;
  owner_id?: string | null;
  color?: string;
  emoji?: string | null;
  fleetGraphFindingCount?: number;
}

export interface DocumentTabProps {
  documentId: string;
  document: DocumentResponse;
  /** Nested path segments after the tab, e.g., for /documents/:id/weeks/:weekId, nestedPath would be the weekId */
  nestedPath?: string;
}

export interface DocumentTabConfig {
  id: string;
  label: string | ((doc: DocumentResponse, counts?: TabCounts) => string);
  component: React.ComponentType<DocumentTabProps>;
}

export interface TabCounts {
  issues?: number;
  weeks?: number;
  projects?: number;
  fleetGraphFindings?: number;
}

// Lazy load tab components to avoid circular dependencies
const ProjectDetailsTab = React.lazy(() => import('@/components/document-tabs/ProjectDetailsTab'));
const ProjectIssuesTab = React.lazy(() => import('@/components/document-tabs/ProjectIssuesTab'));
const ProjectWeeksTab = React.lazy(() => import('@/components/document-tabs/ProjectWeeksTab'));
const ProjectRetroTab = React.lazy(() => import('@/components/document-tabs/ProjectRetroTab'));

const ProgramOverviewTab = React.lazy(() => import('@/components/document-tabs/ProgramOverviewTab'));
const ProgramIssuesTab = React.lazy(() => import('@/components/document-tabs/ProgramIssuesTab'));
const ProgramProjectsTab = React.lazy(() => import('@/components/document-tabs/ProgramProjectsTab'));
const ProgramWeeksTab = React.lazy(() => import('@/components/document-tabs/ProgramWeeksTab'));

const WeekOverviewTab = React.lazy(() => import('@/components/document-tabs/WeekOverviewTab'));
const WeekPlanningTab = React.lazy(() => import('@/components/document-tabs/WeekPlanningTab'));
const WeekIssuesTab = React.lazy(() => import('@/components/document-tabs/WeekIssuesTab'));
const WeekReviewTab = React.lazy(() => import('@/components/document-tabs/WeekReviewTab'));
const WeekStandupsTab = React.lazy(() => import('@/components/document-tabs/WeekStandupsTab'));

/**
 * Tab configurations for each document type.
 *
 * Document types without tabs (wiki, issue) will render directly
 * in the editor without a tab bar.
 */
export const documentTabConfigs: Record<string, DocumentTabConfig[]> = {
  project: [
    {
      id: 'issues',
      label: (_, counts) => counts?.issues ? `Issues (${counts.issues})` : 'Issues',
      component: ProjectIssuesTab,
    },
    {
      id: 'details',
      label: 'Details',
      component: ProjectDetailsTab,
    },
    {
      id: 'weeks',
      label: 'Weeks',
      component: ProjectWeeksTab,
    },
    {
      id: 'retro',
      label: 'Retro',
      component: ProjectRetroTab,
    },
  ],

  program: [
    {
      id: 'overview',
      label: 'Overview',
      component: ProgramOverviewTab,
    },
    {
      id: 'issues',
      label: (_, counts) => counts?.issues ? `Issues (${counts.issues})` : 'Issues',
      component: ProgramIssuesTab,
    },
    {
      id: 'projects',
      label: (_, counts) => counts?.projects ? `Projects (${counts.projects})` : 'Projects',
      component: ProgramProjectsTab,
    },
    {
      id: 'weeks',
      label: (_, counts) => counts?.weeks ? `Weeks (${counts.weeks})` : 'Weeks',
      component: ProgramWeeksTab,
    },
  ],

  // Sprint tabs are dynamic based on status - see getTabsForDocument()
  // Default sprint tabs (shown when status is unknown)
  sprint: [
    {
      id: 'overview',
      label: 'Overview',
      component: WeekOverviewTab,
    },
    {
      id: 'plan',
      label: 'Plan',
      component: WeekPlanningTab,
    },
    {
      id: 'review',
      label: 'Review',
      component: WeekReviewTab,
    },
    {
      id: 'standups',
      label: 'Standups',
      component: WeekStandupsTab,
    },
  ],
  // Planning sprint tabs (status = 'planning')
  'sprint:planning': [
    {
      id: 'overview',
      label: 'Overview',
      component: WeekOverviewTab,
    },
    {
      id: 'plan',
      label: 'Plan',
      component: WeekPlanningTab,
    },
  ],
  // Active/completed sprint tabs (status = 'active' or 'completed')
  'sprint:active': [
    {
      id: 'overview',
      label: 'Overview',
      component: WeekOverviewTab,
    },
    {
      id: 'issues',
      label: (_, counts) => counts?.fleetGraphFindings ? `Issues (${counts.fleetGraphFindings})` : 'Issues',
      component: WeekIssuesTab,
    },
    {
      id: 'review',
      label: 'Review',
      component: WeekReviewTab,
    },
    {
      id: 'standups',
      label: 'Standups',
      component: WeekStandupsTab,
    },
  ],

  // Document types without tabs - render directly in editor
  issue: [],
  wiki: [],
};

/**
 * Get tab configuration for a document type.
 * Returns empty array if document type has no tabs.
 *
 * Note: For sprints, use getTabsForDocument() instead to get status-aware tabs.
 */
export function getTabsForDocumentType(documentType: string): DocumentTabConfig[] {
  return documentTabConfigs[documentType] || [];
}

/**
 * Get tab configuration for a specific document, considering document properties.
 * This is the preferred method as it handles dynamic tabs (e.g., sprint status).
 *
 * For sprints:
 * - Planning status: shows ['overview', 'plan']
 * - Active/Completed status: shows ['overview', 'issues', 'review', 'standups']
 */
export function getTabsForDocument(document: DocumentResponse): DocumentTabConfig[] {
  const { document_type } = document;

  // Handle sprint-specific dynamic tabs based on status
  if (document_type === 'sprint') {
    // Status is stored in properties.status
    const properties = document.properties as { status?: string } | undefined;
    const status = properties?.status || 'planning';

    if (status === 'planning' && !document.fleetGraphFindingCount) {
      return documentTabConfigs['sprint:planning'] || documentTabConfigs.sprint || [];
    } else {
      // active, completed, or any other status uses active tabs
      return documentTabConfigs['sprint:active'] || documentTabConfigs.sprint || [];
    }
  }

  // For all other document types, use standard lookup
  return documentTabConfigs[document_type] || [];
}

/**
 * Check if a document type has tabs.
 */
export function documentTypeHasTabs(documentType: string): boolean {
  const tabs = documentTabConfigs[documentType];
  return tabs !== undefined && tabs.length > 0;
}

/**
 * Get resolved tab labels with counts applied.
 */
export function resolveTabLabels(
  tabs: DocumentTabConfig[],
  document: DocumentResponse,
  counts?: TabCounts
): Array<{ id: string; label: string }> {
  return tabs.map(tab => ({
    id: tab.id,
    label: typeof tab.label === 'function' ? tab.label(document, counts) : tab.label,
  }));
}
