// FleetGraph web hooks normalize the bounded API into contextual UI views.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient, assertApiData } from '@/api/client';
import type { components } from '@/api/generated/ship-openapi';

type FleetGraphFindingResponse = components['schemas']['FleetGraphFindingResponse'];
type FleetGraphRunResponse = components['schemas']['FleetGraphRunResponse'];
type FleetGraphChangeSummaryResponse = components['schemas']['FleetGraphChangeSummaryResponse'];
type FleetGraphVisibleOutput = components['schemas']['FleetGraphVisibleOutput'];
type FleetGraphEvidence = components['schemas']['FleetGraphEvidence'];
type FleetGraphTrace = components['schemas']['FleetGraphTrace'];

export type FleetGraphFindingView = {
  id: string;
  kind: string;
  status: string;
  sourceIssueId: string;
  sourceSprintId: string;
  title: string;
  summary: string;
  evidence: FleetGraphEvidence[];
  humanGate: {
    required: boolean;
    reason: string | null;
    blockedConsequence: string | null;
  };
  draftText: string | null;
  recommendedAction: string | null;
  proposedRecipient: {
    role: string | null;
    userId: string | null;
    rationale: string | null;
  };
  recipientRationale: string | null;
  uncertainty: string | null;
  severity: string | null;
  confidence: string | null;
  trace: FleetGraphTrace;
};

export type FleetGraphRunView = {
  decision: string;
  finding: FleetGraphFindingView | null;
  visibleOutput: FleetGraphVisibleOutput | null;
  trace: FleetGraphTrace;
};

export type FleetGraphChangeSummaryView = {
  headline: string;
  rows: FleetGraphChangeSummaryResponse['rows'];
};

export const fleetGraphKeys = {
  all: ['fleetgraph'] as const,
  findings: () => [...fleetGraphKeys.all, 'findings'] as const,
  sourceIssue: (sourceIssueId: string | undefined) => [...fleetGraphKeys.findings(), 'issue', sourceIssueId ?? 'none'] as const,
  sourceSprint: (sourceSprintId: string | undefined) => [...fleetGraphKeys.findings(), 'sprint', sourceSprintId ?? 'none'] as const,
};

function stringFromRecord(record: Record<string, unknown> | undefined, keys: string[]): string | null {
  if (!record) return null;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return null;
}

function stringFromArray(value: unknown): string | null {
  if (!Array.isArray(value)) return null;
  const notes = value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
  return notes.length > 0 ? notes.join(' ') : null;
}

function booleanFromRecord(record: Record<string, unknown> | undefined, key: string): boolean {
  return record?.[key] === true;
}

export function fleetGraphFindingView(finding: FleetGraphFindingResponse): FleetGraphFindingView {
  const output = finding.visibleOutput;
  const humanGate = output.humanGate;
  const draftContent = output.draftContent;

  return {
    id: finding.id,
    kind: finding.kind,
    status: finding.status,
    sourceIssueId: finding.sourceIssueId,
    sourceSprintId: finding.sourceSprintId,
    title: output.title,
    summary: output.summary,
    evidence: output.evidence,
    humanGate: {
      required: booleanFromRecord(humanGate, 'required'),
      reason: stringFromRecord(humanGate, ['reason', 'needs_you_because', 'needsYouBecause']),
      blockedConsequence: stringFromRecord(humanGate, ['blocked_consequence', 'blockedConsequence', 'blockedAction']),
    },
    draftText: stringFromRecord(draftContent, ['text', 'message', 'draft', 'body']),
    recommendedAction: stringFromRecord(output.recommendedAction, ['label', 'text', 'summary']),
    proposedRecipient: {
      role: output.proposedRecipient?.role ?? null,
      userId: output.proposedRecipient?.userId ?? null,
      rationale: output.proposedRecipient?.rationale ?? null,
    },
    recipientRationale: output.recipientRationale ?? null,
    uncertainty: stringFromArray(output.uncertaintyNotes),
    severity: output.severity ?? null,
    confidence: typeof output.confidence === 'number' ? `${Math.round(output.confidence * 100)}%` : null,
    trace: finding.traceMetadata,
  };
}

function fleetGraphRunView(response: FleetGraphRunResponse): FleetGraphRunView {
  return {
    decision: response.decision,
    finding: response.finding ? fleetGraphFindingView(response.finding) : null,
    visibleOutput: response.visibleOutput ?? null,
    trace: response.traceMetadata,
  };
}

async function fetchFleetGraphFindings(query: { sourceIssueId?: string; sourceSprintId?: string }) {
  const result = await apiClient.GET('/fleetgraph/findings', {
    params: { query },
  });
  return assertApiData(result, 'Failed to fetch FleetGraph findings').findings.map(fleetGraphFindingView);
}

export function useFleetGraphIssueFindings(sourceIssueId: string | undefined) {
  return useQuery({
    queryKey: fleetGraphKeys.sourceIssue(sourceIssueId),
    queryFn: () => fetchFleetGraphFindings({ sourceIssueId }),
    enabled: Boolean(sourceIssueId),
  });
}

export function useFleetGraphSprintFindings(sourceSprintId: string | undefined) {
  return useQuery({
    queryKey: fleetGraphKeys.sourceSprint(sourceSprintId),
    queryFn: () => fetchFleetGraphFindings({ sourceSprintId }),
    enabled: Boolean(sourceSprintId),
  });
}

export function useFleetGraphExplain() {
  return useMutation({
    mutationFn: async (findingId: string) => {
      const result = await apiClient.POST('/fleetgraph/findings/{findingId}/explain', {
        params: { path: { findingId } },
      });
      return fleetGraphRunView(assertApiData(result, 'Failed to explain FleetGraph finding'));
    },
  });
}

export function useFleetGraphRefine() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ findingId, instruction }: { findingId: string; instruction: string }) => {
      const result = await apiClient.POST('/fleetgraph/findings/{findingId}/refine', {
        params: { path: { findingId } },
        body: { instruction },
      });
      return fleetGraphRunView(assertApiData(result, 'Failed to refine FleetGraph finding'));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: fleetGraphKeys.findings() });
    },
  });
}

export function useFleetGraphChanges() {
  return useMutation({
    mutationFn: async (findingId: string): Promise<FleetGraphChangeSummaryView> => {
      const result = await apiClient.POST('/fleetgraph/findings/{findingId}/changes', {
        params: { path: { findingId } },
      });
      const data = assertApiData(result, 'Failed to summarize FleetGraph changes');
      return {
        headline: data.headline,
        rows: data.rows,
      };
    },
  });
}

export function useFleetGraphDismiss() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (findingId: string) => {
      const result = await apiClient.POST('/fleetgraph/findings/{findingId}/dismiss', {
        params: { path: { findingId } },
      });
      return fleetGraphRunView(assertApiData(result, 'Failed to dismiss FleetGraph finding'));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: fleetGraphKeys.findings() });
    },
  });
}
