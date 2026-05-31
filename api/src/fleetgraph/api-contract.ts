// FleetGraph API contract owns schemas and safe response serialization.
import type { Response } from 'express';
import { z } from '../openapi/registry.js';
import { ErrorResponseSchema, ApiErrorResponseSchema } from '../openapi/schemas/common.js';
import { traceMetadataForResponse } from './trace.js';
import type { FleetGraphSignalType } from '@ship/shared';
import type { FleetGraphResult, FleetGraphVisibleOutput } from './types.js';
import type { FleetGraphFinding, FleetGraphNotificationFinding } from './persistence.js';
import { signalLabelForType, signalTypeFromDedupeKey } from './persistence.js';
import { chatAnswerFromChangeSummary, chatAnswerFromVisibleOutput, unsupportedChatAnswer } from './runtime/chat.js';
import { usageMetadataFromResult } from './usage-metadata.js';
import {
  FleetGraphBlastRadiusEdgeSchema,
  FleetGraphBlastRadiusNodeSchema,
  FleetGraphBlastRadiusResponseSchema,
  FleetGraphChangeSummaryBodySchema,
  FleetGraphChangeSummaryResponseSchema,
  FleetGraphChangeSummaryRowSchema,
  FleetGraphChatAnswerSchema,
  FleetGraphChatContextSchema,
  FleetGraphChatHistoryEntrySchema,
  FleetGraphChatRequestSchema,
  FleetGraphChatResponseSchema,
  FleetGraphEvidenceSchema,
  FleetGraphFindingResponseSchema,
  FleetGraphFindingsListResponseSchema,
  FleetGraphManualRunResponseSchema,
  FleetGraphManualRunResultSchema,
  FleetGraphNotificationResponseSchema,
  FleetGraphNotificationsListResponseSchema,
  FleetGraphPageContextItemSchema,
  FleetGraphPageContextSchema,
  FleetGraphProposedRecipientSchema,
  FleetGraphRecommendedActionSchema,
  FleetGraphReviewerChainResponseSchema,
  FleetGraphReviewerChainSchema,
  FleetGraphReviewerChainsResponseSchema,
  FleetGraphReviewerProofRequestSchema,
  FleetGraphReviewerProofResponseSchema,
  FleetGraphReviewerRepairResponseSchema,
  FleetGraphReviewerScenarioResponseSchema,
  FleetGraphReviewerStepSchema,
  FleetGraphReviewerTraceScoreSchema,
  FleetGraphReviewerWorkerTickResponseSchema,
  FleetGraphRunResponseSchema,
  FleetGraphTraceSchema,
  FleetGraphUsageSchema,
  FleetGraphVisibleOutputSchema,
} from './openapi-wire-schemas.js';

export {
  FleetGraphBlastRadiusEdgeSchema,
  FleetGraphBlastRadiusNodeSchema,
  FleetGraphBlastRadiusResponseSchema,
  FleetGraphChangeSummaryBodySchema,
  FleetGraphChangeSummaryResponseSchema,
  FleetGraphChangeSummaryRowSchema,
  FleetGraphChatAnswerSchema,
  FleetGraphChatContextSchema,
  FleetGraphChatHistoryEntrySchema,
  FleetGraphChatRequestSchema,
  FleetGraphChatResponseSchema,
  FleetGraphEvidenceSchema,
  FleetGraphFindingResponseSchema,
  FleetGraphFindingsListResponseSchema,
  FleetGraphManualRunResponseSchema,
  FleetGraphManualRunResultSchema,
  FleetGraphNotificationResponseSchema,
  FleetGraphNotificationsListResponseSchema,
  FleetGraphPageContextItemSchema,
  FleetGraphPageContextSchema,
  FleetGraphProposedRecipientSchema,
  FleetGraphRecommendedActionSchema,
  FleetGraphReviewerChainResponseSchema,
  FleetGraphReviewerChainSchema,
  FleetGraphReviewerChainsResponseSchema,
  FleetGraphReviewerProofRequestSchema,
  FleetGraphReviewerProofResponseSchema,
  FleetGraphReviewerRepairResponseSchema,
  FleetGraphReviewerScenarioResponseSchema,
  FleetGraphReviewerStepSchema,
  FleetGraphReviewerTraceScoreSchema,
  FleetGraphReviewerWorkerTickResponseSchema,
  FleetGraphRunResponseSchema,
  FleetGraphTraceSchema,
  FleetGraphUsageSchema,
  FleetGraphVisibleOutputSchema,
};

