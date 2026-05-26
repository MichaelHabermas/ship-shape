// FleetGraph finding card tests protect the contextual MVP surface contract.
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiStatusError } from '@/lib/api-error';
import { FleetGraphActiveWeekBanner } from './FleetGraphActiveWeekBanner';
import { FleetGraphFindingCard } from './FleetGraphFindingCard';
import { fleetGraphFindingView, type FleetGraphFindingView } from '@/hooks/useFleetGraphQuery';
import type { components } from '@/api/generated/ship-openapi';

const hookState = vi.hoisted(() => ({
  dismissMutate: vi.fn(),
  explainMutate: vi.fn(),
  refineMutate: vi.fn(),
  dismissError: null as Error | null,
  dismissIsError: false,
  explainError: null as Error | null,
  explainIsError: false,
  explainData: null as { visibleOutput: components['schemas']['FleetGraphVisibleOutput'] } | null,
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
    useFleetGraphExplain: () => ({
      mutateAsync: hookState.explainMutate,
      isPending: false,
      isError: hookState.explainIsError,
      error: hookState.explainError,
      data: hookState.explainData,
    }),
    useFleetGraphRefine: () => ({
      mutateAsync: hookState.refineMutate,
      isPending: false,
      isError: false,
      isSuccess: false,
    }),
  };
});

const finding: FleetGraphFindingView = {
  id: '550e8400-e29b-41d4-a716-446655440000',
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
  status: finding.status,
  sourceIssueId: finding.sourceIssueId,
  sourceSprintId: finding.sourceSprintId,
  visibleOutput: {
    title: finding.title,
    summary: finding.summary,
    severity: 'high',
    confidence: 0.86,
    recommendedAction: { label: 'Confirm the unblock path' },
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
    hookState.explainMutate.mockReset();
    hookState.explainMutate.mockResolvedValue(null);
    hookState.refineMutate.mockReset();
    hookState.refineMutate.mockResolvedValue(null);
    hookState.dismissError = null;
    hookState.dismissIsError = false;
    hookState.explainError = null;
    hookState.explainIsError = false;
    hookState.explainData = null;
  });

  it('renders active-week findings with an issue link', () => {
    render(
      <MemoryRouter>
        <FleetGraphActiveWeekBanner findings={[finding]} />
      </MemoryRouter>
    );

    expect(screen.getByText('1 active-week finding')).toBeTruthy();
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

  it('renders evidence, draft, and human gate without implying execution', () => {
    render(<FleetGraphFindingCard finding={finding} />);

    expect(screen.getByText('Blocked urgent active-week issue')).toBeTruthy();
    expect(screen.getByText('Latest issue iteration says Legal is blocking delivery.')).toBeTruthy();
    expect(screen.getByText('Can you confirm whether Legal can unblock this today?')).toBeTruthy();
    const disabledAction = screen.getByRole('button', { name: 'Prepared only - nothing sent' });
    expect(disabledAction).toBeInstanceOf(HTMLButtonElement);
    expect(disabledAction.getAttribute('disabled')).toBe('');
    expect(screen.getByText('This changes only FleetGraph draft text. Nothing is sent, posted, or changed in Ship.')).toBeTruthy();
    expect(screen.queryByText('rawPrompt')).toBeNull();
  });

  it('keeps explain and refine finding-bound', async () => {
    render(<FleetGraphFindingCard finding={finding} />);

    fireEvent.click(screen.getByRole('button', { name: 'Explain' }));
    await waitFor(() => expect(hookState.explainMutate).toHaveBeenCalledWith(finding.id));

    fireEvent.change(screen.getByLabelText('Refine draft'), {
      target: { value: 'Make it softer.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Refine' }));

    await waitFor(() => expect(hookState.refineMutate).toHaveBeenCalledWith({
      findingId: finding.id,
      instruction: 'Make it softer.',
    }));
  });

  it('shows permission copy only for dismiss 403s', () => {
    hookState.dismissIsError = true;
    hookState.dismissError = new ApiStatusError('Forbidden', 403);

    const { rerender } = render(<FleetGraphFindingCard finding={finding} />);
    expect(screen.getByText('Only workspace admins can dismiss shared FleetGraph findings.')).toBeTruthy();

    hookState.dismissError = new ApiStatusError('Server error', 500);
    rerender(<FleetGraphFindingCard finding={finding} />);
    expect(screen.getByText('FleetGraph could not dismiss this finding.')).toBeTruthy();
  });

  it('keeps hidden errors distinct from operational explain failures', () => {
    hookState.explainIsError = true;
    hookState.explainError = new ApiStatusError('Not found', 404);

    const { rerender } = render(<FleetGraphFindingCard finding={finding} />);
    expect(screen.getByText('No visible FleetGraph finding here.')).toBeTruthy();

    hookState.explainError = new ApiStatusError('Server error', 500);
    rerender(<FleetGraphFindingCard finding={finding} />);
    expect(screen.getByText('FleetGraph could not explain this finding.')).toBeTruthy();
  });

  it('normalizes safe API visible output into a finding view', () => {
    const view = fleetGraphFindingView(apiFinding);

    expect(view.recommendedAction).toBe('Confirm the unblock path');
    expect(view.recipientRationale).toBe('Recipient is the issue assignee, falling back to the sprint owner.');
    expect(view.uncertainty).toBe('A human must confirm the current unblock path.');
    expect(view.severity).toBe('high');
    expect(view.confidence).toBe('86%');
    expect(view.draftText).toBe(finding.draftText);
  });
});
