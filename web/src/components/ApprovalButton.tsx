import { useState, useCallback } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import type { ApprovalTracking } from '@ship/shared';
import { DiffViewer, tipTapToPlainText } from '@/components/DiffViewer';
import { apiPost, readJson } from '@/lib/api';
import type { LegacyErrorResponse } from '@/api/schemas';

// Inline SVG icons
function CheckCircleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}

function RefreshIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
    </svg>
  );
}

function ClockIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}

function EyeIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
    </svg>
  );
}

function CloseIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}

interface ApprovalButtonProps {
  /** The type of content being approved */
  type: 'plan' | 'review' | 'retro';
  /** Current approval tracking state */
  approval: ApprovalTracking | null | undefined;
  /** Whether the content exists (can't approve empty content) */
  hasContent: boolean;
  /** Whether current user can approve (is accountable or workspace admin) */
  canApprove: boolean;
  /** API endpoint to call for approval (e.g., '/api/weeks/123/approve-plan') */
  approveEndpoint: string;
  /** Name of the person who approved (for display) */
  approverName?: string;
  /** Current content (for diff viewer) */
  currentContent?: string | Record<string, unknown>;
  /** Approved version content (for diff viewer) */
  approvedContent?: string | Record<string, unknown>;
  /** Callback when approval succeeds */
  onApproved?: (approval: ApprovalTracking) => void;
}

interface ApprovalSuccessResponse {
  success: boolean;
  approval: ApprovalTracking;
}

interface ApprovalErrorBody extends LegacyErrorResponse {
  message?: string;
}

export function ApprovalButton({
  type,
  approval,
  hasContent,
  canApprove,
  approveEndpoint,
  approverName,
  currentContent,
  approvedContent,
  onApproved,
}: ApprovalButtonProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [showDiff, setShowDiff] = useState(false);

  const state = approval?.state ?? null;
  const approvedAt = approval?.approved_at;

  const handleApprove = useCallback(async () => {
    if (!canApprove || isLoading) return;

    setIsLoading(true);
    try {
      const response = await apiPost(approveEndpoint);

      if (!response.ok) {
        const error = await readJson<ApprovalErrorBody>(response);
        throw new Error(error.message || error.error || 'Failed to approve');
      }

      const data = await readJson<ApprovalSuccessResponse>(response);
      onApproved?.(data.approval);
    } catch (err) {
      console.error('Approval failed:', err);
    } finally {
      setIsLoading(false);
    }
  }, [canApprove, isLoading, approveEndpoint, onApproved]);

  // Format approval date for display
  const formatDate = (dateStr: string | null | undefined) => {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: date.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined,
    });
  };

  // Convert content to string for diff
  const getContentString = (content: string | Record<string, unknown> | undefined): string => {
    if (!content) return '';
    if (typeof content === 'string') return content;
    return tipTapToPlainText(content);
  };

  // Type label for display
  const typeLabel = type === 'plan' ? 'Plan' : type === 'review' ? 'Review' : 'Retrospective';

  // If user can't approve, don't show the button section
  if (!canApprove) {
    return null;
  }

  // If no content exists, show disabled state
  if (!hasContent) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted">
        <ClockIcon className="h-3.5 w-3.5" />
        <span>Write {typeLabel.toLowerCase()} to enable approval</span>
      </div>
    );
  }

  // Approved state - show checkmark with details
  if (state === 'approved') {
    return (
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1.5 text-green-600 dark:text-green-400">
          <CheckCircleIcon className="h-4 w-4" />
          <span className="text-xs font-medium">Approved</span>
        </div>
        <span className="text-xs text-muted">
          by {approverName || 'Admin'} on {formatDate(approvedAt)}
        </span>
      </div>
    );
  }

  // Changes requested - show feedback and indicate revision needed
  if (state === 'changes_requested') {
    const feedbackText = approval?.feedback;
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-1.5 text-purple-600 dark:text-purple-400">
          <RefreshIcon className="h-4 w-4" />
          <span className="text-xs font-medium">Changes Requested</span>
        </div>
        {feedbackText && (
          <div className="rounded-md bg-purple-500/10 border border-purple-500/20 px-3 py-2 text-xs text-purple-200">
            {feedbackText}
          </div>
        )}
        <span className="text-xs text-muted">
          by {approverName || 'Manager'} on {formatDate(approvedAt)}
        </span>
      </div>
    );
  }

  // Changed since approved - show re-approve button and view changes link
  if (state === 'changed_since_approved') {
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <button
            onClick={handleApprove}
            disabled={isLoading}
            className="flex items-center gap-1.5 rounded bg-amber-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-800 disabled:opacity-50 transition-colors"
          >
            {isLoading ? (
              <>
                <RefreshIcon className="h-3.5 w-3.5 animate-spin" />
                Approving...
              </>
            ) : (
              <>
                <RefreshIcon className="h-3.5 w-3.5" />
                Re-approve {typeLabel}
              </>
            )}
          </button>
        </div>
        <button
          onClick={() => setShowDiff(true)}
          className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400 hover:underline"
        >
          <EyeIcon className="h-3 w-3" />
          View changes since last approval
        </button>

        {/* Diff Modal */}
        <Dialog.Root open={showDiff} onOpenChange={setShowDiff}>
          <Dialog.Portal>
            <Dialog.Overlay className="fixed inset-0 z-[100] bg-black/60" />
            <Dialog.Content className="fixed left-1/2 top-1/2 z-[101] max-w-2xl w-full max-h-[80vh] -translate-x-1/2 -translate-y-1/2 rounded-lg bg-background p-6 shadow-xl overflow-y-auto">
              <div className="flex items-center justify-between mb-4">
                <Dialog.Title className="text-lg font-semibold text-foreground">
                  Changes Since Last Approval
                </Dialog.Title>
                <Dialog.Close className="rounded p-1 hover:bg-muted transition-colors">
                  <CloseIcon className="h-5 w-5 text-muted-foreground" />
                </Dialog.Close>
              </div>
              <p className="text-sm text-muted mb-4">
                Previously approved by {approverName || 'Admin'} on {formatDate(approvedAt)}
              </p>
              <DiffViewer
                oldContent={getContentString(approvedContent)}
                newContent={getContentString(currentContent)}
                className="p-4 rounded-lg bg-muted/30 border border-border"
              />
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
      </div>
    );
  }

  // Default: not yet approved - show approve button
  return (
    <button
      onClick={handleApprove}
      disabled={isLoading}
      className="flex items-center gap-1.5 rounded bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent/90 disabled:opacity-50 transition-colors"
    >
      {isLoading ? (
        <>
          <RefreshIcon className="h-3.5 w-3.5 animate-spin" />
          Approving...
        </>
      ) : (
        <>
          <CheckCircleIcon className="h-3.5 w-3.5" />
          Approve {typeLabel}
        </>
      )}
    </button>
  );
}