type FleetGraphRecommendedActionWire = z.infer<typeof FleetGraphRecommendedActionSchema>;
type FleetGraphProposedRecipientWire = z.infer<typeof FleetGraphProposedRecipientSchema>;
type FleetGraphVisibleOutputWire = z.infer<typeof FleetGraphVisibleOutputSchema>;
type FleetGraphFindingResponseWire = z.infer<typeof FleetGraphFindingResponseSchema>;
type FleetGraphNotificationResponseWire = z.infer<typeof FleetGraphNotificationResponseSchema>;
type FleetGraphRunResponseWire = z.infer<typeof FleetGraphRunResponseSchema>;
type FleetGraphChatAnswerWire = z.infer<typeof FleetGraphChatAnswerSchema>;
type FleetGraphChatContextWire = z.infer<typeof FleetGraphChatContextSchema>;
type FleetGraphChatResponseWire = z.infer<typeof FleetGraphChatResponseSchema>;
type FleetGraphManualRunResultWire = z.infer<typeof FleetGraphManualRunResultSchema>;
type FleetGraphUsageWire = z.infer<typeof FleetGraphUsageSchema>;

const fleetGraphSeveritySchema = z.enum(['low', 'medium', 'high', 'urgent']);
const fleetGraphChangeSummaryBodySchema = FleetGraphChangeSummaryBodySchema;
type FleetGraphChangeSummaryRowWire = z.infer<typeof FleetGraphChangeSummaryRowSchema>;
type FleetGraphChangeSummaryBodyWire = {
  headline: string;
  rows: FleetGraphChangeSummaryRowWire[];
};

export const fleetGraphErrorSchemas = {
  badRequest: ApiErrorResponseSchema,
  error: ErrorResponseSchema,
};

function recommendedActionForResponse(action: Record<string, unknown> | undefined): FleetGraphRecommendedActionWire | undefined {
  if (!action) return undefined;
  const safe: FleetGraphRecommendedActionWire = {};
  for (const key of ['label', 'text', 'summary'] as const) {
    const value = action[key];
    if (typeof value === 'string' && value.trim()) safe[key] = value;
  }
  return Object.keys(safe).length > 0 ? safe : undefined;
}

function proposedRecipientForResponse(recipient: Record<string, unknown> | undefined): FleetGraphProposedRecipientWire | undefined {
  if (!recipient) return undefined;
  const safe: FleetGraphProposedRecipientWire = {};
  const role = recipient.role;
  const userId = recipient.userId;
  const displayName = recipient.displayName;
  const rationale = recipient.rationale;
  if (typeof role === 'string' && role.trim()) safe.role = role;
  if (typeof userId === 'string' || userId === null) safe.userId = userId;
  if (typeof displayName === 'string' && displayName.trim()) safe.displayName = displayName;
  if (typeof rationale === 'string' && rationale.trim()) safe.rationale = rationale;
  return Object.keys(safe).length > 0 ? safe : undefined;
}

