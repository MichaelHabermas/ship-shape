// FleetGraph chat helpers keep typed on-demand prompts scoped to the active context.
import type { FleetGraphChatAnswer } from '@ship/shared';
import type { FleetGraphChangeSummary, FleetGraphVisibleOutput } from '../types.js';

export type FleetGraphChatIntent =
  | 'why_flagged'
  | 'next_step'
  | 'summarize_changes'
  | 'unsupported';

export function classifyFleetGraphChatPrompt(prompt: string): FleetGraphChatIntent {
  const normalized = prompt.trim().toLowerCase();
  if (!normalized) return 'unsupported';

  if (/\b(changed?|updates?|different|since|progress)\b/.test(normalized)) {
    return 'summarize_changes';
  }
  if (/\b(next|do|unblock|owner|owns|who|help|action)\b/.test(normalized)) {
    return 'next_step';
  }
  if (/\b(why|flagged|blocked|reason|happened|explain)\b/.test(normalized)) {
    return 'why_flagged';
  }

  return 'unsupported';
}

export function chatAnswerFromVisibleOutput(output: FleetGraphVisibleOutput): FleetGraphChatAnswer {
  const nextStep = recommendedActionText(output);
  return {
    title: output.title,
    body: blockerExcerpt(output) || output.summary,
    ...(nextStep ? { nextStep } : {}),
    sources: sourceLabels(output),
    humanGate: output.humanGate,
  };
}

export function chatAnswerFromChangeSummary(summary: FleetGraphChangeSummary): FleetGraphChatAnswer {
  const nextRow = summary.rows.find((row) => row.label === 'Next');
  return {
    title: summary.headline,
    body: summary.rows.map((row) => `${row.label}: ${row.text}`).join('\n'),
    ...(nextRow ? { nextStep: nextRow.text } : {}),
    sources: [],
    humanGate: { required: false },
  };
}

export function unsupportedChatAnswer(reason: string): FleetGraphChatAnswer {
  return {
    title: 'FleetGraph needs context',
    body: reason,
    sources: [],
    humanGate: { required: false },
  };
}

function blockerExcerpt(output: FleetGraphVisibleOutput): string | null {
  return output.evidence.find((item) => item.kind === 'blocker' && item.excerpt?.trim())?.excerpt?.trim() || null;
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
