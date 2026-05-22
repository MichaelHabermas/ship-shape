import { WeekReview } from '@/components/WeekReview';
import { WeekReconciliation } from '@/components/WeekReconciliation';
import type { DocumentTabProps } from '@/lib/document-tabs';
import { getDocumentProgramId } from '@/lib/document-view-mapper';
import { getRecord } from '@/lib/document-view-guards';

/**
 * SprintReviewTab - Sprint review view
 *
 * This tab shows the sprint review interface with:
 * - Sprint reconciliation for handling incomplete issues
 * - Sprint review editor for notes and plan validation
 *
 * Extracted from SprintViewPage.tsx review tab content.
 */
export default function SprintReviewTab({ documentId, document }: DocumentTabProps) {
  const programId = getDocumentProgramId(document);
  // Get sprint properties
  const properties = getRecord(document.properties);
  const sprintNumber = typeof properties?.sprint_number === 'number' ? properties.sprint_number : 1;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Sprint reconciliation for incomplete issues */}
      {programId && (
        <div className="border-b border-border p-4">
          <WeekReconciliation
            sprintId={documentId}
            sprintNumber={sprintNumber}
            programId={programId}
            onDecisionMade={() => {
              // Refresh handled internally by SprintReconciliation
            }}
          />
        </div>
      )}
      {/* Sprint review editor */}
      <div className="flex-1 overflow-auto pb-20">
        <WeekReview sprintId={documentId} />
      </div>
    </div>
  );
}