function severityForResponse(value: unknown): FleetGraphVisibleOutputWire['severity'] {
  const parsed = fleetGraphSeveritySchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

function changeSummaryForResponse(value: unknown): FleetGraphChangeSummaryBodyWire | undefined {
  const parsed = fleetGraphChangeSummaryBodySchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

function usageMetadataFieldForResult(
  result: FleetGraphResult
): { usageMetadata?: FleetGraphUsageWire } {
  const usage = usageMetadataFromResult({
    tokenMetadata: result.tokenMetadata,
    costMetadata: result.costMetadata,
  });
  return usage ? { usageMetadata: FleetGraphUsageSchema.parse(usage) } : {};
}

function chatAnswerForResponse(result: FleetGraphResult): FleetGraphChatAnswerWire {
  const recordedAnswer = FleetGraphChatAnswerSchema.safeParse(result.runInput?.outputSnapshot?.answer);
  if (recordedAnswer.success) {
    return recordedAnswer.data;
  }

  const changeSummary = changeSummaryForResponse(result.changeSummary);
  if (changeSummary) {
    return FleetGraphChatAnswerSchema.parse(chatAnswerFromChangeSummary(changeSummary));
  }
  if (result.visibleOutput) {
    return FleetGraphChatAnswerSchema.parse(chatAnswerFromVisibleOutput(result.visibleOutput));
  }
  return FleetGraphChatAnswerSchema.parse(
    unsupportedChatAnswer('FleetGraph could not answer from this context.')
  );
}

export function serializeFleetGraphVisibleOutput(
  output: FleetGraphVisibleOutput
): FleetGraphVisibleOutputWire {
  return {
    title: output.title,
    summary: output.summary,
    severity: severityForResponse(output.severity),
    confidence: output.confidence,
    recommendedAction: recommendedActionForResponse(output.recommendedAction),
    proposedRecipient: proposedRecipientForResponse(output.proposedRecipient),
    recipientRationale: output.recipientRationale,
    uncertaintyNotes: output.uncertaintyNotes,
    evidence: output.evidence.map((item) => ({
      ...item,
      visibleFields: [...item.visibleFields],
    })),
    humanGate: output.humanGate,
    draftContent: output.draftContent,
    noSafeOutput: output.noSafeOutput,
  };
}

export function fleetGraphFindingResponse(input: {
  id: string;
  status: string;
  source_issue_id: string;
  source_sprint_id: string;
  dedupe_key: string;
  summary: string;
  run_metadata: Record<string, unknown>;
  trace_metadata: unknown;
  visibleOutput: FleetGraphVisibleOutput;
}): FleetGraphFindingResponseWire {
  const signalType = signalTypeForFinding(input);
  const reason = reasonForFinding(input);
  return {
    id: input.id,
    kind: 'blocker',
    signalType,
    signalLabel: signalLabelForType(signalType),
    reason,
    status: input.status,
    sourceIssueId: input.source_issue_id,
    sourceSprintId: input.source_sprint_id,
    visibleOutput: serializeFleetGraphVisibleOutput(input.visibleOutput),
    traceMetadata: traceMetadataForResponse(input.trace_metadata, {
      mode: 'proactive',
      decision: 'create_finding',
    }),
  };
}

export function fleetGraphNotificationResponse(input: {
  finding: FleetGraphNotificationFinding;
  visibleOutput: FleetGraphVisibleOutput;
}): FleetGraphNotificationResponseWire {
  const signalType = signalTypeForFinding(input.finding);
  const reason = reasonForFinding(input.finding);
  const notificationText = notificationTextForOutput(input.visibleOutput, reason);
  return {
    id: input.finding.id,
    findingId: input.finding.id,
    signalType,
    signalLabel: signalLabelForType(signalType),
    reason,
    title: input.finding.issue_title,
    issueTitle: input.finding.issue_title,
    context: input.finding.context_title || 'Current week',
    owner: input.finding.owner_name,
    notificationText,
    blockerText: blockerTextForNotification(input.visibleOutput) || notificationText,
    sourceIssueId: input.finding.source_issue_id,
    sourceSprintId: input.finding.source_sprint_id,
    sourcePath: `/documents/${input.finding.source_issue_id}`,
    detectedAt: input.finding.first_detected_at.toISOString(),
    isRead: input.finding.read_at !== null,
    readAt: input.finding.read_at?.toISOString() ?? null,
    visibleOutput: serializeFleetGraphVisibleOutput(input.visibleOutput),
    traceMetadata: traceMetadataForResponse(input.finding.trace_metadata, {
      mode: 'proactive',
      decision: 'create_finding',
    }),
  };
}

function blockerTextForNotification(output: FleetGraphVisibleOutput): string | undefined {
  return output.evidence.find((item) => item.kind === 'blocker' && item.excerpt?.trim())?.excerpt;
}

function signalTypeForFinding(finding: Pick<FleetGraphFinding, 'dedupe_key' | 'run_metadata'>): FleetGraphSignalType {
  const stored = finding.run_metadata?.signalType;
  if (stored === 'blocked' || stored === 'stale' || stored === 'at_risk') return stored;
  return signalTypeFromDedupeKey(finding.dedupe_key);
}

function reasonForFinding(finding: Pick<FleetGraphFinding, 'summary' | 'run_metadata'>): string {
  const reason = finding.run_metadata?.reason;
  return typeof reason === 'string' && reason.trim() ? reason.trim() : finding.summary;
}

function notificationTextForOutput(output: FleetGraphVisibleOutput, reason: string): string {
  return blockerTextForNotification(output) || output.summary || reason;
}

export function fleetGraphResultIsNotFound(result: FleetGraphResult): boolean {
  return result.decision === 'error' && result.errorMetadata.category === 'not_found';
}

export function fleetGraphFindingIsSafeToSerialize(
  result: Pick<FleetGraphResult, 'finding' | 'visibleOutput'>
): result is { finding: FleetGraphFinding; visibleOutput: FleetGraphVisibleOutput } {
  return Boolean(result.finding && result.visibleOutput && !result.visibleOutput.noSafeOutput);
}

export function fleetGraphRunResponse(result: FleetGraphResult): FleetGraphRunResponseWire {
  return {
    decision: result.decision,
    ...(fleetGraphFindingIsSafeToSerialize(result)
      ? { finding: fleetGraphFindingResponse({ ...result.finding, visibleOutput: result.visibleOutput }) }
      : {}),
    visibleOutput: result.visibleOutput ? serializeFleetGraphVisibleOutput(result.visibleOutput) : undefined,
    traceMetadata: traceMetadataForResponse(result.traceMetadata, {
      mode: 'on_demand',
      decision: result.decision,
    }),
    ...usageMetadataFieldForResult(result),
  };
}

export function fleetGraphChatResponse(input: {
  result: FleetGraphResult;
  context: FleetGraphChatContextWire;
}): FleetGraphChatResponseWire {
  return {
    decision: input.result.decision,
    answer: chatAnswerForResponse(input.result),
    context: input.context,
    visibleOutput: input.result.visibleOutput && !input.result.visibleOutput.noSafeOutput
      ? serializeFleetGraphVisibleOutput(input.result.visibleOutput)
      : undefined,
    changeSummary: changeSummaryForResponse(input.result.changeSummary),
    traceMetadata: traceMetadataForResponse(input.result.traceMetadata, {
      mode: 'on_demand',
      decision: input.result.decision,
    }),
    ...usageMetadataFieldForResult(input.result),
  };
}

export function sendFleetGraphRunResponse(res: Response, result: FleetGraphResult): void {
  if (fleetGraphResultIsNotFound(result) || result.visibleOutput?.noSafeOutput) {
    res.status(404).json({ error: 'FleetGraph finding not found' });
    return;
  }
  if (result.decision === 'error') {
    res.status(500).json({ error: 'FleetGraph run failed' });
    return;
  }

  res.json(fleetGraphRunResponse(result));
}

export function sendFleetGraphChangeSummaryResponse(res: Response, result: FleetGraphResult): void {
  if (fleetGraphResultIsNotFound(result) || result.visibleOutput?.noSafeOutput) {
    res.status(404).json({ error: 'FleetGraph finding not found' });
    return;
  }
  if (result.decision === 'error') {
    res.status(500).json({ error: 'FleetGraph run failed' });
    return;
  }
  if (!result.changeSummary) {
    res.status(500).json({ error: 'FleetGraph change summary missing' });
    return;
  }

  res.json({
    ...result.changeSummary,
    traceMetadata: traceMetadataForResponse(result.traceMetadata, {
      mode: 'on_demand',
      decision: 'summarize_changes',
    }),
  });
}

export function fleetGraphManualRunResultResponse(
  result: FleetGraphResult
): FleetGraphManualRunResultWire {
  return {
    decision: result.decision,
    ...(fleetGraphFindingIsSafeToSerialize(result) ? { findingId: result.finding.id } : {}),
    visibleOutput: result.visibleOutput && !result.visibleOutput.noSafeOutput
      ? serializeFleetGraphVisibleOutput(result.visibleOutput)
      : undefined,
    traceMetadata: traceMetadataForResponse(result.traceMetadata, {
      mode: 'proactive',
      decision: result.decision,
    }),
    ...usageMetadataFieldForResult(result),
  };
}
