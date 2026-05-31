// Verifies the reviewer control room surfaces live operation state while proof actions are running.
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { FleetGraphReviewerPage } from './FleetGraphReviewerPage';
import { apiGetJson, apiPostJson } from '@/lib/api';

vi.mock('@/lib/api', () => ({
  apiGetJson: vi.fn(),
  apiPostJson: vi.fn(),
}));

const emptyChainsResponse = {
  summary: {
    generatedAt: '2026-05-30T00:00:00.000Z',
    status: 'broken',
    chainCount: 0,
    completeCount: 0,
    brokenCount: 0,
    requiredGates: [],
    costSummary: { modelCalls: 0, costCurrency: 'USD' },
  },
  chains: [],
};

const brokenChain = {
  chainId: '11111111-1111-4111-8111-111111111111',
  scenario: 'week-blocker',
  status: 'broken',
  missing: ['source_mutation_check'],
  generatedAt: '2026-05-30T00:00:00.000Z',
  freshness: {
    generatedAt: '2026-05-30T00:00:00.000Z',
    newestRunAt: '2026-05-30T00:00:00.000Z',
    newestWorkerTickAt: '2026-05-30T00:00:00.000Z',
    proofAgeMs: 1000,
    workerAgeMs: 1000,
  },
  latencyMs: { total: 0 },
  links: {
    sourceIssueId: '22222222-2222-4222-8222-222222222222',
    sourceSprintId: '33333333-3333-4333-8333-333333333333',
    runId: '11111111-1111-4111-8111-111111111111',
    findingId: '44444444-4444-4444-8444-444444444444',
  },
  steps: [
    { key: 'source', label: 'Ship source', status: 'pass', at: '2026-05-30T00:00:00.000Z', evidence: 'Issue exists.' },
    { key: 'graph_run', label: 'Graph run', status: 'pass', at: '2026-05-30T00:00:00.000Z', evidence: 'create_finding' },
  ],
  humanGate: { required: true, state: 'present', allowedActions: ['inspect evidence'] },
  traceQuality: { passed: true, requiredDecisions: [], observedDecisions: [], scores: [] },
  sourceMutationCheck: { passed: false, before: {}, after: {}, changedFields: ['not_measured'] },
  usageSummary: { modelCalls: 0, costCurrency: 'USD' },
};

const completeChain = {
  ...brokenChain,
  chainId: '55555555-5555-4555-8555-555555555555',
  status: 'complete',
  missing: [],
  links: {
    ...brokenChain.links,
    runId: '55555555-5555-4555-8555-555555555555',
    findingId: '66666666-6666-4666-8666-666666666666',
    traceUrl: 'https://us.cloud.langfuse.com/project/cmpq0gd7n014vad0ejpkkkpqo/traces/77c553afabd3c7a6dfcc980726b35aa5',
  },
  steps: [
    { key: 'source', label: 'Ship source', status: 'pass', at: '2026-05-30T21:51:17.624Z', evidence: 'Issue changed at 2026-05-30T21:51:17.616Z.' },
    { key: 'attention_event', label: 'Attention event', status: 'pass', at: '2026-05-30T21:51:17.626Z', evidence: 'completed' },
    { key: 'worker_tick', label: 'Worker tick', status: 'pass', at: '2026-05-30T21:51:17.628Z', evidence: 'completed' },
    { key: 'graph_run', label: 'Graph run', status: 'pass', at: '2026-05-30T21:51:17.630Z', evidence: 'create_finding' },
    { key: 'trace', label: 'Trace', status: 'pass', at: '2026-05-30T21:51:17.631Z', evidence: 'Safe trace URL captured' },
    { key: 'finding', label: 'Finding', status: 'pass', at: '2026-05-30T21:51:17.632Z', evidence: 'needs_confirmation' },
    { key: 'notification_projection', label: 'Notification projection', status: 'pass', at: '2026-05-30T21:51:17.633Z', evidence: 'Derived from visible finding' },
    { key: 'chat_human_gate', label: 'Chat and human gate', status: 'pass', at: '2026-05-30T21:51:17.634Z', evidence: 'Visible output contains human gate metadata' },
  ],
  visibleOutput: {
    title: 'Blocked: canonical reviewer proof 2026-05-30T21:51:17.616Z',
    summary: 'The canonical week-blocker proof is complete at 2026-05-30T21:51:17.616Z.',
    severity: 'high',
    confidence: 0.9,
    evidence: [],
    recommendedActions: [],
    proposedRecipients: [],
    humanGate: { approvalRequired: true },
  },
  sourceMutationCheck: { passed: true, before: {}, after: {}, changedFields: [] },
};

