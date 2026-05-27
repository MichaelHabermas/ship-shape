// FleetGraph finding card tests protect the contextual MVP surface contract.
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiStatusError } from '@/lib/api-error';
import { FleetGraphActiveWeekBanner } from './FleetGraphActiveWeekBanner';
import { FleetGraphFindingCard } from './FleetGraphFindingCard';
import { fleetGraphFindingView, type FleetGraphFindingView } from '@/hooks/useFleetGraphQuery';
import type { components } from '@/api/generated/ship-openapi';

const hookState = vi.hoisted(() => ({
  dismissMutate: vi.fn(),
  dismissError: null as Error | null,
  dismissIsError: false,
  changesMutate: vi.fn(),
  changesData: null as null | {
    headline: string;
    rows: Array<{ label: 'Now' | 'Changed' | 'Cleared' | 'Next' | 'Unknown' | 'Not done'; text: string }>;
  },
  changesIsError: false,
}));

vi.mock('@/hooks/useFleetGraphQuery', async () => {
  const actual = await vi.importActual<typeof import('@/hooks/useFleetGraphQuery')>('@/hooks/useFleetGraphQuery');
  return {
    ...actual,
    useFleetGraphDismiss: () => ({
      mutateAsync: hookState.dismissMutate,
      isPending: false,
      isError: hookState.dismissIsError,
      error: hookState.dismissError,
    }),
    useFleetGraphChanges: () => ({
      mutateAsync: hookState.changesMutate,
      isPending: false,
      isError: hookState.changesIsError,
      data: hookState.changesData,
    }),
  };
});

vi.mock('@/hooks/useTeamMembersQuery', () => ({
  useTeamMembersQuery: () => ({
    data: [
      {
        id: 'person-1',
        user_id: '550e8400-e29b-41d4-a716-446655440099',
        name: 'Riley Builder',
        email: 'riley@example.com',
      },
    ],
  }),
}));

const finding: FleetGraphFindingView = {
  id: '550e8400-e29b-41d4-a716-446655440000',
  kind: 'blocker',
  status: 'needs_confirmation',
  sourceIssueId: '550e8400-e29b-41d4-a716-446655440001',
  sourceSprintId: '550e8400-e29b-41d4-a716-446655440002',
  title: 'Blocked urgent active-week issue',
  summary: 'The issue has a blocker and needs a PM decision.',
  evidence: [
    {
      kind: 'issue_iteration',
      claim: 'Latest issue iteration says Legal is blocking delivery.',
      excerpt: 'Waiting on Legal approval.',
      visibility: 'actor_visible',
      visibleFields: ['blockers_encountered'],
      sourceType: 'issue',
      sourceDocumentId: '550e8400-e29b-41d4-a716-446655440001',
    },
  ],
  humanGate: {
    required: true,
    reason: 'A human must approve before contacting the assignee.',
    blockedConsequence: 'No comment or message is sent.',
  },
  draftText: 'Can you confirm whether Legal can unblock this today?',
  recommendedAction: 'Ask the assignee for the smallest unblock step.',
  proposedRecipient: {
    role: 'issue_assignee',
    userId: '550e8400-e29b-41d4-a716-446655440099',
    rationale: 'Recipient is the issue assignee.',
  },
  recipientRationale: 'The assignee is the smallest useful audience.',
  uncertainty: 'FleetGraph cannot see Legal ownership.',
  severity: 'high',
  confidence: 'medium',
  trace: {
    mode: 'proactive',
    decision: 'create_finding',
    nodePath: ['normalizeTrigger', 'createFinding'],
  },
};

