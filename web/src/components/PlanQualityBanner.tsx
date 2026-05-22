/**
 * PlanQualityBanner / RetroQualityBanner — Compact AI quality score bars.
 *
 * Renders between the document title and editor content. Shows a compact
 * score bar with overall percentage and workload badge. Per-item feedback
 * is rendered inline via AIScoringDisplay decorations in the editor.
 *
 * Uses content hashing (SHA-256) to skip re-analysis when content is unchanged.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { cn } from '@/lib/cn';

// Use raw fetch for AI quality checks — these are non-critical background requests
// that must NOT trigger session expiration redirects (apiGet/apiPost do that on 401).
const API_URL = import.meta.env.VITE_API_URL ?? '';

// CSRF token cache (shared with api.ts via module scope — but we maintain our own
// to avoid importing the helpers that redirect on 401).
let quietCsrfToken: string | null = null;

async function getQuietCsrfToken(): Promise<string | null> {
  if (quietCsrfToken) return quietCsrfToken;
  try {
    const res = await fetch(`${API_URL}/api/csrf-token`, { credentials: 'include' });
    if (!res.ok) return null;
    const data = await res.json();
    quietCsrfToken = data.token;
    return quietCsrfToken;
  } catch {
    return null;
  }
}

async function quietGet(endpoint: string): Promise<Response> {
  return fetch(`${API_URL}${endpoint}`, { credentials: 'include' });
}

async function quietPost(endpoint: string, body: object): Promise<Response> {
  const token = await getQuietCsrfToken();
  return fetch(`${API_URL}${endpoint}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { 'X-CSRF-Token': token } : {}),
    },
    credentials: 'include',
    body: JSON.stringify(body),
  });
}

async function quietPatch(endpoint: string, body: object): Promise<Response> {
  const token = await getQuietCsrfToken();
  return fetch(`${API_URL}${endpoint}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { 'X-CSRF-Token': token } : {}),
    },
    credentials: 'include',
    body: JSON.stringify(body),
  });
}

interface PlanItemAnalysis {
  text: string;
  score: number;
  feedback: string;
  issues: string[];
  conciseness_score?: number;
  is_verbose?: boolean;
  conciseness_feedback?: string;
}

interface PlanAnalysisResult {
  overall_score: number;
  items: PlanItemAnalysis[];
  workload_assessment: 'light' | 'moderate' | 'heavy' | 'excessive';
  workload_feedback: string;
  content_hash?: string;
}

/** Compute SHA-256 hash of content for cache invalidation (matches backend) */
async function computeContentHash(content: unknown): Promise<string> {
  const data = new TextEncoder().encode(JSON.stringify(content));
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

const WORKLOAD_COLORS = {
  light: 'text-yellow-400 bg-yellow-500/10 border-yellow-500/30',
  moderate: 'text-green-400 bg-green-500/10 border-green-500/30',
  heavy: 'text-blue-400 bg-blue-500/10 border-blue-500/30',
  excessive: 'text-red-400 bg-red-500/10 border-red-500/30',
};

function UnavailableNote({ hasAnalysis }: { hasAnalysis: boolean }) {
  return (
    <span className="text-xs text-muted/70">
      {hasAnalysis ? 'AI unavailable; showing last saved analysis' : 'AI unavailable'}
    </span>
  );
}

export function PlanQualityBanner({
  documentId,
  editorContent,
  onAnalysisChange,
}: {
  documentId: string;
  editorContent: Record<string, unknown> | null;
  onAnalysisChange?: (analysis: PlanAnalysisResult | null) => void;
}) {
  const [analysis, setAnalysisRaw] = useState<PlanAnalysisResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [aiAvailable, setAiAvailable] = useState<boolean | null>(null);
  const lastContentRef = useRef<string>('');
  const requestIdRef = useRef(0);
  const persistedHashRef = useRef<string | null>(null);
  const onAnalysisChangeRef = useRef(onAnalysisChange);
  onAnalysisChangeRef.current = onAnalysisChange;

  const setAnalysis = useCallback((data: PlanAnalysisResult | null) => {
    setAnalysisRaw(data);
    onAnalysisChangeRef.current?.(data);
  }, []);

  // Reinitialize state when switching documents, then load persisted data for this doc.
  useEffect(() => {
    let cancelled = false;

    // Invalidate any in-flight analysis from the previous document.
    requestIdRef.current++;
    lastContentRef.current = '';
    persistedHashRef.current = null;
    setLoading(false);
    setAiAvailable(null);
    setAnalysis(null);

    quietGet('/api/ai/status')
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (cancelled) return;
        setAiAvailable(data?.available === true);
      })
      .catch(() => {
        if (cancelled) return;
        setAiAvailable(false);
      });

    // Load last analysis from document properties (including content hash)
    quietGet(`/api/documents/${documentId}`)
      .then(r => r.ok ? r.json() : null)
      .then(doc => {
        if (cancelled) return;
        if (doc?.properties?.ai_analysis) {
          setAnalysis(doc.properties.ai_analysis);
          persistedHashRef.current = doc.properties.ai_analysis.content_hash || null;
        }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [documentId, setAnalysis]);

  // Save analysis to document properties
  const persistAnalysis = useCallback((data: PlanAnalysisResult) => {
    quietPatch(`/api/documents/${documentId}`, {
      properties: { ai_analysis: data },
    }).catch(() => {});
  }, [documentId]);

  // Run analysis (called on content change AND on initial load)
  const runAnalysis = useCallback(async (content: Record<string, unknown>) => {
    const contentStr = JSON.stringify(content);
    if (contentStr === lastContentRef.current) return;

    // Check persisted hash before calling API (avoids re-analysis on page load)
    if (persistedHashRef.current) {
      const currentHash = await computeContentHash(content);
      if (currentHash === persistedHashRef.current) {
        lastContentRef.current = contentStr;
        persistedHashRef.current = null;
        return;
      }
      persistedHashRef.current = null;
    }

    lastContentRef.current = contentStr;
    const thisRequestId = ++requestIdRef.current;
    setLoading(true);

    quietPost('/api/ai/analyze-plan', { content })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (thisRequestId !== requestIdRef.current) return;
        if (data && !data.error) {
          setAnalysis(data);
          persistAnalysis(data);
        } else if (data?.error === 'ai_unavailable') {
          setAiAvailable(false);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (thisRequestId !== requestIdRef.current) return;
        setLoading(false);
      });
  }, [persistAnalysis]);

  // Analyze when editorContent changes (debounced by Editor's onContentChange)
  useEffect(() => {
    if (!aiAvailable || !editorContent) return;
    runAnalysis(editorContent);
  }, [editorContent, aiAvailable, runAnalysis]);

  // On mount: if no persisted result, fetch content and run initial analysis
  useEffect(() => {
    if (!aiAvailable || analysis) return;
    let cancelled = false;
    quietGet(`/api/documents/${documentId}`)
      .then(r => r.ok ? r.json() : null)
      .then(doc => {
        if (cancelled) return;
        if (doc?.content) runAnalysis(doc.content);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [aiAvailable, documentId, analysis, runAnalysis]);

  if (aiAvailable === false && !analysis) {
    return (
      <div className="mb-4 pl-8">
        <div className="w-full rounded-lg border border-border/50 bg-border/10 px-4 py-2.5">
          <UnavailableNote hasAnalysis={false} />
        </div>
      </div>
    );
  }

  // Skeleton / waiting state — show before first analysis
  if (!analysis && !loading) {
    return (
      <div className="mb-4 pl-8">
        <div className="w-full rounded-lg border border-border/50 bg-border/10 px-4 py-2.5">
          <div className="flex items-center gap-3">
            <div className="h-5 w-5 rounded-full bg-border/30 animate-pulse" />
            <div className="flex-1 h-2 rounded-full bg-border/20 overflow-hidden max-w-xs">
              <div className="h-full w-1/3 rounded-full bg-border/30 animate-pulse" />
            </div>
            <span className="text-xs text-muted/50">AI quality check will appear as you write</span>
          </div>
        </div>
      </div>
    );
  }

  const percentage = analysis ? Math.round(analysis.overall_score * 100) : 0;
  const barColor = percentage >= 70 ? 'bg-green-500' : percentage >= 40 ? 'bg-yellow-500' : 'bg-red-500';
  const textColor = percentage >= 70 ? 'text-green-400' : percentage >= 40 ? 'text-yellow-400' : 'text-red-400';

  return (
    <div className="mb-4 pl-8">
      {/* Compact score bar — per-item feedback is shown inline via AIScoringDisplay decorations */}
      <div
        className={cn(
          'w-full rounded-lg border px-4 py-2.5',
          analysis
            ? percentage >= 70
              ? 'border-green-500/30 bg-green-500/5'
              : percentage >= 40
                ? 'border-yellow-500/30 bg-yellow-500/5'
                : 'border-red-500/30 bg-red-500/5'
            : 'border-border bg-border/20'
        )}
      >
        <div className="flex items-center gap-3">
          {loading ? (
            <div className="flex items-center gap-2">
              <svg className="w-4 h-4 animate-spin text-accent" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              <span className="text-sm text-muted">Analyzing plan quality...</span>
            </div>
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
              <span className="text-xs text-muted">Approval Likelihood</span>
              <span className={cn(
                'px-2 py-0.5 rounded border text-xs font-medium',
                WORKLOAD_COLORS[analysis.workload_assessment]
              )}>
                {analysis.workload_assessment.charAt(0).toUpperCase() + analysis.workload_assessment.slice(1)}
              </span>
              {aiAvailable === false && <UnavailableNote hasAnalysis />}
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** Same pattern for retro quality — banner between title and editor content */
export function RetroQualityBanner({
  documentId,
  editorContent,
  planContent: externalPlanContent,
  onAnalysisChange,
}: {
  documentId: string;
  editorContent: Record<string, unknown> | null;
  planContent: Record<string, unknown> | null;
  onAnalysisChange?: (analysis: unknown) => void;
}) {
  type RetroAnalysis = {
    overall_score: number;
    plan_coverage: Array<{ plan_item: string; addressed: boolean; has_evidence: boolean; feedback: string }>;
    suggestions: string[];
    content_hash?: string;
  };
  const [planContent, setPlanContent] = useState<Record<string, unknown> | null>(externalPlanContent);
  const [analysis, setAnalysisRaw] = useState<RetroAnalysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [aiAvailable, setAiAvailable] = useState<boolean | null>(null);
  const lastContentRef = useRef<string>('');
  const requestIdRef = useRef(0);
  const persistedHashRef = useRef<string | null>(null);
  const externalPlanContentRef = useRef(externalPlanContent);
  const onAnalysisChangeRef = useRef(onAnalysisChange);
  externalPlanContentRef.current = externalPlanContent;
  onAnalysisChangeRef.current = onAnalysisChange;

  const setAnalysis = useCallback((data: RetroAnalysis | null) => {
    setAnalysisRaw(data);
    onAnalysisChangeRef.current?.(data);
  }, []);

  // Keep externally provided plan content in sync without resetting analysis state.
  useEffect(() => {
    if (externalPlanContent) {
      setPlanContent(externalPlanContent);
    }
  }, [externalPlanContent]);

  // Reinitialize state when switching documents, then load persisted data for this doc.
  useEffect(() => {
    let cancelled = false;

    // Invalidate any in-flight analysis from the previous document.
    requestIdRef.current++;
    lastContentRef.current = '';
    persistedHashRef.current = null;
    setLoading(false);
    setAiAvailable(null);
    setAnalysis(null);
    setPlanContent(externalPlanContentRef.current);

    quietGet('/api/ai/status')
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (cancelled) return;
        setAiAvailable(data?.available === true);
      })
      .catch(() => {
        if (cancelled) return;
        setAiAvailable(false);
      });

    // Load retro doc to get persisted analysis AND plan content
    quietGet(`/api/documents/${documentId}`)
      .then(r => r.ok ? r.json() : null)
      .then(async (doc) => {
        if (cancelled || !doc) return;
        // Restore persisted analysis (including content hash for cache check)
        if (doc.properties?.ai_analysis) {
          setAnalysis(doc.properties.ai_analysis);
          persistedHashRef.current = doc.properties.ai_analysis.content_hash || null;
        }

        // Fetch corresponding plan content
        const currentExternalPlan = externalPlanContentRef.current;
        if (currentExternalPlan) {
          setPlanContent(currentExternalPlan);
          return;
        }
        const personId = doc.properties?.person_id;
        const weekNumber = doc.properties?.week_number;
        if (personId && weekNumber) {
          const params = new URLSearchParams({ person_id: personId, week_number: String(weekNumber) });
          const planRes = await quietGet(`/api/weekly-plans?${params}`);
          if (cancelled) return;
          const plans = planRes.ok ? await planRes.json() : [];
          if (cancelled) return;
          if (plans && plans.length > 0 && plans[0].content) {
            setPlanContent(plans[0].content);
          } else {
            // No plan found — use empty doc so analysis can still run
            setPlanContent({ type: 'doc', content: [] });
          }
        } else {
          setPlanContent({ type: 'doc', content: [] });
        }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [documentId, setAnalysis]);

  const persistAnalysis = useCallback((data: RetroAnalysis) => {
    quietPatch(`/api/documents/${documentId}`, {
      properties: { ai_analysis: data },
    }).catch(() => {});
  }, [documentId]);

  const runAnalysis = useCallback(async (retroContent: Record<string, unknown>, plan: Record<string, unknown>) => {
    const analysisInput = JSON.stringify({ retro_content: retroContent, plan_content: plan });
    if (analysisInput === lastContentRef.current) return;

    // Check persisted hash before calling API (avoids re-analysis on page load)
    if (persistedHashRef.current) {
      const currentHash = await computeContentHash({ retro_content: retroContent, plan_content: plan });
      if (currentHash === persistedHashRef.current) {
        lastContentRef.current = analysisInput;
        persistedHashRef.current = null;
        return;
      }
      persistedHashRef.current = null;
    }

    lastContentRef.current = analysisInput;
    const thisRequestId = ++requestIdRef.current;
    setLoading(true);

    quietPost('/api/ai/analyze-retro', { retro_content: retroContent, plan_content: plan })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (thisRequestId !== requestIdRef.current) return;
        if (data && !data.error) {
          setAnalysis(data);
          persistAnalysis(data);
        } else if (data?.error === 'ai_unavailable') {
          setAiAvailable(false);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (thisRequestId !== requestIdRef.current) return;
        setLoading(false);
      });
  }, [persistAnalysis]);

  // Analyze on editor content change
  useEffect(() => {
    if (!aiAvailable || !editorContent || !planContent) return;
    runAnalysis(editorContent, planContent);
  }, [editorContent, aiAvailable, planContent, runAnalysis]);

  // On mount: if no persisted result and plan is loaded, run initial analysis
  useEffect(() => {
    if (!aiAvailable || analysis || !planContent) return;
    let cancelled = false;
    quietGet(`/api/documents/${documentId}`)
      .then(r => r.ok ? r.json() : null)
      .then(doc => {
        if (cancelled) return;
        if (doc?.content) runAnalysis(doc.content, planContent);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [aiAvailable, documentId, analysis, planContent, runAnalysis]);

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
    return (
      <div className="mb-4 pl-8">
        <div className="w-full rounded-lg border border-border/50 bg-border/10 px-4 py-2.5">
          <div className="flex items-center gap-3">
            <div className="h-5 w-5 rounded-full bg-border/30 animate-pulse" />
            <div className="flex-1 h-2 rounded-full bg-border/20 overflow-hidden max-w-xs">
              <div className="h-full w-1/3 rounded-full bg-border/30 animate-pulse" />
            </div>
            <span className="text-xs text-muted/50">AI quality check will appear as you write</span>
          </div>
        </div>
      </div>
    );
  }

  const percentage = analysis ? Math.round(analysis.overall_score * 100) : 0;
  const barColor = percentage >= 70 ? 'bg-green-500' : percentage >= 40 ? 'bg-yellow-500' : 'bg-red-500';
  const textColor = percentage >= 70 ? 'text-green-400' : percentage >= 40 ? 'text-yellow-400' : 'text-red-400';

  return (
    <div className="mb-4 pl-8">
      {/* Compact score bar — per-item feedback is shown inline via AIScoringDisplay decorations */}
      <div
        className={cn(
          'w-full rounded-lg border px-4 py-2.5',
          analysis
            ? percentage >= 70
              ? 'border-green-500/30 bg-green-500/5'
              : percentage >= 40
                ? 'border-yellow-500/30 bg-yellow-500/5'
                : 'border-red-500/30 bg-red-500/5'
            : 'border-border bg-border/20'
        )}
      >
        <div className="flex items-center gap-3">
          {loading ? (
            <div className="flex items-center gap-2">
              <svg className="w-4 h-4 animate-spin text-accent" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              <span className="text-sm text-muted">Analyzing retro completeness...</span>
            </div>
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
              <span className="text-xs text-muted">Retro Completeness</span>
              {aiAvailable === false && <UnavailableNote hasAnalysis />}
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
