import { useState, useEffect, useRef, useCallback } from 'react';
import { quietGetJson, quietPatch, quietPostJson } from '@/lib/quiet-fetch';
import type { AiStatusResponse, Document } from '@/api/schemas';
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
  onDocumentSwitch?: (doc: Document) => Promise<AnalysisDeps | void> | AnalysisDeps | void;
  onAnalysisChange?: (analysis: TAnalysis | null) => void;
}

export type AnalysisDeps = Record<string, unknown>;

function getPersistedAnalysis<TAnalysis extends BaseAnalysis>(
  doc: Document
): TAnalysis | null {
  const props = doc.properties;
  if (!props || typeof props !== 'object' || !('ai_analysis' in props)) {
    return null;
  }
  const aiAnalysis = props.ai_analysis;
  if (!aiAnalysis || typeof aiAnalysis !== 'object') {
    return null;
  }
  return aiAnalysis as TAnalysis;
}

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
  const documentContentRef = useRef<Record<string, unknown> | null>(null);
  const [documentLoaded, setDocumentLoaded] = useState(false);
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
    documentContentRef.current = null;
    setDocumentLoaded(false);
    setLoading(false);
    setAiAvailable(null);
    setAnalysis(null);

    void quietGetJson<AiStatusResponse>('/api/ai/status')
      .then(data => {
        if (cancelled) return;
        setAiAvailable(data?.available === true);
      })
      .catch(() => {
        if (cancelled) return;
        setAiAvailable(false);
      });

    void quietGetJson<Document>(`/api/documents/${documentId}`)
      .then(async (doc) => {
        if (cancelled || !doc) return;
        if (doc.content && typeof doc.content === 'object') {
          documentContentRef.current = doc.content;
        }
        setDocumentLoaded(true);
        const persisted = getPersistedAnalysis<TAnalysis>(doc);
        if (persisted) {
          setAnalysis(persisted);
          persistedHashRef.current = persisted.content_hash ?? null;
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

    void quietPostJson<TAnalysis | { error: string }>(
      analyzeEndpoint,
      buildRequestBody(content, currentDeps)
    )
      .then(data => {
        if (thisRequestId !== requestIdRef.current) return;
        if (data && !isAiUnavailable(data)) {
          setAnalysis(data);
          persistAnalysis(data);
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
    if (!aiAvailable || !canAnalyze(deps)) return;
    const content = editorContent ?? documentContentRef.current;
    if (!content) return;
    void runAnalysis(content);
  }, [editorContent, aiAvailable, depsKey, runAnalysis, documentLoaded, canAnalyze, deps]);

  return { analysis, loading, aiAvailable, setAnalysis };
}
