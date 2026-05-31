// FleetGraph OpenAPI Zod schemas built from shared wire factories and registered for codegen.
import { buildFleetGraphCoreWireSchemas, buildReviewerWireSchemas } from '@ship/shared';
import { z } from '../openapi/registry.js';

const core = buildFleetGraphCoreWireSchemas(z);
const reviewer = buildReviewerWireSchemas(z, core);

export const FleetGraphEvidenceSchema = core.FleetGraphEvidenceSchema.openapi('FleetGraphEvidence');
export const FleetGraphRecommendedActionSchema = core.FleetGraphRecommendedActionSchema.openapi('FleetGraphRecommendedAction');
export const FleetGraphProposedRecipientSchema = core.FleetGraphProposedRecipientSchema.openapi('FleetGraphProposedRecipient');
export const FleetGraphVisibleOutputSchema = core.FleetGraphVisibleOutputSchema.openapi('FleetGraphVisibleOutput');
export const FleetGraphTraceSchema = core.FleetGraphTraceSchema.openapi('FleetGraphTrace');
export const FleetGraphUsageSchema = core.FleetGraphUsageSchema.openapi('FleetGraphUsage');
export const FleetGraphFindingResponseSchema = core.FleetGraphFindingResponseSchema.openapi('FleetGraphFindingResponse');
export const FleetGraphNotificationResponseSchema = core.FleetGraphNotificationResponseSchema.openapi('FleetGraphNotificationResponse');

export const FleetGraphReviewerStepSchema = reviewer.FleetGraphReviewerStepSchema.openapi('FleetGraphReviewerStep');
export const FleetGraphReviewerTraceScoreSchema = reviewer.FleetGraphReviewerTraceScoreSchema.openapi('FleetGraphReviewerTraceScore');
export const FleetGraphReviewerChainSchema = reviewer.FleetGraphReviewerChainSchema.openapi('FleetGraphReviewerChain');
export const FleetGraphReviewerChainsResponseSchema = reviewer.FleetGraphReviewerChainsResponseSchema.openapi('FleetGraphReviewerChainsResponse');
export const FleetGraphReviewerChainResponseSchema = reviewer.FleetGraphReviewerChainResponseSchema.openapi('FleetGraphReviewerChainResponse');
export const FleetGraphReviewerScenarioResponseSchema = reviewer.FleetGraphReviewerScenarioResponseSchema.openapi('FleetGraphReviewerScenarioResponse');
export const FleetGraphReviewerRepairResponseSchema = reviewer.FleetGraphReviewerRepairResponseSchema.openapi('FleetGraphReviewerRepairResponse');
export const FleetGraphReviewerProofRequestSchema = reviewer.FleetGraphReviewerProofRequestSchema.openapi('FleetGraphReviewerProofRequest');
export const FleetGraphReviewerProofResponseSchema = reviewer.FleetGraphReviewerProofResponseSchema.openapi('FleetGraphReviewerProofResponse');
