// Verifies FleetGraph chat submits source-aware page, attachment, and notification context.
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FleetGraphChatResponse, FleetGraphPageContext } from '@ship/shared';
import { apiGetJson, apiPostJson } from '@/lib/api';
import { FleetGraphChatProbe, type FleetGraphChatProbeRequest } from './FleetGraphChatProbe';
import type { FleetGraphNotificationProbeItem } from './FleetGraphNotificationsProbe';

vi.mock('@/lib/api', () => ({
  apiGetJson: vi.fn(),
  apiPostJson: vi.fn(),
}));

const pageContext: FleetGraphPageContext = {
  route: '/issues?state=blocked',
  surface: 'issues_list',
  title: 'Blocked issues',
  filters: { state: 'blocked' },
  visibleItems: [
    { kind: 'issue', id: 'issue-1', title: 'Blocked issue', state: 'blocked', owner: 'Alex' },
  ],
  selectedItemIds: ['issue-1'],
};

function chatResponse(body: string): FleetGraphChatResponse {
  return {
    decision: 'answer',
    answer: {
      title: 'Answer',
      body,
      sources: [],
      humanGate: { required: false },
    },
    context: { kind: 'workspace' },
    traceMetadata: { mode: 'on_demand', decision: 'answer', nodePath: [], traceId: 'trace-1' },
  };
}

function notification(): FleetGraphNotificationProbeItem {
  return {
    id: 'notification-1',
    findingId: 'finding-1',
    signalType: 'blocked',
    signalLabel: 'Blocked',
    reason: 'Waiting on review',
    title: 'Blocked: Review needed',
    owner: 'Alex',
    context: 'Issue 1',
    notificationText: 'Review is blocking the issue.',
    blockerText: 'Waiting on review',
    sourcePath: '/documents/issue-1',
    detectedAt: '2026-05-30T12:00:00.000Z',
    age: 'now',
    isRead: false,
    readAt: null,
  };
}

function NavigateToDocument({ documentId }: { documentId: string }) {
  const navigate = useNavigate();
  return (
    <button type="button" onClick={() => navigate(`/documents/${documentId}`)}>
      Navigate document
    </button>
  );
}

function renderProbe({
  initialPath = '/issues',
  discussRequest = null,
  context = pageContext,
}: {
  initialPath?: string;
  discussRequest?: FleetGraphChatProbeRequest | null;
  context?: FleetGraphPageContext | null;
} = {}) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <NavigateToDocument documentId="doc-b" />
      <FleetGraphChatProbe discussRequest={discussRequest} pageContext={context} />
    </MemoryRouter>
  );
}

async function sendMessage(message: string) {
  const textarea = await screen.findByLabelText('Message');
  Object.defineProperty(textarea, 'scrollHeight', { configurable: true, value: 24 });
  fireEvent.change(textarea, { target: { value: message } });
  fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
}

function chatPayloads() {
  return vi.mocked(apiPostJson).mock.calls
    .filter(([endpoint]) => endpoint === '/api/fleetgraph/chat')
    .map(([, body]) => body as {
      prompt: string;
      context: Record<string, unknown>;
      history?: Array<{ role: string; content: string }>;
    });
}

describe('FleetGraphChatProbe', () => {
  beforeAll(() => {
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(apiGetJson).mockImplementation(async (endpoint) => {
      const documentId = String(endpoint).split('/').at(-1);
      return { title: documentId === 'doc-b' ? 'Document B' : 'Document A' };
    });
    vi.mocked(apiPostJson).mockImplementation(async (endpoint) => {
      if (String(endpoint).endsWith('/explain')) {
        return {
          visibleOutput: {
            title: 'Blocked issue',
            summary: 'Review is blocking the issue.',
            evidence: [],
            humanGate: { required: true },
          },
        };
      }
      return chatResponse(`Answer ${chatPayloads().length + 1}`);
    });
  });

  it('includes current page context when submitting from a scoped page', async () => {
    renderProbe({ initialPath: '/issues?state=blocked' });

    fireEvent.click(screen.getByRole('button', { name: 'Open chat' }));
    await sendMessage('What is blocked?');

    await waitFor(() => expect(chatPayloads()).toHaveLength(1));
    expect(chatPayloads()[0]).toMatchObject({
      prompt: 'What is blocked?',
      context: {
        kind: 'workspace',
        sourcePath: pageContext.route,
        pageContext,
      },
    });
  });

  it('keeps attached document context across navigation and later turns', async () => {
    renderProbe({
      initialPath: '/documents/doc-a',
      context: { ...pageContext, route: '/documents/doc-a', title: 'Document A' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Open chat' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add current page to chat context' }));
    fireEvent.click(screen.getByRole('button', { name: 'Navigate document' }));

    await sendMessage('Compare these.');
    await waitFor(() => expect(chatPayloads()).toHaveLength(1));

    await sendMessage('And now?');
    await waitFor(() => expect(chatPayloads()).toHaveLength(2));

    expect(chatPayloads()[0].context).toMatchObject({
      kind: 'document',
      documentId: 'doc-b',
      sourcePath: '/documents/doc-b',
      attachedContexts: [
        {
          kind: 'document',
          documentId: 'doc-a',
          sourcePath: '/documents/doc-a',
        },
      ],
    });
    expect(chatPayloads()[1].context).toMatchObject({
      attachedContexts: [
        {
          kind: 'document',
          documentId: 'doc-a',
          sourcePath: '/documents/doc-a',
        },
      ],
    });
    expect(chatPayloads()[1].history).toEqual([
      { role: 'user', content: 'Compare these.' },
      { role: 'assistant', content: 'Answer 2' },
    ]);
  });

  it('sends notification origin context with finding, source, page context, and history', async () => {
    renderProbe({
      discussRequest: {
        id: 1,
        notification: notification(),
      },
    });

    await sendMessage('Why did this fire?');
    await waitFor(() => expect(chatPayloads()).toHaveLength(1));

    await sendMessage('What should I ask Alex?');
    await waitFor(() => expect(chatPayloads()).toHaveLength(2));

    expect(chatPayloads()[0].context).toMatchObject({
      kind: 'notification',
      findingId: 'finding-1',
      sourcePath: '/documents/issue-1',
      pageContext,
    });
    expect(chatPayloads()[1]).toMatchObject({
      prompt: 'What should I ask Alex?',
      context: {
        kind: 'notification',
        findingId: 'finding-1',
        sourcePath: '/documents/issue-1',
        pageContext,
      },
      history: [
        { role: 'user', content: 'Why did this fire?' },
        { role: 'assistant', content: 'Answer 2' },
      ],
    });
  });
});
