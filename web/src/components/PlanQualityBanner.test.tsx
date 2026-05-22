import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { PlanQualityBanner, RetroQualityBanner } from './PlanQualityBanner';

const realFetch = global.fetch;

function jsonResponse(data: unknown, status = 200): Promise<Response> {
  return Promise.resolve(new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  }));
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

describe('RetroQualityBanner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = realFetch;
    vi.restoreAllMocks();
  });

  it('reloads persisted analysis when documentId changes', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = requestUrl(input);
      const method = init?.method || 'GET';

      if (url.endsWith('/api/ai/status')) {
        return jsonResponse({ available: true });
      }

      if (method === 'GET' && url.includes('/api/documents/doc-1')) {
        return jsonResponse({
          content: { type: 'doc', content: [] },
          properties: {
            ai_analysis: {
              overall_score: 0.25,
              plan_coverage: [],
              suggestions: [],
              content_hash: 'doc-1-hash',
            },
          },
        });
      }

      if (method === 'GET' && url.includes('/api/documents/doc-2')) {
        return jsonResponse({
          content: { type: 'doc', content: [] },
          properties: {
            ai_analysis: {
              overall_score: 0.9,
              plan_coverage: [],
              suggestions: [],
              content_hash: 'doc-2-hash',
            },
          },
        });
      }

      throw new Error(`Unexpected fetch call: ${method} ${url}`);
    });

    global.fetch = fetchMock;

    const { rerender } = render(
      <RetroQualityBanner
        documentId="doc-1"
        editorContent={null}
        planContent={null}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('25%')).toBeInTheDocument();
    });

    rerender(
      <RetroQualityBanner
        documentId="doc-2"
        editorContent={null}
        planContent={null}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('90%')).toBeInTheDocument();
    });

    expect(screen.queryByText('25%')).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([input]) => requestUrl(input).includes('/api/documents/doc-2'))).toBe(true);
  });

  it('keeps persisted analysis visible when AI is unavailable', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = requestUrl(input);
      const method = init?.method || 'GET';

      if (url.endsWith('/api/ai/status')) {
        return jsonResponse({ available: false, error: 'ai_unavailable' });
      }

      if (method === 'GET' && url.includes('/api/documents/doc-1')) {
        return jsonResponse({
          content: { type: 'doc', content: [] },
          properties: {
            ai_analysis: {
              overall_score: 0.7,
              plan_coverage: [],
              suggestions: [],
              content_hash: 'doc-1-hash',
            },
          },
        });
      }

      throw new Error(`Unexpected fetch call: ${method} ${url}`);
    });

    global.fetch = fetchMock;

    render(
      <RetroQualityBanner
        documentId="doc-1"
        editorContent={null}
        planContent={null}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('70%')).toBeInTheDocument();
      expect(screen.getByText('AI unavailable; showing last saved analysis')).toBeInTheDocument();
    });
  });
});

describe('PlanQualityBanner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = realFetch;
    vi.restoreAllMocks();
  });

  it('shows unavailable state when AI is unavailable and no saved analysis exists', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = requestUrl(input);
      const method = init?.method || 'GET';

      if (url.endsWith('/api/ai/status')) {
        return jsonResponse({ available: false, error: 'ai_unavailable' });
      }

      if (method === 'GET' && url.includes('/api/documents/doc-1')) {
        return jsonResponse({
          content: { type: 'doc', content: [] },
          properties: {},
        });
      }

      throw new Error(`Unexpected fetch call: ${method} ${url}`);
    });

    global.fetch = fetchMock;

    render(
      <PlanQualityBanner
        documentId="doc-1"
        editorContent={null}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('AI unavailable')).toBeInTheDocument();
    });
  });
});
