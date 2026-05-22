import { IssuesList } from '@/components/IssuesList';
import type { DocumentTabProps } from '@/lib/document-tabs';
import { getDocumentProgramId } from '@/lib/document-view-mapper';

/**
 * ProjectIssuesTab - Shows issues associated with a project
 *
 * This is the "Issues" tab content when viewing a project document.
 */
export default function ProjectIssuesTab({ documentId, document }: DocumentTabProps) {
  const programId = getDocumentProgramId(document) ?? undefined;

  return (
    <IssuesList
      lockedProjectId={documentId}
      showProgramFilter={false}
      showProjectFilter={false}
      enableKeyboardNavigation={false}
      showBacklogPicker={true}
      showCreateButton={true}
      allowShowAllIssues={true}
      inheritedContext={{
        projectId: documentId,
        programId,
      }}
    />
  );
}
