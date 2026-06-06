// Tests read-only integration proof panel loading and flow chip rendering.
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { IntegrationProofPanel } from './IntegrationProofPanel';

describe('IntegrationProofPanel', () => {
  it('shows flow chips when matrix evidence loads', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo) => {
      const url = String(input);
      if (url.endsWith('/plugforge-evidence/matrix.json')) {
        return new Response(JSON.stringify({
          run_id: 'matrix-live-test',
          status: 'passed',
          flows: [
            { id: 'slack', status: 'passed' },
            { id: 'gitlab', status: 'passed' },
          ],
        }), { status: 200 });
      }
      if (url.endsWith('/plugforge-evidence/ttfe-timing.json')) {
        return new Response(JSON.stringify({ result: { totalMs: 10138 } }), { status: 200 });
      }
      if (url.endsWith('/plugforge-evidence/gitlab.json')) {
        return new Response(JSON.stringify({
          merge_request: { url: 'https://labs.gauntletai.com/demo/-/merge_requests/1', iid: 1 },
          issue: { id: '2b7000ba-ef72-4900-ba01-49f27db7956f' },
        }), { status: 200 });
      }
      return new Response('not found', { status: 404 });
    }));

    render(<IntegrationProofPanel />);

    await waitFor(() => {
      expect(screen.getByText(/matrix-live-test/)).toBeInTheDocument();
    });
    expect(screen.getByText('Slack')).toBeInTheDocument();
    expect(screen.getByText('GitLab')).toBeInTheDocument();
    expect(screen.getByText(/10138 ms/)).toBeInTheDocument();
    vi.unstubAllGlobals();
  });
});
