/**
 * PlanQualityBanner / RetroQualityBanner — Compact AI quality score bars.
 *
 * Renders between the document title and editor content. Per-item feedback
 * is rendered inline via AIScoringDisplay decorations in the editor.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { quietGetJson } from '@/lib/quiet-fetch';
import type { Document } from '@/api/schemas';
import { useAiQuality } from '@/hooks/useAiQuality';
import { QualityBannerShell } from '@/components/ai/QualityBannerShell';
import type { PlanAnalysisResult, RetroAnalysisResult } from '@/components/ai/types';

export function PlanQualityBanner({
  documentId,
  editorContent,
  onAnalysisChange,
}: {
  documentId: string;
  editorContent: Record<string, unknown> | null;
  onAnalysisChange?: (analysis: PlanAnalysisResult | null) => void;
}) {
  const { analysis, loading, aiAvailable } = useAiQuality<PlanAnalysisResult>({
    documentId,
    editorContent,
    analyzeEndpoint: '/api/ai/analyze-plan',
    deps: {},
    depsKey: 'plan',
    canAnalyze: () => true,
    buildRequestBody: (content) => ({ content }),
    buildHashInput: (content) => content,
    buildCompareKey: (content) => JSON.stringify(content),
    onAnalysisChange,
  });

  return (
    <QualityBannerShell
      analysis={analysis}
      loading={loading}
      aiAvailable={aiAvailable}
      loadingLabel="Analyzing plan quality..."
      scoreLabel="Approval Likelihood"
      workload={analysis?.workload_assessment}
    />
  );
}

export function RetroQualityBanner({
  documentId,
  editorContent,
  planContent: externalPlanContent,
  onAnalysisChange,
}: {
  documentId: string;
  editorContent: Record<string, unknown> | null;
  planContent: Record<string, unknown> | null;
  onAnalysisChange?: (analysis: RetroAnalysisResult | null) => void;
}) {
  const [planContent, setPlanContent] = useState<Record<string, unknown> | null>(externalPlanContent);
  const externalPlanContentRef = useRef(externalPlanContent);
  externalPlanContentRef.current = externalPlanContent;

  useEffect(() => {
    if (externalPlanContent) {
      setPlanContent(externalPlanContent);
    }
  }, [externalPlanContent]);

  useEffect(() => {
    setPlanContent(externalPlanContentRef.current);
  }, [documentId]);

  const resolvePlanFromDoc = useCallback(async (doc: Document) => {
    const currentExternalPlan = externalPlanContentRef.current;
    if (currentExternalPlan) {
      setPlanContent(currentExternalPlan);
      return;
    }
    const props = doc.properties && typeof doc.properties === 'object' ? doc.properties : {};
    const personId = 'person_id' in props ? props.person_id : undefined;
    const weekNumber = 'week_number' in props ? props.week_number : undefined;
    if (personId != null && weekNumber != null) {
      const params = new URLSearchParams({
        person_id: String(personId),
        week_number: String(weekNumber),
      });
      const plans = await quietGetJson<Array<{ content?: Record<string, unknown> }>>(
        `/api/weekly-plans?${params}`
      );
      const firstPlan = plans?.[0];
      if (firstPlan?.content && typeof firstPlan.content === 'object') {
        setPlanContent(firstPlan.content);
        return;
      }
    }
    setPlanContent({ type: 'doc', content: [] });
  }, []);

  const onDocumentSwitch = useCallback(async (doc: Document) => {
    setPlanContent(externalPlanContentRef.current);
    await resolvePlanFromDoc(doc);
  }, [resolvePlanFromDoc]);

  const { analysis, loading, aiAvailable } = useAiQuality<RetroAnalysisResult>({
    documentId,
    editorContent,
    analyzeEndpoint: '/api/ai/analyze-retro',
    deps: { planContent },
    depsKey: planContent ? JSON.stringify(planContent) : 'no-plan',
    canAnalyze: (currentDeps) => !!currentDeps.planContent,
    buildRequestBody: (content, currentDeps) => ({
      retro_content: content,
      plan_content: currentDeps.planContent as Record<string, unknown>,
    }),
    buildHashInput: (content, currentDeps) => ({
      retro_content: content,
      plan_content: currentDeps.planContent,
    }),
    buildCompareKey: (content, currentDeps) => JSON.stringify({
      retro_content: content,
      plan_content: currentDeps.planContent,
    }),
    onDocumentSwitch,
    onAnalysisChange,
  });

  return (
    <QualityBannerShell
      analysis={analysis}
      loading={loading}
      aiAvailable={aiAvailable}
      loadingLabel="Analyzing retro completeness..."
      scoreLabel="Retro Completeness"
    />
  );
}
