// FleetGraph model adapter keeps real proactive-create LLM calls opt-in and testable.
import { fleetGraphConfig } from '../config/fleetgraph.js';
import type { BlockedImportantIssueCandidate } from './detector.js';
import type { FleetGraphTokenMetadata } from './types.js';

export type FleetGraphProactiveCreateModelResult = {
  summary: string;
  draftMessage: string;
  tokenMetadata: FleetGraphTokenMetadata;
};

export async function generateProactiveCreateText(input: {
  candidate: BlockedImportantIssueCandidate;
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
      `Blocker: ${input.candidate.blocker_text}`,
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

function deterministicSummary(candidate: BlockedImportantIssueCandidate): string {
  return `${candidate.issue_title} is urgent/high active-week work with a recorded blocker: ${candidate.blocker_text}`;
}

function deterministicDraft(candidate: BlockedImportantIssueCandidate): string {
  return `Can you confirm the current unblock path for ${candidate.issue_title}? FleetGraph found this blocker in the active week: ${candidate.blocker_text}`;
}

function deterministicProactiveCreateText(candidate: BlockedImportantIssueCandidate): FleetGraphProactiveCreateModelResult {
  return {
    summary: deterministicSummary(candidate),
    draftMessage: deterministicDraft(candidate),
    tokenMetadata: { modelCalls: 0 },
  };
}
