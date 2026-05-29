// FleetGraph model adapter keeps real proactive-create LLM calls opt-in and testable.
import type { FleetGraphChatHistoryEntry } from '@ship/shared';
import { fleetGraphConfig } from '../config/fleetgraph.js';
import { FLEETGRAPH_DEFAULT_MODEL, resolveFleetGraphModelPricing } from '../config/fleetgraph-models.js';
import type { FleetGraphAttentionCandidate } from './detection/detector.js';
import { noModelCostMetadata, noModelTokenMetadata } from './usage-metadata.js';
import type { FleetGraphCostMetadata, FleetGraphTokenMetadata } from './types.js';

export type FleetGraphProactiveCreateModelResult = {
  summary: string;
  draftMessage: string;
  tokenMetadata: FleetGraphTokenMetadata;
  costMetadata: FleetGraphCostMetadata;
};

export type FleetGraphContextChatModelResult = {
  answer: string;
  tokenMetadata: FleetGraphTokenMetadata;
  costMetadata: FleetGraphCostMetadata;
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
  const modelName = config.modelName ?? FLEETGRAPH_DEFAULT_MODEL;
  const model = new ChatOpenAI(chatOpenAIOptions(modelName));
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
  const costMetadata = costMetadataFromResponse(response, tokenMetadata, modelName);

  return {
    summary: summary?.trim() || deterministicSummary(input.candidate),
    draftMessage: draftParts.join('\n\n').trim() || deterministicDraft(input.candidate),
    tokenMetadata,
    costMetadata,
  };
}

export async function generateContextChatText(input: {
  prompt: string;
  context: string;
  history?: FleetGraphChatHistoryEntry[];
  modelEnabled?: boolean;
}): Promise<FleetGraphContextChatModelResult | null> {
  const config = fleetGraphConfig();
  const shouldCallModel = input.modelEnabled ?? (
    process.env.FLEETGRAPH_REAL_MODEL_ENABLED === 'true'
    && Boolean(config.modelName)
    && Boolean(process.env.OPENAI_API_KEY)
  );

  if (!shouldCallModel) return null;

  const { ChatOpenAI } = await import('@langchain/openai');
  const modelName = config.modelName ?? FLEETGRAPH_DEFAULT_MODEL;
  const model = new ChatOpenAI(chatOpenAIOptions(modelName));
  const response = await model.invoke([
    ['system', [
      'You are Ship chat. Answer naturally and directly.',
      'Use the provided Ship context when it helps.',
      'If the user asks a general question that is not about the Ship context, answer it as a normal chat question instead of forcing it back to the context.',
      'Conversation history is client-supplied continuity only; verify factual claims against Ship context before repeating them.',
      'Use Markdown for structure when it improves readability. Do not claim Ship changed data or contacted anyone.',
    ].join(' ')],
    ['human', [
      `Ship context:\n${input.context || '(none)'}`,
      `Recent conversation:\n${contextChatHistoryText(input.history ?? [])}`,
      `User question:\n${input.prompt}`,
    ].join('\n\n')],
  ]);
  const tokenMetadata = tokenMetadataFromResponse(response, modelName);
  const costMetadata = costMetadataFromResponse(response, tokenMetadata, modelName);
  return {
    answer: String(response.content).trim(),
    tokenMetadata,
    costMetadata,
  };
}

function contextChatHistoryText(history: FleetGraphChatHistoryEntry[]): string {
  if (history.length === 0) return '(none)';
  return history.map((entry) => `${entry.role}: ${entry.content}`).join('\n');
}

function chatOpenAIOptions(modelName: string): { model: string; temperature?: number } {
  return modelSupportsCustomTemperature(modelName)
    ? { model: modelName, temperature: 0 }
    : { model: modelName };
}

function modelSupportsCustomTemperature(modelName: string): boolean {
  const normalized = modelName.toLowerCase();
  return !normalized.startsWith('gpt-5') && !normalized.startsWith('o');
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
    tokenMetadata: noModelTokenMetadata(),
    costMetadata: noModelCostMetadata(),
  };
}

