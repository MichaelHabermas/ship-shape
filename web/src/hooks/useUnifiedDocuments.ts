/**
 * useUnifiedDocuments - Unified document access hook
 *
 * This hook provides a single entry point for querying all document types,
 * treating issues, projects, programs, and wiki documents uniformly per the
 * unified document model philosophy.
 *
 * Usage:
 *   useUnifiedDocuments()                  // All document types
 *   useUnifiedDocuments({ type: 'issue' }) // Only issues
 *   useUnifiedDocuments({ type: ['wiki', 'issue'] }) // Multiple types
 */
import { useMemo } from 'react';
import { useDocumentsQuery, WikiDocument } from './useDocumentsQuery';
import { useIssuesQuery, IssueListItem, Issue } from './useIssuesQuery';
import { useProjectsQuery, Project } from './useProjectsQuery';
import { useProgramsQuery, Program } from './useProgramsQuery';

// Document types that can be queried
/** Document types available in list/catalog queries (not full editor union). */
export type CatalogDocumentType = 'wiki' | 'issue' | 'project' | 'program';

/** @deprecated Use {@link CatalogDocumentType} */
export type UnifiedDocumentType = CatalogDocumentType;

// Base document interface - common fields across all types
export interface CatalogDocumentBase {
  id: string;
  title: string;
  document_type: string;
  created_at?: string;
  updated_at?: string;
  created_by?: string | null;
}

/** @deprecated Use {@link CatalogDocumentBase} */
export type UnifiedDocumentBase = CatalogDocumentBase;

/** OpenAPI list union for catalog surfaces (issues list, projects, programs, wiki). */
export type CatalogDocument = WikiDocument | IssueListItem | Project | Program;

/** @deprecated Use {@link CatalogDocument} — collides with editor {@link UnifiedDocumentView}. */
export type UnifiedDocument = CatalogDocument;

// Options for querying documents
export interface UseUnifiedDocumentsOptions {
  /**
   * Filter by document type(s). If not specified, returns all types.
   */
  type?: CatalogDocumentType | CatalogDocumentType[];
  /**
   * Enable/disable specific document types. Useful for partial fetching.
   * @default All types enabled
   */
  enabled?: {
    wiki?: boolean;
    issue?: boolean;
    project?: boolean;
    program?: boolean;
  };
}

// Return type for the unified hook
export interface UseUnifiedDocumentsResult {
  /** All documents matching the query */
  documents: CatalogDocument[];
  /** Documents grouped by type for type-safe access */
  byType: {
    wiki: WikiDocument[];
    issue: IssueListItem[];
    project: Project[];
    program: Program[];
  };
  /** Overall loading state (true if any type is loading) */
  loading: boolean;
  /** Loading state by type */
  loadingByType: {
    wiki: boolean;
    issue: boolean;
    project: boolean;
    program: boolean;
  };
  /** Refresh all document types */
  refresh: () => Promise<void>;
  /** Refresh specific document type */
  refreshType: (type: CatalogDocumentType) => Promise<void>;
}

/**
 * Unified document access hook.
 *
 * This replaces the fragmented type-specific contexts (IssuesContext, ProjectsContext,
 * ProgramsContext) with a single unified interface that treats all documents consistently.
 */
export function useUnifiedDocuments(
  options: UseUnifiedDocumentsOptions = {}
): UseUnifiedDocumentsResult {
  const { type, enabled = {} } = options;

  // Normalize type filter to array
  const typeFilter = type
    ? Array.isArray(type)
      ? type
      : [type]
    : null; // null means all types

  // Determine which queries to run
  const shouldFetchWiki =
    (enabled.wiki !== false) && (!typeFilter || typeFilter.includes('wiki'));
  const shouldFetchIssue =
    (enabled.issue !== false) && (!typeFilter || typeFilter.includes('issue'));
  const shouldFetchProject =
    (enabled.project !== false) && (!typeFilter || typeFilter.includes('project'));
  const shouldFetchProgram =
    (enabled.program !== false) && (!typeFilter || typeFilter.includes('program'));

  // Run queries conditionally
  const wikiQuery = useDocumentsQuery('wiki');
  const issuesQuery = useIssuesQuery();
  const projectsQuery = useProjectsQuery();
  const programsQuery = useProgramsQuery();

  // Extract data with appropriate filtering
  const wikiDocs = useMemo(() => {
    if (!shouldFetchWiki) return [];
    return (wikiQuery.data || []);
  }, [shouldFetchWiki, wikiQuery.data]);

  const issueDocs = useMemo(() => {
    if (!shouldFetchIssue) return [];
    return (issuesQuery.data || []);
  }, [shouldFetchIssue, issuesQuery.data]);

  const projectDocs = useMemo(() => {
    if (!shouldFetchProject) return [];
    return (projectsQuery.data || []);
  }, [shouldFetchProject, projectsQuery.data]);

  const programDocs = useMemo(() => {
    if (!shouldFetchProgram) return [];
    return (programsQuery.data || []);
  }, [shouldFetchProgram, programsQuery.data]);

  // Combine all documents
  const documents = useMemo<CatalogDocument[]>(() => {
    return [
      ...wikiDocs,
      ...issueDocs,
      ...projectDocs,
      ...programDocs,
    ];
  }, [wikiDocs, issueDocs, projectDocs, programDocs]);

  // Loading states
  const loadingByType = {
    wiki: shouldFetchWiki && wikiQuery.isLoading,
    issue: shouldFetchIssue && issuesQuery.isLoading,
    project: shouldFetchProject && projectsQuery.isLoading,
    program: shouldFetchProgram && programsQuery.isLoading,
  };

  const loading =
    loadingByType.wiki ||
    loadingByType.issue ||
    loadingByType.project ||
    loadingByType.program;

  // Refresh functions
  const refresh = async () => {
    await Promise.all([
      shouldFetchWiki && wikiQuery.refetch(),
      shouldFetchIssue && issuesQuery.refetch(),
      shouldFetchProject && projectsQuery.refetch(),
      shouldFetchProgram && programsQuery.refetch(),
    ]);
  };

  const refreshType = async (docType: CatalogDocumentType) => {
    switch (docType) {
      case 'wiki':
        await wikiQuery.refetch();
        break;
      case 'issue':
        await issuesQuery.refetch();
        break;
      case 'project':
        await projectsQuery.refetch();
        break;
      case 'program':
        await programsQuery.refetch();
        break;
    }
  };

  return {
    documents,
    byType: {
      wiki: wikiDocs,
      issue: issueDocs,
      project: projectDocs,
      program: programDocs,
    },
    loading,
    loadingByType,
    refresh,
    refreshType,
  };
}

// Re-export types for convenience
export type { WikiDocument, IssueListItem, Issue, Project, Program };
