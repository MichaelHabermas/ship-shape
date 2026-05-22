import { cn } from '@/lib/cn';
import type { PlanAnalysisResult } from '@/components/ai/types';
import { scoreStyle, WORKLOAD_COLORS } from '@/components/ai/types';

function UnavailableNote({ hasAnalysis }: { hasAnalysis: boolean }) {
  return (
    <span className="text-xs text-muted/70">
      {hasAnalysis ? 'AI unavailable; showing last saved analysis' : 'AI unavailable'}
    </span>
  );
}

function QualitySkeleton({ message }: { message: string }) {
  return (
    <div className="mb-4 pl-8">
      <div className="w-full rounded-lg border border-border/50 bg-border/10 px-4 py-2.5">
        <div className="flex items-center gap-3">
          <div className="h-5 w-5 rounded-full bg-border/30 animate-pulse" />
          <div className="flex-1 h-2 rounded-full bg-border/20 overflow-hidden max-w-xs">
            <div className="h-full w-1/3 rounded-full bg-border/30 animate-pulse" />
          </div>
          <span className="text-xs text-muted/50">{message}</span>
        </div>
      </div>
    </div>
  );
}

function LoadingSpinner({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2">
      <svg className="w-4 h-4 animate-spin text-accent" viewBox="0 0 24 24" fill="none">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
      </svg>
      <span className="text-sm text-muted">{label}</span>
    </div>
  );
}

export interface QualityBannerShellProps {
  analysis: { overall_score: number } | null;
  loading: boolean;
  aiAvailable: boolean | null;
  loadingLabel: string;
  scoreLabel: string;
  skeletonMessage?: string;
  workload?: PlanAnalysisResult['workload_assessment'];
}

export function QualityBannerShell({
  analysis,
  loading,
  aiAvailable,
  loadingLabel,
  scoreLabel,
  skeletonMessage = 'AI quality check will appear as you write',
  workload,
}: QualityBannerShellProps) {
  if (aiAvailable === false && !analysis) {
    return (
      <div className="mb-4 pl-8">
        <div className="w-full rounded-lg border border-border/50 bg-border/10 px-4 py-2.5">
          <UnavailableNote hasAnalysis={false} />
        </div>
      </div>
    );
  }

  if (!analysis && !loading) {
    return <QualitySkeleton message={skeletonMessage} />;
  }

  const percentage = analysis ? Math.round(analysis.overall_score * 100) : 0;
  const { barColor, textColor, borderClass } = scoreStyle(percentage);

  return (
    <div className="mb-4 pl-8">
      <div
        className={cn(
          'w-full rounded-lg border px-4 py-2.5',
          analysis ? borderClass : 'border-border bg-border/20'
        )}
      >
        <div className="flex items-center gap-3">
          {loading ? (
            <LoadingSpinner label={loadingLabel} />
          ) : analysis ? (
            <>
              <span className={cn('text-lg font-bold tabular-nums', textColor)}>
                {percentage}%
              </span>
              <div className="flex-1 h-2 rounded-full bg-border/50 overflow-hidden max-w-xs">
                <div
                  className={cn('h-full rounded-full transition-all duration-700', barColor)}
                  style={{ width: `${percentage}%` }}
                />
              </div>
              <span className="text-xs text-muted">{scoreLabel}</span>
              {workload && (
                <span className={cn(
                  'px-2 py-0.5 rounded border text-xs font-medium',
                  WORKLOAD_COLORS[workload]
                )}>
                  {workload.charAt(0).toUpperCase() + workload.slice(1)}
                </span>
              )}
              {aiAvailable === false && <UnavailableNote hasAnalysis />}
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
