import { useState } from 'react';
import type { IssueIteration } from '@/components/sidebars/issue-sidebar-types';

export function UndoConversionBanner({
  onUndoConversion,
  isUndoing,
}: {
  onUndoConversion: () => void;
  isUndoing: boolean;
}) {
  return (
    <div className="mb-4 rounded-lg border border-blue-500/30 bg-blue-500/10 p-3">
      <p className="mb-2 text-sm text-blue-300">This issue was converted from a project.</p>
      <button
        onClick={onUndoConversion}
        disabled={isUndoing}
        className="w-full rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
      >
        {isUndoing ? (
          <>
            <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
            Undoing...
          </>
        ) : (
          <>
            <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M7.707 3.293a1 1 0 010 1.414L5.414 7H11a7 7 0 017 7v2a1 1 0 11-2 0v-2a5 5 0 00-5-5H5.414l2.293 2.293a1 1 0 11-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clipRule="evenodd" />
            </svg>
            Undo Conversion
          </>
        )}
      </button>
      <p className="mt-1 text-xs text-blue-300/70 text-center">Restore the original project</p>
    </div>
  );
}

export function IssueTriagePanel({
  onAccept,
  onReject,
}: {
  onAccept: () => Promise<void>;
  onReject: (reason: string) => Promise<void>;
}) {
  const [showRejectDialog, setShowRejectDialog] = useState(false);
  const [rejectReason, setRejectReason] = useState('');

  const handleReject = () => {
    if (rejectReason.trim()) {
      onReject(rejectReason.trim());
      setRejectReason('');
      setShowRejectDialog(false);
    }
  };

  return (
    <div className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
      <p className="mb-3 text-sm font-medium text-amber-300">Needs Triage</p>
      {!showRejectDialog ? (
        <div className="flex gap-2">
          <button
            onClick={onAccept}
            className="flex-1 rounded bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-700 transition-colors"
          >
            Accept
          </button>
          <button
            onClick={() => setShowRejectDialog(true)}
            className="flex-1 rounded bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 transition-colors"
          >
            Reject
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          <textarea
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            placeholder="Reason for rejection..."
            className="w-full rounded border border-border bg-border/50 px-2 py-1.5 text-sm text-foreground placeholder:text-muted focus:outline-none focus:ring-1 focus:ring-accent"
            rows={2}
          />
          <div className="flex gap-2">
            <button
              onClick={() => { setShowRejectDialog(false); setRejectReason(''); }}
              className="flex-1 rounded bg-border px-2 py-1 text-sm text-muted hover:text-foreground transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleReject}
              disabled={!rejectReason.trim()}
              className="flex-1 rounded bg-red-600 px-2 py-1 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50 transition-colors"
            >
              Reject
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function IssueBlockedPanel({
  latestBlockerIteration,
  blockerReason,
  onBlockerReasonChange,
  onSaveBlockerReason,
  blockerSaving,
  iterationsLoading,
  iterationError,
}: {
  latestBlockerIteration: IssueIteration | null;
  blockerReason: string;
  onBlockerReasonChange: (value: string) => void;
  onSaveBlockerReason: () => void;
  blockerSaving: boolean;
  iterationsLoading: boolean;
  iterationError: string | null;
}) {
  return (
    <div className="rounded border border-amber-500/30 bg-amber-500/10 p-3">
      <p className="text-sm font-medium text-amber-200">Blocked</p>
      {latestBlockerIteration ? (
        <p className="mt-1 text-xs text-amber-100/80">
          Latest blocker from {latestBlockerIteration.author.name}: {latestBlockerIteration.blockers_encountered}
        </p>
      ) : null}
      <textarea
        value={blockerReason}
        onChange={(event) => onBlockerReasonChange(event.target.value)}
        placeholder="What is blocking this issue?"
        aria-label="Blocker reason"
        rows={3}
        className="mt-3 w-full rounded border border-amber-500/30 bg-background px-2 py-1.5 text-sm text-foreground placeholder:text-muted focus:outline-none focus:ring-1 focus:ring-amber-400"
      />
      <button
        type="button"
        onClick={onSaveBlockerReason}
        disabled={!blockerReason.trim() || blockerSaving}
        className="mt-2 w-full rounded bg-amber-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-amber-700 disabled:opacity-50"
      >
        {blockerSaving ? 'Saving...' : 'Record blocker reason'}
      </button>
      {iterationsLoading && (
        <p className="mt-2 text-xs text-muted" role="status" aria-live="polite">Loading blocker history...</p>
      )}
      {iterationError && (
        <p className="mt-2 text-xs text-red-300" role="alert">{iterationError}</p>
      )}
    </div>
  );
}
