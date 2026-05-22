export interface PlanItemAnalysis {
  text: string;
  score: number;
  feedback: string;
  issues: string[];
  conciseness_score?: number;
  is_verbose?: boolean;
  conciseness_feedback?: string;
}

export interface PlanAnalysisResult {
  overall_score: number;
  items: PlanItemAnalysis[];
  workload_assessment: 'light' | 'moderate' | 'heavy' | 'excessive';
  workload_feedback: string;
  content_hash?: string;
}

export interface RetroItemAnalysis {
  plan_item: string;
  addressed: boolean;
  has_evidence: boolean;
  feedback: string;
}

export interface RetroAnalysisResult {
  overall_score: number;
  plan_coverage: RetroItemAnalysis[];
  suggestions: string[];
  content_hash?: string;
}

export type AnalysisError = { error: string };

export function isAiUnavailable(data: unknown): data is AnalysisError {
  return typeof data === 'object' && data !== null && 'error' in data && (data as AnalysisError).error === 'ai_unavailable';
}

/** Compute SHA-256 hash of content for cache invalidation (matches backend). */
export async function computeContentHash(content: unknown): Promise<string> {
  const data = new TextEncoder().encode(JSON.stringify(content));
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

export function scoreStyle(percentage: number): {
  barColor: string;
  textColor: string;
  borderClass: string;
} {
  if (percentage >= 70) {
    return {
      barColor: 'bg-green-500',
      textColor: 'text-green-400',
      borderClass: 'border-green-500/30 bg-green-500/5',
    };
  }
  if (percentage >= 40) {
    return {
      barColor: 'bg-yellow-500',
      textColor: 'text-yellow-400',
      borderClass: 'border-yellow-500/30 bg-yellow-500/5',
    };
  }
  return {
    barColor: 'bg-red-500',
    textColor: 'text-red-400',
    borderClass: 'border-red-500/30 bg-red-500/5',
  };
}

export const WORKLOAD_COLORS = {
  light: 'text-yellow-400 bg-yellow-500/10 border-yellow-500/30',
  moderate: 'text-green-400 bg-green-500/10 border-green-500/30',
  heavy: 'text-blue-400 bg-blue-500/10 border-blue-500/30',
  excessive: 'text-red-400 bg-red-500/10 border-red-500/30',
} as const;
