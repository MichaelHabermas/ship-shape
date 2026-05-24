export type SessionBindingReason =
  | 'user_agent_changed'
  | 'ip_changed'
  | 'missing_stored_binding'
  | 'missing_current_binding';

export type SessionBindingDecision =
  | { level: 'ok'; reasons: SessionBindingReason[] }
  | { level: 'suspicious'; reasons: SessionBindingReason[] }
  | { level: 'deny'; reasons: SessionBindingReason[] };

export interface SessionBindingInput {
  storedUserAgent?: string | null;
  currentUserAgent?: string | null;
  storedIpAddress?: string | null;
  currentIpAddress?: string | null;
}

function normalized(value: string | null | undefined): string | null {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (!trimmed || trimmed === 'unknown') return null;
  return trimmed;
}

export function evaluateSessionBinding(input: SessionBindingInput): SessionBindingDecision {
  const storedUserAgent = normalized(input.storedUserAgent);
  const currentUserAgent = normalized(input.currentUserAgent);
  const storedIpAddress = normalized(input.storedIpAddress);
  const currentIpAddress = normalized(input.currentIpAddress);
  const reasons: SessionBindingReason[] = [];

  if (!storedUserAgent || !storedIpAddress) reasons.push('missing_stored_binding');
  if (!currentUserAgent || !currentIpAddress) reasons.push('missing_current_binding');

  if (storedUserAgent && currentUserAgent && storedUserAgent !== currentUserAgent) {
    return { level: 'deny', reasons: ['user_agent_changed'] };
  }

  if (storedIpAddress && currentIpAddress && storedIpAddress !== currentIpAddress) {
    reasons.push('ip_changed');
  }

  if (reasons.includes('ip_changed')) {
    return { level: 'suspicious', reasons };
  }

  return { level: 'ok', reasons };
}
