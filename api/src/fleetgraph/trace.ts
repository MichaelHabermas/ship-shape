// FleetGraph trace helpers persist reviewer-safe node metadata without raw prompts or hidden evidence.
import type { FleetGraphRunDecision, FleetGraphRunMode, JsonRecord } from './persistence.js';
import type { FleetGraphTraceMetadata } from './types.js';

export function fleetGraphTraceMetadata(input: {
  mode: FleetGraphRunMode;
  decision: FleetGraphRunDecision;
  nodePath: string[];
  traceId?: string;
  traceUrl?: string;
  failureCategory?: string;
}): FleetGraphTraceMetadata {
  return {
    mode: input.mode,
    decision: input.decision,
    nodePath: input.nodePath,
    ...(input.traceId ? { traceId: input.traceId } : {}),
    ...(input.traceUrl ? { traceUrl: input.traceUrl } : {}),
    ...(input.failureCategory ? { failureCategory: input.failureCategory } : {}),
  };
}

export function traceMetadataJson(metadata: FleetGraphTraceMetadata): JsonRecord {
  return sanitizeFleetGraphTraceMetadata({
    mode: metadata.mode,
    decision: metadata.decision,
    nodePath: metadata.nodePath,
    ...(metadata.traceId ? { traceId: metadata.traceId } : {}),
    ...(metadata.traceUrl ? { traceUrl: metadata.traceUrl } : {}),
    ...(metadata.failureCategory ? { failureCategory: metadata.failureCategory } : {}),
  });
}

export function sanitizeFleetGraphTraceMetadata(metadata: JsonRecord): JsonRecord {
  const sanitized: JsonRecord = {};

  if (isTraceMode(metadata.mode)) sanitized.mode = metadata.mode;
  if (typeof metadata.decision === 'string') sanitized.decision = metadata.decision;
  if (Array.isArray(metadata.nodePath)) {
    sanitized.nodePath = metadata.nodePath.filter((node): node is string => typeof node === 'string');
  }
  if (typeof metadata.traceId === 'string') sanitized.traceId = metadata.traceId;
  if (typeof metadata.traceUrl === 'string') sanitized.traceUrl = metadata.traceUrl;
  if (typeof metadata.failureCategory === 'string') sanitized.failureCategory = metadata.failureCategory;

  return sanitized;
}

export function traceMetadataForResponse(
  metadata: unknown,
  fallback: Pick<FleetGraphTraceMetadata, 'mode' | 'decision'>
): FleetGraphTraceMetadata {
  const sanitized = sanitizeFleetGraphTraceMetadata(
    typeof metadata === 'object' && metadata !== null && !Array.isArray(metadata)
      ? metadata as JsonRecord
      : {}
  );

  return {
    mode: isTraceMode(sanitized.mode) ? sanitized.mode : fallback.mode,
    decision: typeof sanitized.decision === 'string'
      ? sanitized.decision as FleetGraphRunDecision
      : fallback.decision,
    nodePath: Array.isArray(sanitized.nodePath) ? sanitized.nodePath as string[] : [],
    ...(typeof sanitized.traceId === 'string' ? { traceId: sanitized.traceId } : {}),
    ...(typeof sanitized.traceUrl === 'string' ? { traceUrl: sanitized.traceUrl } : {}),
    ...(typeof sanitized.failureCategory === 'string' ? { failureCategory: sanitized.failureCategory } : {}),
  };
}

function isTraceMode(value: unknown): value is FleetGraphRunMode {
  return value === 'proactive' || value === 'on_demand';
}
