import type {
  FleetGraphChatContext,
  FleetGraphEvidence,
  FleetGraphPageContext,
  FleetGraphVisibleOutput,
} from '@ship/shared';
import type { FleetGraphNotificationProbeItem } from '@/components/FleetGraphNotificationsProbe';

export interface ChatContextItem {
  id: string;
  label: string;
  sourcePath?: string;
  notification?: FleetGraphNotificationProbeItem;
  context: FleetGraphChatContext;
  attached?: boolean;
}

export type ExplanationState =
  | { status: 'idle' }
  | { status: 'loading'; findingId: string }
  | { status: 'ready'; findingId: string; output: FleetGraphVisibleOutput }
  | { status: 'error'; findingId?: string };

export function getSurfaceLabel(pathname: string): string {
  if (pathname.startsWith('/documents/')) return 'Current document';
  if (pathname.startsWith('/issues')) return 'Issues';
  if (pathname.startsWith('/projects')) return 'Projects';
  if (pathname.startsWith('/programs')) return 'Programs';
  if (pathname.startsWith('/my-week')) return 'My Week';
  if (pathname.startsWith('/team/')) return 'Team';
  if (pathname.startsWith('/docs')) return 'Docs';
  return 'Current view';
}

export function getCurrentDocumentId(pathname: string): string | null {
  const match = pathname.match(/^\/(?:documents|issues|projects|programs|sprints)\/([^/?#]+)/);
  return match?.[1] ?? null;
}

export function getCurrentContextKind(pathname: string): FleetGraphChatContext['kind'] {
  if (pathname.startsWith('/issues/')) return 'issue';
  if (pathname.startsWith('/projects/')) return 'project';
  if (pathname.startsWith('/programs/')) return 'program';
  if (pathname.startsWith('/sprints/')) return 'sprint';
  return 'document';
}

export function sourcePathForDocumentId(documentId: string | null): string | undefined {
  return documentId ? `/documents/${documentId}` : undefined;
}

export function contextMatchesSource(item: ChatContextItem, sourcePath: string | undefined): boolean {
  return Boolean(sourcePath && item.sourcePath === sourcePath);
}

export function dedupeContextItems(items: ChatContextItem[]): ChatContextItem[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = item.sourcePath || item.id;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function displayText(value: string): string {
  return value.replace(/\bFleetGraph\b/g, 'Ship');
}

export function compactBlockerText(value: string): string {
  const text = value.trim();
  return text
    .replace(/^blocked\s+(?:but|because|on|by|for|until|while)\s+/i, '')
    .replace(/^blocked[:\s-]+/i, '')
    .replace(/^latest blocker[:\s-]+/i, '')
    .replace(/^./, (letter) => letter.toUpperCase());
}

export function chatErrorMessage(status: number | undefined): string {
  if (status === 401) return 'Your session expired. Refresh and sign in again.';
  if (status === 403) return 'Chat was rejected by the API. Refresh the page and try again.';
  if (status === 404) return 'Ship could not find visible context for this chat.';
  if (status === 429) return 'Chat is rate limited. Try again in a minute.';
  if (status && status >= 500) return 'The Ship API is unavailable right now.';
  return 'Ship could not reach the chat service.';
}

export function sourceLabelsForConversation(
  notification: FleetGraphNotificationProbeItem,
  output: FleetGraphVisibleOutput | null
): string[] {
  const labels = output?.evidence
    .filter((item) => item.visibility === 'actor_visible')
    .map((item) => sourceLabelForEvidence(item))
    .filter((label): label is string => Boolean(label))
    ?? [notification.context, notification.owner || '-'];

  return labels.filter((label, index) => label !== '-' && labels.indexOf(label) === index);
}

function sourceLabelForEvidence(item: FleetGraphEvidence): string | null {
  if (item.kind === 'blocker') return null;
  if (item.kind === 'source_issue') return 'Source issue';
  if (item.kind === 'source_sprint') return 'Week';
  if (item.kind === 'finding') return 'Finding';
  return item.claim || null;
}

export function conversationBody(
  notification: FleetGraphNotificationProbeItem,
  output: FleetGraphVisibleOutput | null
): string {
  if (notification.signalType !== 'blocked') {
    return notification.notificationText || notification.reason || output?.summary || 'This work needs attention.';
  }
  return blockerExcerpt(output)
    ? compactBlockerText(blockerExcerpt(output) ?? '')
    : notification.notificationText || notification.blockerText
      ? compactBlockerText(notification.notificationText || notification.blockerText)
      : output?.summary
    || 'No blocker reason was recorded.';
}

export function titleWithoutSignalPrefix(title: string, signalLabel: string): string {
  const prefix = `${signalLabel}:`;
  return title.toLowerCase().startsWith(prefix.toLowerCase())
    ? title.slice(prefix.length).trim()
    : title;
}

function blockerExcerpt(output: FleetGraphVisibleOutput | null): string | null {
  const excerpt = output?.evidence.find((item) => item.kind === 'blocker' && item.excerpt?.trim())?.excerpt;
  return excerpt?.trim() || null;
}

export function recommendedActionText(output: FleetGraphVisibleOutput | null): string | null {
  if (!output?.recommendedAction) return null;
  return output.recommendedAction.text
    || output.recommendedAction.summary
    || output.recommendedAction.label
    || null;
}

export function buildFleetGraphChatContext({
  contextItems,
  currentSourcePath,
  activeNotification,
  currentDocumentId,
  currentContextKind,
  pageContext,
}: {
  contextItems: ChatContextItem[];
  currentSourcePath: string | undefined;
  activeNotification: FleetGraphNotificationProbeItem | null;
  currentDocumentId: string | null;
  currentContextKind: FleetGraphChatContext['kind'];
  pageContext?: FleetGraphPageContext | null;
}): FleetGraphChatContext | null {
  const attachedContexts = contextItems
    .filter((item) => (item.attached || item.notification) && !contextMatchesSource(item, currentSourcePath))
    .map((item) => item.context);
  if (activeNotification?.findingId) {
    return {
      kind: 'notification',
      findingId: activeNotification.findingId,
      sourcePath: activeNotification.sourcePath,
      ...(pageContext ? { pageContext } : {}),
      ...(attachedContexts.length > 0 ? { attachedContexts } : {}),
    };
  }
  if (currentDocumentId) {
    return {
      kind: currentContextKind,
      documentId: currentDocumentId,
      sourcePath: currentSourcePath,
      ...(pageContext ? { pageContext } : {}),
      ...(attachedContexts.length > 0 ? { attachedContexts } : {}),
    };
  }
  if (pageContext) {
    return {
      kind: 'workspace',
      sourcePath: pageContext.route,
      pageContext,
      ...(attachedContexts.length > 0 ? { attachedContexts } : {}),
    };
  }
  return null;
}
