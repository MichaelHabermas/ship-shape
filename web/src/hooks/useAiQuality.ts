import { useState, useEffect, useRef, useCallback } from 'react';
import { quietGet, quietPatch, quietPost } from '@/lib/quiet-fetch';
import { computeContentHash, isAiUnavailable } from '@/components/ai/types';

interface BaseAnalysis {
  content_hash?: string;
}

export interface UseAiQualityOptions<TAnalysis extends BaseAnalysis> {
  documentId: string;
  editorContent: Record<string, unknown> | null;
  analyzeEndpoint: string;
  buildRequestBody: (editorContent: Record<string, unknown>, deps: AnalysisDeps) => object;
  buildHashInput: (editorContent: Record<string, unknown>, deps: AnalysisDeps) => unknown;
  buildCompareKey: (editorContent: Record<string, unknown>, deps: AnalysisDeps) => string;
  deps: AnalysisDeps;
  depsKey: string;
  canAnalyze: (deps: AnalysisDeps) => boolean;
  onDocumentSwitch?: (doc: Record<string, unknown>) => Promise<AnalysisDeps | void> | AnalysisDeps | void;
  onAnalysisChange?: (analysis: TAnalysis | null) => void;
}

export type AnalysisDeps = Record<string, unknown>;

export function useAiQuality<TAnalysis extends BaseAnalysis>({
  documentId,
  editorContent,
  analyzeEndpoint,
  buildRequestBody,
  buildHashInput,
  buildCompareKey,
  deps,
  depsKey,
  canAnalyze,
  onDocumentSwitch,
  onAnalysisChange,
}: UseAiQualityOptions<TAnalysis>) {
  const [analysis, setAnalysisRaw] = useState<TAnalysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [aiAvailable, setAiAvailable] = useState<boolean | null>(null);
  const lastContentRef = useRef('');
  const requestIdRef = useRef(0);
  const persistedHashRef = useRef<string | null>(null);
  const onAnalysisChangeRef = useRef(onAnalysisChange);
  const depsRef = useRef(deps);
  depsRef.current = deps;
  onAnalysisChangeRef.current = onAnalysisChange;

  const setAnalysis = useCallback((data: TAnalysis | null) => {
    setAnalysisRaw(data);
    onAnalysisChangeRef.current?.(data);
  }, []);

  useEffect(() => {
    let cancelled = false;

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

    quietGet(`/api/documents/${documentId}`)
      .then(r => r.ok ? r.json() : null)
      .then(async (doc) => {
        if (cancelled || !doc) return;
        if (doc.properties?.ai_analysis) {
          setAnalysis(doc.properties.ai_analysis as TAnalysis);
          persistedHashRef.current = doc.properties.ai_analysis.content_hash || null;
        }
        if (onDocumentSwitch) {
          await onDocumentSwitch(doc);
        }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [documentId, onDocumentSwitch, setAnalysis]);

  const persistAnalysis = useCallback((data: TAnalysis) => {
    quietPatch(`/api/documents/${documentId}`, {
      properties: { ai_analysis: data },
    }).catch(() => {});
  }, [documentId]);

  const runAnalysis = useCallback(async (content: Record<string, unknown>) => {
    const currentDeps = depsRef.current;
    if (!canAnalyze(currentDeps)) return;

    const compareKey = buildCompareKey(content, currentDeps);
    if (compareKey === lastContentRef.current) return;

    if (persistedHashRef.current) {
      const currentHash = await computeContentHash(buildHashInput(content, currentDeps));
      if (currentHash === persistedHashRef.current) {
        lastContentRef.current = compareKey;
        persistedHashRef.current = null;
        return;
      }
      persistedHashRef.current = null;
    }

    lastContentRef.current = compareKey;
    const thisRequestId = ++requestIdRef.current;
    setLoading(true);

    quietPost(analyzeEndpoint, buildRequestBody(content, currentDeps))
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (thisRequestId !== requestIdRef.current) return;
        if (data && !isAiUnavailable(data)) {
          setAnalysis(data as TAnalysis);
          persistAnalysis(data as TAnalysis);
        } else if (isAiUnavailable(data)) {
          setAiAvailable(false);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (thisRequestId !== requestIdRef.current) return;
        setLoading(false);
      });
  }, [analyzeEndpoint, buildCompareKey, buildHashInput, buildRequestBody, canAnalyze, persistAnalysis, setAnalysis]);

  useEffect(() => {
    if (!aiAvailable || !editorContent || !canAnalyze(deps)) return;
    runAnalysis(editorContent);
  }, [editorContent, aiAvailable, depsKey, runAnalysis]);

  useEffect(() => {
    if (!aiAvailable || analysis || !canAnalyze(depsRef.current)) return;
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
  }, [aiAvailable, documentId, analysis, depsKey, runAnalysis]);

  return { analysis, loading, aiAvailable, setAnalysis };
}
