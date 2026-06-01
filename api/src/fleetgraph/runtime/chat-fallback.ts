// Honest response when PM chat cannot reach the model — no regex conversation router.
import type { FleetGraphChatAnswerPayload } from './chat.js';
import type { ContextChatBundle } from './context-chat.js';
import { sourcesFromContextBundle } from './context-chat.js';

const UNAVAILABLE_BODY = [
  'Ship chat is not available because the API is missing `OPENAI_API_KEY` or `FLEETGRAPH_MODEL`.',
  'Configure both in `api/.env.local`, restart the API, and try again.',
].join(' ');

export function chatModelUnavailableAnswer(
  prompt: string,
  bundle: ContextChatBundle
): FleetGraphChatAnswerPayload {
  const sources = sourcesFromContextBundle(bundle);
  const requiresApproval = contextChatActionRequiresApproval(prompt);
  return {
    title: 'Chat unavailable',
    body: requiresApproval
      ? `${UNAVAILABLE_BODY} Contacting people or changing Ship records still requires human approval once chat is enabled.`
      : UNAVAILABLE_BODY,
    sources,
    humanGate: requiresApproval
      ? { required: true, reason: 'human_must_approve_before_ship_or_external_action' }
      : { required: false },
  };
}

export function contextChatActionRequiresApproval(prompt: string): boolean {
  const normalized = prompt.trim().toLowerCase();
  return asksForExternalAction(normalized) || asksForShipAction(normalized);
}

function asksForShipAction(normalizedPrompt: string): boolean {
  return /\b(next step|next move|what next|what should (i|we) do|unblock|owner|approver|action item)\b/.test(normalizedPrompt);
}

function asksForExternalAction(normalizedPrompt: string): boolean {
  return /\b(send|sent|message|email|contact|notify|assign|change|mark|close|resolve)\b/.test(normalizedPrompt);
}
