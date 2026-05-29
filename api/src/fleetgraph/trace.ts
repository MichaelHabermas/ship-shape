// FleetGraph trace helpers persist reviewer-safe node metadata without raw prompts or hidden evidence.
import type { FleetGraphRunMode } from '@ship/shared';
import type { FleetGraphRunDecision, JsonRecord } from './persistence.js';
import type { FleetGraphTraceMetadata } from './types.js';

export function fleetGraphTraceMetadata(input: {
  mode: FleetGraphRunMode;
  decision: FleetGraphRunDecision;
  nodePath: string[];
  traceId?: string;
  traceUrl?: string;
  failureCategory?: string;
  observability?: JsonRecord;
}): FleetGraphTraceMetadata {
  return {
    mode: input.mode,
    decision: input.decision,
    nodePath: input.nodePath,
    ...(input.traceId ? { traceId: input.traceId } : {}),
    ...(input.traceUrl ? { traceUrl: input.traceUrl } : {}),
    ...(input.failureCategory ? { failureCategory: input.failureCategory } : {}),
    ...(input.observability ? { observability: input.observability } : {}),
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
    ...(isJsonRecord(metadata.observability) ? { observability: metadata.observability } : {}),
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
  if (typeof metadata.traceUrl === 'string' && isSafeTraceUrl(metadata.traceUrl)) sanitized.traceUrl = metadata.traceUrl;
  if (typeof metadata.failureCategory === 'string') sanitized.failureCategory = metadata.failureCategory;
  if (isJsonRecord(metadata.observability)) sanitized.observability = sanitizeObservabilityMetadata(metadata.observability);

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
    ...(isJsonRecord(sanitized.observability) ? { observability: sanitized.observability } : {}),
  };
}

function isTraceMode(value: unknown): value is FleetGraphRunMode {
  return value === 'proactive' || value === 'on_demand';
}

function isSafeTraceUrl(value: string): boolean {
  if (value.startsWith('/') && !value.startsWith('//')) return true;

  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' && (
      parsed.hostname === 'smith.langchain.com' ||
      parsed.hostname.endsWith('.smith.langchain.com') ||
      parsed.hostname === 'cloud.langfuse.com' ||
      parsed.hostname.endsWith('.cloud.langfuse.com') ||
      parsed.hostname === 'us.cloud.langfuse.com' ||
      parsed.hostname.endsWith('.us.cloud.langfuse.com')
    );
  } catch {
    return false;
  }
}

function isJsonRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function sanitizeObservabilityMetadata(metadata: JsonRecord): JsonRecord {
  const safe: JsonRecord = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (!/^[a-zA-Z0-9_.-]{1,80}$/.test(key)) continue;
    if (
      /prompt|completion|authorization|cookie|password|secret|token/i.test(key) &&
      key !== 'modelTokenCount' &&
      key !== 'tokenUsage'
    ) {
      continue;
    }
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || value === null) {
      safe[key] = value;
    } else if (Array.isArray(value)) {
      const strings = value.filter((item): item is string => typeof item === 'string').slice(0, 20);
      if (strings.length > 0) safe[key] = strings;
    } else if (isJsonRecord(value)) {
      const nested = sanitizeObservabilityMetadata(value);
      if (Object.keys(nested).length > 0) safe[key] = nested;
    }
  }
  return safe;
}