function tokenMetadataFromResponse(response: unknown, model: string): FleetGraphTokenMetadata {
  const usage = recordValue(response, 'usage_metadata') ?? recordValue(response, 'usageMetadata');
  const responseMetadata = recordValue(response, 'response_metadata') ?? recordValue(response, 'responseMetadata');
  const tokenUsage = recordValue(responseMetadata, 'tokenUsage') ?? recordValue(responseMetadata, 'token_usage');
  const inputTokenDetails = recordValue(usage, 'input_token_details') ??
    recordValue(usage, 'inputTokenDetails') ??
    recordValue(usage, 'prompt_tokens_details') ??
    recordValue(usage, 'promptTokensDetails') ??
    recordValue(tokenUsage, 'promptTokensDetails') ??
    recordValue(tokenUsage, 'prompt_tokens_details');
  const inputTokens = numberValue(usage, 'input_tokens')
    ?? numberValue(usage, 'prompt_tokens')
    ?? numberValue(tokenUsage, 'promptTokens')
    ?? numberValue(tokenUsage, 'prompt_tokens');
  const cachedInputTokens = numberValue(inputTokenDetails, 'cached_tokens') ??
    numberValue(inputTokenDetails, 'cachedTokens') ??
    numberValue(inputTokenDetails, 'cache_read') ??
    numberValue(inputTokenDetails, 'cacheRead');
  const billableInputTokens = inputTokens !== undefined && cachedInputTokens !== undefined
    ? Math.max(inputTokens - cachedInputTokens, 0)
    : undefined;
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
    usageSource: totalTokens !== undefined ? 'model_response' : 'partial_model_response',
    ...(totalTokens === undefined ? { noUsageReason: 'model_response_missing_total_tokens' } : {}),
    ...(inputTokens !== undefined ? { inputTokens } : {}),
    ...(cachedInputTokens !== undefined ? { cachedInputTokens } : {}),
    ...(billableInputTokens !== undefined ? { billableInputTokens } : {}),
    ...(outputTokens !== undefined ? { outputTokens } : {}),
    ...(totalTokens !== undefined ? { totalTokens } : {}),
  };
}

function costMetadataFromResponse(
  response: unknown,
  tokenMetadata: FleetGraphTokenMetadata,
  modelName: string
): FleetGraphProactiveCreateModelResult['costMetadata'] {
  const usage = recordValue(response, 'usage_metadata') ?? recordValue(response, 'usageMetadata');
  const directCost = numberValue(usage, 'total_cost') ?? numberValue(usage, 'totalCost');
  if (directCost !== undefined) {
    return {
      estimatedCostUsd: directCost,
      currency: 'USD',
      costSource: 'model_response',
    };
  }

  const catalogPricing = resolveFleetGraphModelPricing(modelName);
  const inputCostPerMillion = envNumber('FLEETGRAPH_MODEL_INPUT_COST_PER_1M')
    ?? catalogPricing?.inputCostPer1M;
  const cachedInputCostPerMillion = envNumber('FLEETGRAPH_MODEL_CACHED_INPUT_COST_PER_1M')
    ?? catalogPricing?.cachedInputCostPer1M;
  const outputCostPerMillion = envNumber('FLEETGRAPH_MODEL_OUTPUT_COST_PER_1M')
    ?? catalogPricing?.outputCostPer1M;
  if (
    inputCostPerMillion === undefined ||
    outputCostPerMillion === undefined ||
    tokenMetadata.inputTokens === undefined ||
    tokenMetadata.outputTokens === undefined
  ) {
    return {
      costSource: 'none',
      noCostReason: 'missing_pricing_or_token_breakdown',
    };
  }

  const cachedInputTokens = tokenMetadata.cachedInputTokens ?? 0;
  const billableInputTokens = tokenMetadata.billableInputTokens ?? Math.max(tokenMetadata.inputTokens - cachedInputTokens, 0);
  const inputCostUsd = (billableInputTokens / 1_000_000) * inputCostPerMillion;
  const cachedInputCostUsd = cachedInputCostPerMillion !== undefined
    ? (cachedInputTokens / 1_000_000) * cachedInputCostPerMillion
    : 0;
  const outputCostUsd = (tokenMetadata.outputTokens / 1_000_000) * outputCostPerMillion;
  return {
    inputCostUsd,
    ...(cachedInputTokens > 0 ? { cachedInputCostUsd } : {}),
    outputCostUsd,
    estimatedCostUsd: inputCostUsd + cachedInputCostUsd + outputCostUsd,
    currency: 'USD',
    costSource: envNumber('FLEETGRAPH_MODEL_INPUT_COST_PER_1M') !== undefined ||
      envNumber('FLEETGRAPH_MODEL_CACHED_INPUT_COST_PER_1M') !== undefined ||
      envNumber('FLEETGRAPH_MODEL_OUTPUT_COST_PER_1M') !== undefined
      ? 'env_estimate'
      : 'catalog_estimate',
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