const apiFinding: components['schemas']['FleetGraphFindingResponse'] = {
  id: finding.id,
  kind: 'blocker',
  status: finding.status,
  sourceIssueId: finding.sourceIssueId,
  sourceSprintId: finding.sourceSprintId,
  visibleOutput: {
    title: finding.title,
    summary: finding.summary,
    severity: 'high',
    confidence: 0.86,
    recommendedAction: { label: 'Confirm the unblock path' },
    proposedRecipient: {
      role: 'issue_assignee',
      userId: finding.proposedRecipient.userId,
      rationale: 'Recipient is the issue assignee.',
    },
    recipientRationale: 'Recipient is the issue assignee, falling back to the sprint owner.',
    uncertaintyNotes: ['A human must confirm the current unblock path.'],
    evidence: finding.evidence,
    humanGate: {
      required: true,
      reason: finding.humanGate.reason,
      blockedConsequence: finding.humanGate.blockedConsequence,
    },
    draftContent: { message: finding.draftText },
  },
  traceMetadata: finding.trace,
};

describe('FleetGraph product surface', () => {
  beforeEach(() => {
    hookState.dismissMutate.mockReset();
    hookState.dismissMutate.mockResolvedValue(null);
    hookState.dismissError = null;
    hookState.dismissIsError = false;
    hookState.changesMutate.mockReset();
    hookState.changesMutate.mockResolvedValue(null);
    hookState.changesData = null;
    hookState.changesIsError = false;
  });

  it('renders active-week findings with an issue link', () => {
    render(
      <MemoryRouter>
        <FleetGraphActiveWeekBanner findings={[finding]} />
      </MemoryRouter>
    );

    expect(screen.getByText('1 active-week blocker needs PM review')).toBeTruthy();
    expect(screen.getByRole('link', { name: `Open issue: ${finding.title}` }).getAttribute('href')).toBe(`/documents/${finding.sourceIssueId}`);
  });

  it('renders affected issue links for multiple active-week findings', () => {
    const secondFinding = {
      ...finding,
      id: '550e8400-e29b-41d4-a716-446655440010',
      sourceIssueId: '550e8400-e29b-41d4-a716-446655440011',
      title: 'Second blocked issue',
    };

    render(
      <MemoryRouter>
        <FleetGraphActiveWeekBanner findings={[finding, secondFinding]} />
      </MemoryRouter>
    );

    expect(screen.getByRole('link', { name: `Open issue: ${finding.title}` }).getAttribute('href')).toBe(`/documents/${finding.sourceIssueId}`);
    expect(screen.getByRole('link', { name: `Open issue: ${secondFinding.title}` }).getAttribute('href')).toBe(`/documents/${secondFinding.sourceIssueId}`);
  });

  it('renders a sparse unblock prompt without fake chat controls', () => {
    render(
      <MemoryRouter>
        <FleetGraphFindingCard finding={finding} />
      </MemoryRouter>
    );

    expect(screen.getByText('Blocked urgent active-week issue')).toBeTruthy();
    expect(screen.queryByText('FleetGraph')).toBeNull();
    expect(screen.queryByText('Needs confirmation')).toBeNull();
    expect(screen.getByRole('link', { name: 'Open issue' }).getAttribute('href')).toBe(`/documents/${finding.sourceIssueId}`);
    fireEvent.click(screen.getByRole('button', { name: 'What changed?' }));
    expect(hookState.changesMutate).toHaveBeenCalledWith(finding.id);
    expect(screen.queryByText('Latest issue iteration says Legal is blocking delivery.')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Details' }));

    expect(screen.getByText('Unblock')).toBeTruthy();
    expect(screen.getByText('Ask')).toBeTruthy();
    expect(screen.getByText('Why now')).toBeTruthy();
    expect(screen.getByText('Not done')).toBeTruthy();
    expect(screen.getByText('No issue changed. No message sent.')).toBeTruthy();
    expect(screen.getByText(finding.recommendedAction ?? '')).toBeTruthy();
    expect(screen.queryByText('Latest issue iteration says Legal is blocking delivery.')).toBeNull();
    expect(screen.queryByText('Evidence')).toBeNull();
    expect(screen.getByText('Send to')).toBeTruthy();
    expect(screen.getByText('Riley Builder')).toBeTruthy();
    expect(screen.getByText(/Issue assignee/)).toBeTruthy();
    expect(screen.getByText('Message')).toBeTruthy();
    expect(screen.getByText('Riley, can you confirm the unblock path today? The issue has a blocker and needs a PM decision.')).toBeTruthy();
    expect(screen.queryByText(finding.draftText ?? '')).toBeNull();
    expect(screen.queryByText('Human gate')).toBeNull();
    expect(screen.queryByText(finding.humanGate.reason ?? '')).toBeNull();
    expect(screen.getByText('Unknown')).toBeTruthy();
    expect(screen.getByText(finding.uncertainty ?? '')).toBeTruthy();
    expect(screen.queryByText('Prepared issue comment')).toBeNull();
    expect(screen.queryByText('Needs approval')).toBeNull();
    expect(screen.queryByText('rawPrompt')).toBeNull();
    expect(screen.queryByText('blocker finding')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Why was this flagged?' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'What should happen next?' })).toBeNull();
    expect(screen.queryByPlaceholderText('Rewrite the draft with this instruction...')).toBeNull();
    expect(screen.queryByText('Sent')).toBeNull();
    expect(screen.queryByText('Posted')).toBeNull();
    expect(screen.queryByText('Updated issue')).toBeNull();
    expect(screen.queryByText('Accepted risk')).toBeNull();
    expect(screen.queryByText('Open trace')).toBeNull();
  });

  it('renders only anchored change rows after asking what changed', () => {
    hookState.changesData = {
      headline: 'Priority raised',
      rows: [
        { label: 'Changed', text: 'Priority High -> Urgent.' },
        { label: 'Not done', text: 'No issue changed. No message sent.' },
      ],
    };

    render(
      <MemoryRouter>
        <FleetGraphFindingCard finding={finding} />
      </MemoryRouter>
    );

    expect(screen.getByText('Priority raised')).toBeTruthy();
    expect(screen.getByText('Changed')).toBeTruthy();
    expect(screen.getByText('Priority High -> Urgent.')).toBeTruthy();
    expect(screen.getByText('Not done')).toBeTruthy();
    expect(screen.getByText('No issue changed. No message sent.')).toBeTruthy();
    expect(screen.queryByText('Evidence')).toBeNull();
    expect(screen.queryByText('Human gate')).toBeNull();
  });

  it('does not crash when a finding has no proposed recipient payload', () => {
    const findingWithoutRecipient = {
      ...finding,
      proposedRecipient: undefined,
    } as unknown as FleetGraphFindingView;

    render(
      <MemoryRouter>
        <FleetGraphFindingCard finding={findingWithoutRecipient} />
      </MemoryRouter>
    );

    expect(screen.getByRole('link', { name: 'Open issue' }).getAttribute('href')).toBe(`/documents/${finding.sourceIssueId}`);
    fireEvent.click(screen.getByRole('button', { name: 'Details' }));
    expect(screen.queryByText('Send to')).toBeNull();
  });

  it('shows permission copy only for dismiss 403s', () => {
    hookState.dismissIsError = true;
    hookState.dismissError = new ApiStatusError('Forbidden', 403);

    const { rerender } = render(
      <MemoryRouter>
        <FleetGraphFindingCard finding={finding} />
      </MemoryRouter>
    );
    expect(screen.getByText('Only workspace admins can dismiss shared FleetGraph findings.')).toBeTruthy();

    hookState.dismissError = new ApiStatusError('Server error', 500);
    rerender(
      <MemoryRouter>
        <FleetGraphFindingCard finding={finding} />
      </MemoryRouter>
    );
    expect(screen.getByText('FleetGraph could not dismiss this finding.')).toBeTruthy();
  });

  it('normalizes safe API visible output into a finding view', () => {
    const view = fleetGraphFindingView(apiFinding);

    expect(view.recommendedAction).toBe('Confirm the unblock path');
    expect(view.kind).toBe('blocker');
    expect(view.proposedRecipient).toEqual(finding.proposedRecipient);
    expect(view.recipientRationale).toBe('Recipient is the issue assignee, falling back to the sprint owner.');
    expect(view.uncertainty).toBe('A human must confirm the current unblock path.');
    expect(view.severity).toBe('high');
    expect(view.confidence).toBe('86%');
    expect(view.draftText).toBe(finding.draftText);
  });
});
