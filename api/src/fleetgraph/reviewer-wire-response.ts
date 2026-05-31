// Validates reviewer HTTP responses against OpenAPI wire schemas before send.
import type { Response } from 'express';
import {
  FleetGraphReviewerChainResponseSchema,
  FleetGraphReviewerChainsResponseSchema,
  FleetGraphReviewerProofResponseSchema,
  FleetGraphReviewerRepairResponseSchema,
  FleetGraphReviewerScenarioResponseSchema,
  FleetGraphReviewerWorkerTickResponseSchema,
} from './openapi-wire-schemas.js';

export function jsonReviewerChains(res: Response, body: unknown): void {
  res.json(FleetGraphReviewerChainsResponseSchema.parse(body));
}

export function jsonReviewerChain(res: Response, body: unknown): void {
  res.json(FleetGraphReviewerChainResponseSchema.parse(body));
}

export function jsonReviewerScenario(res: Response, body: unknown): void {
  res.json(FleetGraphReviewerScenarioResponseSchema.parse(body));
}

export function jsonReviewerWorkerTick(res: Response, body: unknown): void {
  res.json(FleetGraphReviewerWorkerTickResponseSchema.parse(body));
}

export function jsonReviewerRepair(res: Response, body: unknown): void {
  res.json(FleetGraphReviewerRepairResponseSchema.parse(body));
}

export function jsonReviewerProof(res: Response, body: unknown): void {
  res.json(FleetGraphReviewerProofResponseSchema.parse(body));
}
