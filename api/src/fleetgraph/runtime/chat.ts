// Shared FleetGraph chat answer shapes and explain/change-summary mappers (not PM context-chat routing).
import type { FleetGraphChangeSummary } from '@ship/shared';
import type { FleetGraphVisibleOutput } from '../types.js';

export type FleetGraphChatAnswerPayload = {
  title: string;
  body: string;
  nextStep?: string;
  sources: Array<{ label: string; kind: string }>;
  humanGate: Record<string, unknown>;
};

export function mergeChatSources(
  ...sourceLists: Array<Array<{ label: string; kind: string }>>
): Array<{ label: string; kind: string }> {
  const items = sourceLists.flat();
  return items.filter((source, index) => (
    items.findIndex((item) => item.label === source.label && item.kind === source.kind) === index
  ));
}

export function chatAnswerFromVisibleOutput(output: FleetGraphVisibleOutput): FleetGraphChatAnswerPayload {
  const nextStep = recommendedActionText(output);
  return {
    title: output.title,
    body: attentionExcerpt(output) || output.summary,
    ...(nextStep ? { nextStep } : {}),
    sources: sourceLabels(output),
    humanGate: output.humanGate,
  };
}

export function chatAnswerFromChangeSummary(summary: FleetGraphChangeSummary): FleetGraphChatAnswerPayload {
  const nextRow = summary.rows.find((row) => row.label === 'Next');
  return {
    title: summary.headline,
    body: summary.rows.map((row) => `${row.label}: ${row.text}`).join('\n'),
    ...(nextRow ? { nextStep: nextRow.text } : {}),
    sources: [],
    humanGate: { required: false },
  };
}

export function unsupportedChatAnswer(reason: string): FleetGraphChatAnswerPayload {
  return {
    title: 'FleetGraph needs context',
    body: reason,
    sources: [],
    humanGate: { required: false },
  };
}

function attentionExcerpt(output: FleetGraphVisibleOutput): string | null {
  const blocker = output.evidence.find((item) => item.kind === 'blocker' && item.excerpt?.trim())?.excerpt?.trim();
  if (blocker) return blocker;
  return output.evidence.find((item) => ['stale', 'at_risk'].includes(item.kind) && item.claim?.trim())?.claim?.trim() || null;
}

function recommendedActionText(output: FleetGraphVisibleOutput): string | undefined {
  const action = output.recommendedAction;
  if (!action) return undefined;
  for (const key of ['text', 'summary', 'label']) {
    const value = action[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

function sourceLabels(output: FleetGraphVisibleOutput): Array<{ label: string; kind: string }> {
  return output.evidence
    .filter((item) => item.visibility === 'actor_visible')
    .map((item) => {
      if (item.kind === 'source_issue') return { label: 'Source issue', kind: item.kind };
      if (item.kind === 'source_sprint') return { label: 'Week', kind: item.kind };
      if (item.kind === 'finding') return { label: 'Finding', kind: item.kind };
      return { label: item.claim, kind: item.kind };
    })
    .filter((item, index, items) => item.label && items.findIndex((candidate) => candidate.label === item.label) === index);
}
