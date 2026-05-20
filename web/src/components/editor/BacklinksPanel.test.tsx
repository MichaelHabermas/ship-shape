import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { ToastProvider } from '@/components/ui/Toast';
import { BacklinksPanel } from './BacklinksPanel';

const realFetch = global.fetch;

const backlink = {
  id: 'source-doc',
  document_type: 'wiki',
  title: 'Source Doc',
};

function renderPanel() {
  return render(
    <MemoryRouter>
      <ToastProvider>
        <BacklinksPanel documentId="target-doc" />
      </ToastProvider>
    </MemoryRouter>
  );
}

function jsonResponse(data: unknown): Promise<Response> {
  return Promise.resolve(new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  }));
}

function deferredJsonResponse(data: unknown) {
  let resolve!: () => void;
  const promise = new Promise<Response>((resolvePromise) => {
    resolve = () => {
      resolvePromise(new Response(JSON.stringify(data), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }));
    };
  });
  return { promise, resolve };
}

function setOnline(value: boolean) {
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(value);
}

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
}

describe('BacklinksPanel', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setOnline(true);
  });

  afterEach(() => {
    global.fetch = realFetch;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('keeps the last successful backlinks and avoids repeated console spam while retrying', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(() => jsonResponse([backlink]))
      .mockRejectedValue(new Error('network down'));
    global.fetch = fetchMock;

    renderPanel();

    await act(flushPromises);

    expect(screen.getByText('Source Doc')).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(5000);
      await flushPromises();
    });

    expect(screen.getByRole('status')).toHaveTextContent('Connection issue. Showing last updated backlinks.');
    expect(screen.getByText('Source Doc')).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(15000);
      await flushPromises();
      vi.advanceTimersByTime(15000);
      await flushPromises();
    });

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(consoleError).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Source Doc')).toBeInTheDocument();
  });

  it('pauses polling while offline and retries immediately when online', async () => {
    setOnline(false);
    const fetchMock = vi.fn(() => jsonResponse([backlink]));
    global.fetch = fetchMock;

    renderPanel();

    await act(flushPromises);

    expect(screen.getByRole('status')).toHaveTextContent('Offline. Backlinks will load when connection returns.');
    expect(fetchMock).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(20000);
    });

    expect(fetchMock).not.toHaveBeenCalled();

    setOnline(true);
    await act(async () => {
      window.dispatchEvent(new Event('online'));
      await flushPromises();
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Source Doc')).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('does not restart polling when an in-flight request resolves after going offline', async () => {
    const firstResponse = deferredJsonResponse([backlink]);
    const fetchMock = vi
      .fn()
      .mockReturnValueOnce(firstResponse.promise)
      .mockImplementation(() => jsonResponse([backlink]));
    global.fetch = fetchMock;

    renderPanel();

    expect(fetchMock).toHaveBeenCalledTimes(1);

    setOnline(false);
    await act(async () => {
      window.dispatchEvent(new Event('offline'));
    });

    expect(screen.getByRole('status')).toHaveTextContent('Offline. Backlinks will load when connection returns.');

    await act(async () => {
      firstResponse.resolve();
      await flushPromises();
    });

    expect(screen.getByText('Source Doc')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Offline. Showing saved backlinks.');

    await act(async () => {
      vi.advanceTimersByTime(5000);
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);

    setOnline(true);
    await act(async () => {
      window.dispatchEvent(new Event('online'));
      await flushPromises();
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