function renderPage(path = '/fleetgraph/reviewer') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <FleetGraphReviewerPage />
    </MemoryRouter>
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('FleetGraphReviewerPage', () => {
  it('opens the live operation drawer immediately when the scenario starts', async () => {
    vi.mocked(apiGetJson).mockResolvedValue(emptyChainsResponse);
    vi.mocked(apiPostJson).mockImplementation(() => new Promise(() => {}));

    renderPage();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Run scenario' })).toBeEnabled();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Run scenario' }));

    expect(await screen.findByText('Live operation')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Running reviewer scenario' })).toBeInTheDocument();
    expect(screen.getByText('Source checked')).toBeInTheDocument();
    expect(screen.getByText('Event enqueued')).toBeInTheDocument();
    expect(screen.getAllByText('Worker tick').length).toBeGreaterThan(1);
    expect(screen.getByText('Trace captured')).toBeInTheDocument();
    expect(screen.getByText('Finding projected')).toBeInTheDocument();
    expect(screen.getByText('Source unchanged')).toBeInTheDocument();
    expect(screen.getByText('Chain refreshed')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Running...' })).toBeDisabled();
    expect(apiPostJson).toHaveBeenCalledWith(
      '/api/fleetgraph/reviewer/scenarios/week-blocker',
      { triggerWorker: true, freshRun: true },
      'Failed to run reviewer scenario'
    );
  });

  it('runs safe proof repair for the selected broken chain', async () => {
    vi.mocked(apiGetJson).mockResolvedValue({
      ...emptyChainsResponse,
      summary: { ...emptyChainsResponse.summary, chainCount: 1, brokenCount: 1 },
      chains: [brokenChain],
    });
    vi.mocked(apiPostJson).mockImplementation(() => new Promise(() => {}));

    renderPage();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Repair proof' })).toBeEnabled();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Repair proof' }));

    expect(await screen.findByRole('heading', { name: 'Repairing proof' })).toBeInTheDocument();
    expect(screen.getByText('Chat proof run')).toBeInTheDocument();
    expect(screen.getByText('Source unchanged')).toBeInTheDocument();
    expect(apiPostJson).toHaveBeenCalledWith(
      '/api/fleetgraph/reviewer/repair',
      { chainId: brokenChain.chainId },
      'Failed to repair reviewer proof'
    );
  });

  it('prefers a complete week-blocker chain over a broken historical default', async () => {
    vi.mocked(apiGetJson).mockResolvedValue({
      ...emptyChainsResponse,
      summary: { ...emptyChainsResponse.summary, chainCount: 2, completeCount: 1, brokenCount: 1 },
      chains: [
        { ...brokenChain, scenario: 'existing' },
        completeChain,
      ],
    });
    vi.mocked(apiPostJson).mockResolvedValue({
      verdict: 'pass',
      generatedAt: '2026-05-30T00:00:00.000Z',
      chainId: completeChain.chainId,
      artifactPaths: {},
    });

    renderPage();

    expect(await screen.findByText(/Blocked: canonical reviewer proof/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Generate packet' }));

    await waitFor(() => {
      expect(apiPostJson).toHaveBeenCalledWith(
        '/api/fleetgraph/reviewer/proof',
        { chainId: completeChain.chainId },
        'Failed to generate proof packet'
      );
    });
  });

  it('renders the selected finding blast radius map', async () => {
    vi.mocked(apiGetJson).mockImplementation(async (endpoint) => {
      if (endpoint === '/api/fleetgraph/reviewer/chains?limit=25') {
        return {
          ...emptyChainsResponse,
          summary: { ...emptyChainsResponse.summary, chainCount: 1, completeCount: 1 },
          chains: [completeChain],
        };
      }
      if (endpoint === `/api/fleetgraph/findings/${completeChain.links.findingId}/blast-radius-map`) {
        return {
          finding: {
            id: completeChain.links.findingId,
            kind: 'blocker',
            status: 'needs_confirmation',
            signalType: 'blocked',
            signalLabel: 'Blocked',
            reason: 'Visible summary',
            sourceIssueId: completeChain.links.sourceIssueId,
            sourceSprintId: completeChain.links.sourceSprintId,
            visibleOutput: completeChain.visibleOutput,
            traceMetadata: { mode: 'proactive', decision: 'create_finding', nodePath: ['detectorDecision'] },
          },
          summary: 'Credential path touches 1 project and 1 person.',
          nodes: [
            { id: `finding:${completeChain.links.findingId}`, kind: 'finding', title: 'Blocked credential path' },
            { id: `issue:${completeChain.links.sourceIssueId}`, kind: 'issue', title: 'Credential path' },
            { id: 'project:77777777-7777-4777-8777-777777777777', kind: 'project', title: 'Audit Load' },
            { id: 'person:88888888-8888-4888-8888-888888888888', kind: 'person', title: 'Casey Engineer', subtitle: 'Issue assignee' },
          ],
          edges: [
            { from: `finding:${completeChain.links.findingId}`, to: `issue:${completeChain.links.sourceIssueId}`, kind: 'source_issue', label: 'source issue' },
          ],
        };
      }
      throw new Error(`Unexpected GET ${endpoint}`);
    });

    renderPage();

    expect(await screen.findByText('Blast radius')).toBeInTheDocument();
    expect(await screen.findByText('Credential path touches 1 project and 1 person.')).toBeInTheDocument();
    expect(screen.getByText('Audit Load')).toBeInTheDocument();
    expect(screen.getByText('Casey Engineer')).toBeInTheDocument();
    expect(screen.getByText('1 visible link')).toBeInTheDocument();
  });

  it('generates packets from the selected chain even when that selected chain is broken', async () => {
    vi.mocked(apiGetJson).mockResolvedValue({
      ...emptyChainsResponse,
      summary: { ...emptyChainsResponse.summary, chainCount: 2, completeCount: 1, brokenCount: 1 },
      chains: [
        { ...brokenChain, scenario: 'existing' },
        completeChain,
      ],
    });
    vi.mocked(apiPostJson).mockResolvedValue({
      verdict: 'fail',
      generatedAt: '2026-05-30T00:00:00.000Z',
      chainId: brokenChain.chainId,
      artifactPaths: {},
    });

    renderPage(`/fleetgraph/reviewer?findingId=${brokenChain.links.findingId}`);

    expect(await screen.findByText('Selected chain is existing / broken.')).toBeInTheDocument();
    expect(screen.getByText(/Generate packet will use the selected existing \/ broken chain/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Generate packet' }));

    await waitFor(() => {
      expect(apiPostJson).toHaveBeenCalledWith(
        '/api/fleetgraph/reviewer/proof',
        { chainId: brokenChain.chainId },
        'Failed to generate proof packet'
      );
    });
  });

  it('collapses completed live operations so the evidence workspace keeps the viewport', async () => {
    vi.mocked(apiGetJson).mockResolvedValue({
      ...emptyChainsResponse,
      summary: { ...emptyChainsResponse.summary, chainCount: 1, completeCount: 1 },
      chains: [completeChain],
    });
    vi.mocked(apiPostJson).mockResolvedValue({
      verdict: 'pass',
      generatedAt: '2026-05-30T00:00:00.000Z',
      chainId: completeChain.chainId,
      artifactPaths: {},
    });

    renderPage();

    await screen.findByText(/Blocked: canonical reviewer proof/);
    fireEvent.click(screen.getByRole('button', { name: 'Generate packet' }));

    expect(await screen.findByText('Packet pass. Static artifacts were generated from live verifier evidence.')).toBeInTheDocument();
    expect(screen.queryByText('Packet rendered')).not.toBeInTheDocument();
    expect(screen.getByText('Causal chain')).toBeInTheDocument();
  });

  it('shortens visible UUIDs and copies the full value on click', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    vi.mocked(apiGetJson).mockResolvedValue({
      ...emptyChainsResponse,
      summary: { ...emptyChainsResponse.summary, chainCount: 1, completeCount: 1 },
      chains: [completeChain],
    });

    renderPage();

    const [findingUuid] = await screen.findAllByText('6666...6666');

    fireEvent.click(findingUuid);

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(completeChain.links.findingId);
    });
    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: 'Copied' }).length).toBeGreaterThan(0);
    });
  });

  it('keeps noisy proof identifiers actionable without rendering raw trace ids or ISO dates', async () => {
    vi.mocked(apiGetJson).mockResolvedValue({
      ...emptyChainsResponse,
      summary: { ...emptyChainsResponse.summary, chainCount: 1, completeCount: 1 },
      chains: [completeChain],
    });

    renderPage();

    expect(await screen.findByText(/Blocked: canonical reviewer proof/)).not.toHaveTextContent('2026-05-30T21:51:17.616Z');
    expect(screen.getAllByText('5555...5555').length).toBeGreaterThan(0);
    expect(screen.getAllByText('6666...6666').length).toBeGreaterThan(0);
    expect(screen.queryByText('77c553afabd3c7a6dfcc980726b35aa5')).not.toBeInTheDocument();
    expect(screen.queryByText(/2026-05-30T21:51:17\.616Z/)).not.toBeInTheDocument();

    const traceLink = screen.getByRole('link', { name: 'trace 77c5...5aa5' });
    expect(traceLink).toHaveAttribute('href', completeChain.links.traceUrl);
  });
});
