// FleetGraph chat helpers keep typed on-demand prompts scoped to the active context.
import type { FleetGraphChangeSummary } from '@ship/shared';
import type { FleetGraphRunDecision } from '../persistence.js';
import type { FleetGraphVisibleOutput } from '../types.js';

export type FleetGraphChatAnswerPayload = {
  title: string;
  body: string;
  nextStep?: string;
  sources: Array<{ label: string; kind: string }>;
  humanGate: Record<string, unknown>;
};

export type FleetGraphChatIntent =
  | 'greeting'
  | 'why_flagged'
  | 'next_step'
  | 'unblocker'
  | 'urgency'
  | 'project_weirdness'
  | 'summarize_changes'
  | 'unsupported';

export function classifyFleetGraphChatPrompt(prompt: string): FleetGraphChatIntent {
  const normalized = prompt.trim().toLowerCase();
  if (!normalized) return 'unsupported';

  if (/^(hi|hello|hey|yo|sup)[!.?\s]*$/.test(normalized)) {
    return 'greeting';
  }
  if (/\b(how many|count|list|show all|all issues|issues do we have|workspace)\b/.test(normalized)) {
    return 'unsupported';
  }
  if (/\b(changed?|updates?|different|since|progress)\b/.test(normalized)) {
    return 'summarize_changes';
  }
  if (/\b(who|unblock|unblocker|owner|owns|approver|dependency)\b/.test(normalized)) {
    return 'unblocker';
  }
  if (/\b(urgent|urgency|risk|actually|serious|priority)\b/.test(normalized)) {
    return 'urgency';
  }
  if (/\b(else|weird|odd|strange|project|anything)\b/.test(normalized)) {
    return 'project_weirdness';
  }
  if (/\b(next|do|help|action|should)\b/.test(normalized)) {
    return 'next_step';
  }
  if (/\b(why|flagged|blocked|reason|happened|happening|explain|status|going on|what'?s going on|what'?s this|what is this)\b/.test(normalized)) {
    return 'why_flagged';
  }

  return 'unsupported';
}

export function decisionForContextChatIntent(intent: FleetGraphChatIntent): FleetGraphRunDecision {
  if (intent === 'unblocker' || intent === 'next_step') return 'needs_confirmation';
  if (intent === 'summarize_changes') return 'summarize_changes';
  return 'explain';
}

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

export function chatAnswerForIntent(
  intent: Exclude<FleetGraphChatIntent, 'summarize_changes' | 'unsupported'>,
  output: FleetGraphVisibleOutput
): FleetGraphChatAnswerPayload {
  const nextStep = recommendedActionText(output);
  const recipient = stringValue(output.proposedRecipient?.displayName) || stringValue(output.proposedRecipient?.role);
  const reason = attentionExcerpt(output) || output.summary;
  if (intent === 'greeting') {
    return {
      title: 'Chat',
      body: `Hi. I can talk through ${output.title}.`,
      sources: sourceLabels(output),
      humanGate: { required: false },
    };
  }
  if (intent === 'unblocker') {
    return {
      title: 'Best connected person',
      body: recipient
        ? `${recipient} is the best first stop from the attached Ship context. ${reason}`
        : `No owner is attached. ${reason}`,
      ...(nextStep ? { nextStep } : {}),
      sources: sourceLabels(output),
      humanGate: output.humanGate,
    };
  }
  if (intent === 'urgency') {
    return {
      title: 'Urgency read',
      body: `${severityLabel(output.severity)}. ${reason}`,
      ...(nextStep ? { nextStep } : {}),
      sources: sourceLabels(output),
      humanGate: output.humanGate,
    };
  }
  if (intent === 'project_weirdness') {
    return {
      title: 'What stands out',
      body: `From this attached context, the standout issue is: ${reason}`,
      ...(nextStep ? { nextStep } : {}),
      sources: sourceLabels(output),
      humanGate: output.humanGate,
    };
  }
  if (intent === 'next_step') {
    return {
      title: 'Next move',
      body: reason,
      ...(nextStep ? { nextStep } : {}),
      sources: sourceLabels(output),
      humanGate: output.humanGate,
    };
  }
  if (intent === 'why_flagged') {
    return {
      title: output.title,
      body: `It's flagged for this reason: ${reason}`,
      ...(nextStep ? { nextStep } : {}),
      sources: sourceLabels(output),
      humanGate: output.humanGate,
    };
  }
  return chatAnswerFromVisibleOutput(output);
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

function blockerExcerpt(output: FleetGraphVisibleOutput): string | null {
  return output.evidence.find((item) => item.kind === 'blocker' && item.excerpt?.trim())?.excerpt?.trim() || null;
}

function attentionExcerpt(output: FleetGraphVisibleOutput): string | null {
  return blockerExcerpt(output)
    || output.evidence.find((item) => ['stale', 'at_risk'].includes(item.kind) && item.claim?.trim())?.claim?.trim()
    || null;
}

function severityLabel(severity: unknown): string {
  if (severity === 'urgent') return 'This is urgent';
  if (severity === 'high') return 'This is high priority';
  if (severity === 'medium') return 'This needs attention, but it is not marked high priority';
  return 'The attached context does not show a strong urgency signal';
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
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
