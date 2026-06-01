// FleetGraph OpenAPI Zod schemas built from shared wire factories and registered for codegen.
import { buildFleetGraphCoreWireSchemas, buildFleetGraphRouteWireSchemas, buildReviewerWireSchemas } from '@ship/shared';
import { z } from '../openapi/registry.js';

const core = buildFleetGraphCoreWireSchemas(z);
const reviewer = buildReviewerWireSchemas(z, core);
const route = buildFleetGraphRouteWireSchemas(z, core);

export const FleetGraphEvidenceSchema = core.FleetGraphEvidenceSchema.openapi('FleetGraphEvidence');
export const FleetGraphRecommendedActionSchema = core.FleetGraphRecommendedActionSchema.openapi('FleetGraphRecommendedAction');
export const FleetGraphProposedRecipientSchema = core.FleetGraphProposedRecipientSchema.openapi('FleetGraphProposedRecipient');
export const FleetGraphVisibleOutputSchema = core.FleetGraphVisibleOutputSchema.openapi('FleetGraphVisibleOutput');
export const FleetGraphTraceSchema = core.FleetGraphTraceSchema.openapi('FleetGraphTrace');
export const FleetGraphUsageSchema = core.FleetGraphUsageSchema.openapi('FleetGraphUsage');
export const FleetGraphFindingResponseSchema = core.FleetGraphFindingResponseSchema.openapi('FleetGraphFindingResponse');
export const FleetGraphNotificationResponseSchema = core.FleetGraphNotificationResponseSchema.openapi('FleetGraphNotificationResponse');

export const FleetGraphFindingsListResponseSchema = route.FleetGraphFindingsListResponseSchema.openapi('FleetGraphFindingsListResponse');
export const FleetGraphBlastRadiusNodeSchema = route.FleetGraphBlastRadiusNodeSchema.openapi('FleetGraphBlastRadiusNode');
export const FleetGraphBlastRadiusEdgeSchema = route.FleetGraphBlastRadiusEdgeSchema.openapi('FleetGraphBlastRadiusEdge');
export const FleetGraphBlastRadiusResponseSchema = route.FleetGraphBlastRadiusResponseSchema.openapi('FleetGraphBlastRadiusResponse');
export const FleetGraphNotificationsListResponseSchema = route.FleetGraphNotificationsListResponseSchema.openapi('FleetGraphNotificationsListResponse');
export const FleetGraphRunResponseSchema = route.FleetGraphRunResponseSchema.openapi('FleetGraphRunResponse');
export const FleetGraphChangeSummaryRowSchema = route.FleetGraphChangeSummaryRowSchema.openapi('FleetGraphChangeSummaryRow');
export const FleetGraphChangeSummaryBodySchema = route.FleetGraphChangeSummaryBodySchema.openapi('FleetGraphChangeSummaryBody');
export const FleetGraphChangeSummaryResponseSchema = route.FleetGraphChangeSummaryResponseSchema.openapi('FleetGraphChangeSummaryResponse');
export const FleetGraphManualRunResultSchema = route.FleetGraphManualRunResultSchema.openapi('FleetGraphManualRunResult');
export const FleetGraphManualRunResponseSchema = route.FleetGraphManualRunResponseSchema.openapi('FleetGraphManualRunResponse');
export const FleetGraphPageContextItemSchema = route.FleetGraphPageContextItemSchema.openapi('FleetGraphPageContextItem');
export const FleetGraphPageContextSchema = route.FleetGraphPageContextSchema.openapi('FleetGraphPageContext');
export const FleetGraphChatContextSchema = route.FleetGraphChatContextSchema.openapi('FleetGraphChatContext');
export const FleetGraphChatHistoryEntrySchema = route.FleetGraphChatHistoryEntrySchema.openapi('FleetGraphChatHistoryEntry');
export const FleetGraphChatRequestSchema = route.FleetGraphChatRequestSchema.openapi('FleetGraphChatRequest');
export const FleetGraphChatAnswerSchema = route.FleetGraphChatAnswerSchema.openapi('FleetGraphChatAnswer');
export const FleetGraphChatResponseSchema = route.FleetGraphChatResponseSchema.openapi('FleetGraphChatResponse');

export const FleetGraphReviewerStepSchema = reviewer.FleetGraphReviewerStepSchema.openapi('FleetGraphReviewerStep');
export const FleetGraphReviewerTraceScoreSchema = reviewer.FleetGraphReviewerTraceScoreSchema.openapi('FleetGraphReviewerTraceScore');
export const FleetGraphReviewerChainSchema = reviewer.FleetGraphReviewerChainSchema.openapi('FleetGraphReviewerChain');
export const FleetGraphReviewerChainsResponseSchema = reviewer.FleetGraphReviewerChainsResponseSchema.openapi('FleetGraphReviewerChainsResponse');
export const FleetGraphReviewerChainResponseSchema = reviewer.FleetGraphReviewerChainResponseSchema.openapi('FleetGraphReviewerChainResponse');
export const FleetGraphReviewerScenarioResponseSchema = reviewer.FleetGraphReviewerScenarioResponseSchema.openapi('FleetGraphReviewerScenarioResponse');
export const FleetGraphReviewerRepairResponseSchema = reviewer.FleetGraphReviewerRepairResponseSchema.openapi('FleetGraphReviewerRepairResponse');
export const FleetGraphReviewerProofRequestSchema = reviewer.FleetGraphReviewerProofRequestSchema.openapi('FleetGraphReviewerProofRequest');
export const FleetGraphReviewerProofResponseSchema = reviewer.FleetGraphReviewerProofResponseSchema.openapi('FleetGraphReviewerProofResponse');
export const FleetGraphReviewerWorkerTickResponseSchema = reviewer.FleetGraphReviewerWorkerTickResponseSchema.openapi('FleetGraphReviewerWorkerTickResponse');
