// FleetGraph model adapter keeps real proactive-create LLM calls opt-in and testable.
import { fleetGraphConfig } from '../config/fleetgraph.js';
import type { FleetGraphAttentionCandidate } from './detection/detector.js';
import type { FleetGraphTokenMetadata } from './types.js';

export type FleetGraphProactiveCreateModelResult = {
  summary: string;
  draftMessage: string;
  tokenMetadata: FleetGraphTokenMetadata;
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
  const model = new ChatOpenAI({ model: config.modelName ?? 'gpt-4o-mini', temperature: 0 });
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

  return {
    summary: summary?.trim() || deterministicSummary(input.candidate),
    draftMessage: draftParts.join('\n\n').trim() || deterministicDraft(input.candidate),
    tokenMetadata: { modelCalls: 1 },
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
  };
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
