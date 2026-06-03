import { useState, useEffect } from 'react';
import { cn } from '@/lib/cn';
import { apiGet, readJson } from '@/lib/api';
import { OPM_RATINGS } from './reviews-types.js';
import type { BatchMode, SelectedCell, WeeklyDoc } from './reviews-types.js';
import { TipTapContent } from './ReviewTipTap.js';

/** Panel for reviewing plan/retro content */
export function ReviewPanel({
  selectedCell,
  batchMode,
  onClose,
  onApprovePlan,
  onRateRetro,
  onRequestChanges,
  onSkip,
}: {
  selectedCell: SelectedCell;
  batchMode: BatchMode | null;
  onClose: () => void;
  onApprovePlan: (personId: string, weekNumber: number, sprintId: string, comment?: string) => void;
  onRateRetro: (personId: string, weekNumber: number, sprintId: string, rating: number, comment?: string) => void;
  onRequestChanges: (personId: string, weekNumber: number, sprintId: string, type: 'plan' | 'retro', feedback: string) => void;
  onSkip?: () => void;
}) {
  const [planDoc, setPlanDoc] = useState<WeeklyDoc | null>(null);
  const [retroDoc, setRetroDoc] = useState<WeeklyDoc | null>(null);
  const [loadingDocs, setLoadingDocs] = useState(true);
  const [selectedRating, setSelectedRating] = useState<number | null>(null);
  const [approvalComment, setApprovalComment] = useState('');
  const [showFeedbackInput, setShowFeedbackInput] = useState(false);
  const [feedbackText, setFeedbackText] = useState('');

  // Fetch plan/retro content when selection changes
  useEffect(() => {
    setLoadingDocs(true);
    setPlanDoc(null);
    setRetroDoc(null);
    setSelectedRating(selectedCell.cell.reviewRating?.value ?? null);
    const existingComment = selectedCell.type === 'retro'
      ? selectedCell.cell.reviewApproval?.comment
      : selectedCell.cell.planApproval?.comment;
    setApprovalComment(existingComment ?? '');
    setShowFeedbackInput(false);
    setFeedbackText('');

    const fetchDocs = async () => {
      try {
        const params = new URLSearchParams({
          person_id: selectedCell.personId,
          week_number: String(selectedCell.weekNumber),
        });

        // Fetch plan and retro in parallel
        const [planRes, retroRes] = await Promise.all([
          apiGet(`/api/weekly-plans?${params}`),
          apiGet(`/api/weekly-retros?${params}`),
        ]);

        if (planRes.ok) {
          const plans = await readJson<WeeklyDoc[]>(planRes);
          if (plans.length > 0) setPlanDoc(plans[0]);
        }
        if (retroRes.ok) {
          const retros = await readJson<WeeklyDoc[]>(retroRes);
          if (retros.length > 0) setRetroDoc(retros[0]);
        }
      } catch (err) {
        console.error('Failed to fetch plan/retro:', err);
      } finally {
        setLoadingDocs(false);
      }
    };

    fetchDocs();
  }, [selectedCell.personId, selectedCell.weekNumber]);

  const isRetroMode = selectedCell.type === 'retro';
  const planApprovalState = selectedCell.cell.planApproval?.state;
  const canApprove = selectedCell.cell.hasPlan;

  return (
    <div className="w-[400px] flex-shrink-0 border-l border-border bg-background flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div>
          <div className="text-sm font-medium text-foreground">{selectedCell.personName}</div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted">{selectedCell.weekName} &middot; {isRetroMode ? 'Retro' : 'Plan'}</span>
            {batchMode && (
              <span className="rounded bg-accent/20 px-1.5 py-0.5 text-[10px] font-medium text-accent">
                {batchMode.currentIndex + 1} of {batchMode.queue.length}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1">
          {onSkip && (
            <button
              onClick={onSkip}
              className="rounded px-2 py-1 text-xs text-muted hover:text-foreground hover:bg-border/50"
            >
              Skip
            </button>
          )}
          <button
            onClick={onClose}
            className="rounded p-1 text-muted hover:text-foreground hover:bg-border/50"
            aria-label="Close panel"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {loadingDocs ? (
          <div className="flex items-center justify-center py-12 text-muted text-sm">Loading...</div>
        ) : isRetroMode ? (
          /* Retro mode: side-by-side plan vs retro */
          <div className="flex flex-col h-full">
            {/* Plan context (dimmed) */}
            <div className="border-b border-border">
              <div className="px-4 py-2 text-[10px] uppercase tracking-wider text-muted bg-border/20">Plan (context)</div>
              <div className="px-4 py-3 opacity-60">
                {planDoc ? (
                  <TipTapContent content={planDoc.content} />
                ) : (
                  <p className="text-sm text-muted italic">No plan submitted for this week</p>
                )}
              </div>
            </div>
            {/* Retro (primary) */}
            <div className="flex-1">
              <div className="px-4 py-2 text-[10px] uppercase tracking-wider text-muted bg-border/20">Retro</div>
              <div className="px-4 py-3">
                {retroDoc ? (
                  <TipTapContent content={retroDoc.content} />
                ) : (
                  <p className="text-sm text-muted italic">No retro submitted for this week</p>
                )}
              </div>
            </div>
          </div>
        ) : (
          /* Plan mode: show plan content */
          <div className="px-4 py-3">
            {planDoc ? (
              <TipTapContent content={planDoc.content} />
            ) : (
              <p className="text-sm text-muted italic">No plan submitted for this week</p>
            )}
          </div>
        )}
      </div>

      {/* Previous feedback (when changes were already requested) */}
      {((isRetroMode && selectedCell.cell.reviewApproval?.state === 'changes_requested') ||
        (!isRetroMode && selectedCell.cell.planApproval?.state === 'changes_requested')) && (
        <div className="border-t border-border px-4 py-2 bg-purple-500/5">
          <div className="text-[10px] uppercase tracking-wider text-purple-400 mb-1">Previous Feedback</div>
          <p className="text-xs text-muted">
            {(isRetroMode ? (selectedCell.cell.reviewApproval as { feedback?: string })?.feedback : (selectedCell.cell.planApproval as { feedback?: string })?.feedback) || 'No feedback provided'}
          </p>
        </div>
      )}

      {/* Existing approval note */}
      {((isRetroMode && selectedCell.cell.reviewApproval?.comment) ||
        (!isRetroMode && selectedCell.cell.planApproval?.comment)) && (
        <div className="border-t border-border px-4 py-2 bg-border/20">
          <div className="text-[10px] uppercase tracking-wider text-muted mb-1">Approval Note</div>
          <p className="text-xs text-foreground">
            {isRetroMode ? selectedCell.cell.reviewApproval?.comment : selectedCell.cell.planApproval?.comment}
          </p>
        </div>
      )}

      {/* Action bar */}
      <div className="border-t border-border px-4 py-3">
        {showFeedbackInput ? (
          /* Feedback input for requesting changes */
          <div>
            <div className="text-xs text-muted mb-2">What needs to change?</div>
            <textarea
              value={feedbackText}
              onChange={e => setFeedbackText(e.target.value)}
              placeholder="Explain what needs to be revised..."
              rows={3}
              className="w-full rounded border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted resize-none focus:outline-none focus:ring-1 focus:ring-purple-500"
              autoFocus
            />
            <div className="flex gap-2 mt-2">
              <button
                onClick={() => {
                  if (feedbackText.trim()) {
                    onRequestChanges(
                      selectedCell.personId,
                      selectedCell.weekNumber,
                      selectedCell.sprintId,
                      selectedCell.type,
                      feedbackText.trim()
                    );
                    setShowFeedbackInput(false);
                    setFeedbackText('');
                  }
                }}
                disabled={!feedbackText.trim()}
                className={cn(
                  'flex-1 rounded py-2 text-sm font-medium transition-colors',
                  feedbackText.trim()
                    ? 'bg-purple-600 text-white hover:bg-purple-500 cursor-pointer'
                    : 'bg-border/30 text-muted cursor-not-allowed'
                )}
              >
                Submit Request
              </button>
              <button
                onClick={() => { setShowFeedbackInput(false); setFeedbackText(''); }}
                className="rounded px-3 py-2 text-sm text-muted hover:text-foreground hover:bg-border/50"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : isRetroMode ? (
          /* Rating controls for retro */
          <div>
            <div className="text-xs text-muted mb-2">Performance Rating</div>
            <div className="flex gap-1 mb-3">
              {OPM_RATINGS.map(r => (
                <button
                  key={r.value}
                  onClick={() => setSelectedRating(r.value)}
                  className={cn(
                    'flex-1 flex flex-col items-center gap-0.5 rounded py-1.5 text-xs transition-all',
                    selectedRating === r.value
                      ? 'bg-accent/20 ring-1 ring-accent'
                      : 'bg-border/30 hover:bg-border/50'
                  )}
                  title={r.label}
                >
                  <span className={cn('font-bold', r.color)}>{r.value}</span>
                  <span className="text-[9px] text-muted leading-tight">{r.label.split(' ')[0]}</span>
                </button>
              ))}
            </div>
            <label className="text-xs text-muted mb-1 block">Approval Note (optional)</label>
            <textarea
              value={approvalComment}
              onChange={e => setApprovalComment(e.target.value)}
              placeholder="Add context for this decision..."
              rows={3}
              className="w-full rounded border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted resize-none focus:outline-none focus:ring-1 focus:ring-accent mb-3"
            />
            <div className="flex gap-2">
              <button
                onClick={() => {
                  if (selectedRating) {
                    onRateRetro(
                      selectedCell.personId,
                      selectedCell.weekNumber,
                      selectedCell.sprintId,
                      selectedRating,
                      approvalComment
                    );
                  }
                }}
                disabled={!selectedRating || !retroDoc}
                className={cn(
                  'flex-1 rounded py-2 text-sm font-medium transition-colors',
                  selectedRating && retroDoc
                    ? 'bg-green-600 text-white hover:bg-green-500 cursor-pointer'
                    : 'bg-border/30 text-muted cursor-not-allowed'
                )}
              >
                {selectedCell.cell.reviewRating ? 'Update Approval' : 'Rate & Approve'}
              </button>
              {retroDoc && (
                <button
                  onClick={() => setShowFeedbackInput(true)}
                  className="rounded px-3 py-2 text-sm font-medium text-purple-400 hover:bg-purple-500/10 transition-colors"
                >
                  Request Changes
                </button>
              )}
            </div>
          </div>
        ) : (
          /* Plan actions: Approve + Request Changes */
          <div>
            <label className="text-xs text-muted mb-1 block">Approval Note (optional)</label>
            <textarea
              value={approvalComment}
              onChange={e => setApprovalComment(e.target.value)}
              placeholder="Add context for this decision..."
              rows={3}
              className="w-full rounded border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted resize-none focus:outline-none focus:ring-1 focus:ring-accent mb-3"
            />
            <div className="flex gap-2">
              <button
                onClick={() => onApprovePlan(selectedCell.personId, selectedCell.weekNumber, selectedCell.sprintId, approvalComment)}
                disabled={!canApprove}
                className={cn(
                  'flex-1 rounded py-2 text-sm font-medium transition-colors',
                  planApprovalState === 'approved'
                    ? 'bg-green-600 text-white hover:bg-green-500 cursor-pointer'
                    : canApprove
                      ? planApprovalState === 'changed_since_approved'
                        ? 'bg-orange-600 text-white hover:bg-orange-500 cursor-pointer'
                        : 'bg-green-600 text-white hover:bg-green-500 cursor-pointer'
                      : 'bg-border/30 text-muted cursor-not-allowed'
                )}
              >
                {planApprovalState === 'approved'
                  ? 'Update Approval'
                  : planApprovalState === 'changed_since_approved'
                    ? 'Re-approve Plan'
                    : 'Approve Plan'}
              </button>
              {canApprove && (
                <button
                  onClick={() => setShowFeedbackInput(true)}
                  className="rounded px-3 py-2 text-sm font-medium text-purple-400 hover:bg-purple-500/10 transition-colors"
                >
                  Request Changes
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}