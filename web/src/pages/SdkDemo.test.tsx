// SDK demo tests smoke the real browser SDK token store, request paths, and bearer auth.
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SdkDemoPage } from './SdkDemo';

type FetchCall = {
  input: string | URL;
  init?: RequestInit;
};

describe('SdkDemoPage', () => {
  const calls: FetchCall[] = [];

  beforeEach(() => {
    calls.length = 0;
    window.history.replaceState(null, '', '/sdk-demo');
    window.localStorage.setItem('ship.sdkDemo.tokens', JSON.stringify({ accessToken: 'token' }));
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL, init?: RequestInit) => {
      calls.push({ input, init });
      return responseFor(input, init);
    }));
  });

  afterEach(() => {
    window.localStorage.clear();
    vi.unstubAllGlobals();
  });

  it('loads and creates through the real SDK browser client', async () => {
    render(<SdkDemoPage />);

    expect(await screen.findByText('SDK Doc')).toBeInTheDocument();
    expect(await screen.findByText('#12 SDK Issue')).toBeInTheDocument();

    const documentListCall = await waitForCall('/api/v1/documents?limit=20');
    const issueListCall = await waitForCall('/api/v1/issues?limit=20');
    expect(documentListCall.init?.method).toBe('GET');
    expect(issueListCall.init?.method).toBe('GET');
    expect(authHeader(documentListCall)).toBe('Bearer token');
    expect(authHeader(issueListCall)).toBe('Bearer token');

    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    const createCall = await waitForCall('/api/v1/documents', 'POST');
    expect(authHeader(createCall)).toBe('Bearer token');
    expect(JSON.parse(String(createCall.init?.body))).toEqual({ title: 'hello' });
    expect(await screen.findByText('Created Doc')).toBeInTheDocument();
  });

  async function waitForCall(pathWithQuery: string, method = 'GET'): Promise<FetchCall> {
    return waitFor(() => {
      const call = calls.find((entry) =>
        String(entry.input).endsWith(pathWithQuery) &&
        (entry.init?.method ?? 'GET') === method
      );
      expect(call).toBeDefined();
      return call as FetchCall;
    });
  }
});

function responseFor(input: string | URL, init?: RequestInit): Response {
  const url = String(input);
  if (url.endsWith('/api/v1/documents?limit=20')) {
    return jsonResponse({
      data: [{
        id: 'doc-1',
        title: 'SDK Doc',
        document_type: 'wiki',
        updated_at: '2026-06-02T00:00:00.000Z',
      }],
      next_cursor: null,
    });
  }
  if (url.endsWith('/api/v1/issues?limit=20')) {
    return jsonResponse({
      data: [{
        id: 'issue-1',
        display_id: '#12',
        title: 'SDK Issue',
        state: 'todo',
        priority: 'high',
        updated_at: '2026-06-02T00:00:00.000Z',
      }],
      next_cursor: null,
    });
  }
  if (url.endsWith('/api/v1/documents') && init?.method === 'POST') {
    return jsonResponse({
      id: 'doc-2',
      title: 'Created Doc',
      document_type: 'wiki',
      updated_at: '2026-06-02T00:00:00.000Z',
    });
  }
  return jsonResponse({ code: 'not_found', message: 'Not found', request_id: 'test' }, 404);
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function authHeader(call: FetchCall): string | undefined {
  const headers = call.init?.headers;
  if (!headers || headers instanceof Headers || Array.isArray(headers)) return undefined;
  return headers.Authorization;
}
