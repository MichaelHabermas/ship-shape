import { describe, it, expect } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import type { IssueListItem } from '@/api/schemas';
import {
  issueMatchesFilters,
  replaceIssueInMatchingLists,
  replaceIssueWithServerData,
} from '@/hooks/issue-list-cache';
import { issueKeys } from '@/hooks/issue-keys';

function makeIssue(id: string, sprintId: string | null): IssueListItem {
  return {
    id,
    title: 'Issue',
    state: 'backlog',
    priority: 'medium',
    ticket_number: 1,
    display_id: 'TEST-1',
    belongs_to: sprintId ? [{ id: sprintId, type: 'sprint' }] : [],
    source: 'internal',
    rejection_reason: null,
    created_at: '2025-01-01T00:00:00.000Z',
    updated_at: '2025-01-01T00:00:00.000Z',
  };
}

describe('issueMatchesFilters', () => {
  it('matches sprint-filtered lists by belongs_to sprint association', () => {
    const issue = makeIssue('a', 'sprint-a');
    expect(issueMatchesFilters(issue, { sprintId: 'sprint-a' })).toBe(true);
    expect(issueMatchesFilters(issue, { sprintId: 'sprint-b' })).toBe(false);
  });
});

describe('replaceIssueWithServerData', () => {
  it('removes issue from sprint-filtered cache when sprint association changes', () => {
    const queryClient = new QueryClient();
    const sprintA = 'sprint-a';
    const sprintB = 'sprint-b';
    queryClient.setQueryData(issueKeys.list({ sprintId: sprintA }), [makeIssue('issue-1', sprintA)]);

    replaceIssueWithServerData(queryClient, 'issue-1', makeIssue('issue-1', sprintB));

    expect(queryClient.getQueryData(issueKeys.list({ sprintId: sprintA }))).toEqual([]);
  });

  it('inserts into matching cached list when issue moves into that filter', () => {
    const queryClient = new QueryClient();
    const sprintA = 'sprint-a';
    const sprintB = 'sprint-b';
    queryClient.setQueryData(issueKeys.list({ sprintId: sprintA }), [makeIssue('issue-1', sprintA)]);
    queryClient.setQueryData(issueKeys.list({ sprintId: sprintB }), []);

    replaceIssueWithServerData(queryClient, 'issue-1', makeIssue('issue-1', sprintB));

    expect(queryClient.getQueryData(issueKeys.list({ sprintId: sprintA }))).toEqual([]);
    expect(queryClient.getQueryData(issueKeys.list({ sprintId: sprintB }))).toEqual([
      makeIssue('issue-1', sprintB),
    ]);
  });
});

describe('replaceIssueInMatchingLists', () => {
  it('evicts issue from filtered list when optimistic update changes sprint', () => {
    const queryClient = new QueryClient();
    const sprintA = 'sprint-a';
    const sprintB = 'sprint-b';
    queryClient.setQueryData(issueKeys.list({ sprintId: sprintA }), [makeIssue('issue-1', sprintA)]);

    replaceIssueInMatchingLists(queryClient, 'issue-1', (issue) =>
      makeIssue(issue.id, sprintB),
    );

    expect(queryClient.getQueryData(issueKeys.list({ sprintId: sprintA }))).toEqual([]);
  });
});
