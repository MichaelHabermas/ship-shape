// FleetGraph model adapter keeps real proactive-create LLM calls opt-in and testable.
import { fleetGraphConfig } from '../config/fleetgraph.js';
import type { FleetGraphAttentionCandidate } from './detection/detector.js';
import type { FleetGraphTokenMetadata } from './types.js';

export type FleetGraphProactiveCreateModelResult = {
  summary: string;
  draftMessage: string;
  tokenMetadata: FleetGraphTokenMetadata;
  costMetadata: {
    estimatedCostUsd?: number;
  };
};

export async function generateProactiveCreateText(input: {
  candidate: FleetGraphAttentionCandidate;
  modelEnabled?: boolean;
}): Promise<FleetGraphProactiveCreateModelResult> {
  const config = fleetGraphConfig();
  const shouldCallModel = input.modelEnabled ?? (
    process.env.FLEETGRAPH_REAL_MODEL_ENABLED === 'true'
    && Boolean(config.modelName)
    && Boolean(process.env.OPENAI_API_KEY)
  );

  if (!shouldCallModel) {
    return deterministicProactiveCreateText(input.candidate);
  }

  const { ChatOpenAI } = await import('@langchain/openai');
  const modelName = config.modelName ?? 'gpt-4o-mini';
  const model = new ChatOpenAI({ model: modelName, temperature: 0 });
  const response = await model.invoke([
    ['system', 'Write concise, evidence-grounded FleetGraph unblock copy. Do not claim Ship was mutated or anyone was contacted.'],
    ['human', [
      `Issue: ${input.candidate.issue_title}`,
      `Ticket: ${input.candidate.issue_ticket_number ?? 'unknown'}`,
      `Sprint: ${input.candidate.sprint_title}`,
      `Priority: ${input.candidate.issue_priority}`,
      `Blocker: ${blockerText(input.candidate)}`,
      'Return two short paragraphs: summary, then draft message.',
    ].join('\n')],
  ]);
  const content = String(response.content);
  const [summary, ...draftParts] = content.split(/\n\n+/);
  const tokenMetadata = tokenMetadataFromResponse(response, modelName);
  const costMetadata = costMetadataFromResponse(response, tokenMetadata);

  return {
    summary: summary?.trim() || deterministicSummary(input.candidate),
    draftMessage: draftParts.join('\n\n').trim() || deterministicDraft(input.candidate),
    tokenMetadata,
    costMetadata,
  };
}

function deterministicSummary(candidate: FleetGraphAttentionCandidate): string {
  return candidate.blocker_text
    ? `${trimSentence(candidate.blocker_text)} · ${weekLabel(candidate)}`
    : `Reason missing · ${weekLabel(candidate)}`;
}

function deterministicDraft(candidate: FleetGraphAttentionCandidate): string {
  if (!candidate.blocker_text.trim()) {
    return `Add the blocker reason for ${candidate.issue_title}.`;
  }

  return `Confirm who owns this unblocker: ${trimSentence(candidate.blocker_text)}.`;
}

export function deterministicProactiveCreateText(candidate: FleetGraphAttentionCandidate): FleetGraphProactiveCreateModelResult {
  return {
    summary: deterministicSummary(candidate),
    draftMessage: deterministicDraft(candidate),
    tokenMetadata: { modelCalls: 0 },
    costMetadata: {},
  };
}

function tokenMetadataFromResponse(response: unknown, model: string): FleetGraphTokenMetadata {
  const usage = recordValue(response, 'usage_metadata') ?? recordValue(response, 'usageMetadata');
  const responseMetadata = recordValue(response, 'response_metadata') ?? recordValue(response, 'responseMetadata');
  const tokenUsage = recordValue(responseMetadata, 'tokenUsage') ?? recordValue(responseMetadata, 'token_usage');
  const inputTokens = numberValue(usage, 'input_tokens')
    ?? numberValue(usage, 'prompt_tokens')
    ?? numberValue(tokenUsage, 'promptTokens')
    ?? numberValue(tokenUsage, 'prompt_tokens');
  const outputTokens = numberValue(usage, 'output_tokens')
    ?? numberValue(usage, 'completion_tokens')
    ?? numberValue(tokenUsage, 'completionTokens')
    ?? numberValue(tokenUsage, 'completion_tokens');
  const totalTokens = numberValue(usage, 'total_tokens')
    ?? numberValue(tokenUsage, 'totalTokens')
    ?? numberValue(tokenUsage, 'total_tokens')
    ?? (inputTokens !== undefined && outputTokens !== undefined ? inputTokens + outputTokens : undefined);

  return {
    modelCalls: 1,
    provider: 'openai',
    model,
    ...(inputTokens !== undefined ? { inputTokens } : {}),
    ...(outputTokens !== undefined ? { outputTokens } : {}),
    ...(totalTokens !== undefined ? { totalTokens } : {}),
  };
}

function costMetadataFromResponse(
  response: unknown,
  tokenMetadata: FleetGraphTokenMetadata
): FleetGraphProactiveCreateModelResult['costMetadata'] {
  const usage = recordValue(response, 'usage_metadata') ?? recordValue(response, 'usageMetadata');
  const directCost = numberValue(usage, 'total_cost') ?? numberValue(usage, 'totalCost');
  if (directCost !== undefined) return { estimatedCostUsd: directCost };

  const inputCostPerMillion = envNumber('FLEETGRAPH_MODEL_INPUT_COST_PER_1M');
  const outputCostPerMillion = envNumber('FLEETGRAPH_MODEL_OUTPUT_COST_PER_1M');
  if (
    inputCostPerMillion === undefined ||
    outputCostPerMillion === undefined ||
    tokenMetadata.inputTokens === undefined ||
    tokenMetadata.outputTokens === undefined
  ) {
    return {};
  }

  return {
    estimatedCostUsd: (
      (tokenMetadata.inputTokens / 1_000_000) * inputCostPerMillion +
      (tokenMetadata.outputTokens / 1_000_000) * outputCostPerMillion
    ),
  };
}

function recordValue(value: unknown, key: string): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const nested = (value as Record<string, unknown>)[key];
  return nested && typeof nested === 'object' && !Array.isArray(nested)
    ? nested as Record<string, unknown>
    : undefined;
}

function numberValue(value: unknown, key: string): number | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const raw = (value as Record<string, unknown>)[key];
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : undefined;
}

function envNumber(key: string): number | undefined {
  const raw = process.env[key];
  if (!raw) return undefined;
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function blockerText(candidate: FleetGraphAttentionCandidate): string {
  return candidate.blocker_text || 'No blocker reason recorded.';
}

function weekLabel(candidate: FleetGraphAttentionCandidate): string {
  return candidate.sprint_number ? `Week ${candidate.sprint_number}` : candidate.sprint_title;
}

function trimSentence(value: string): string {
  return value.trim().replace(/\.$/, '');
}
