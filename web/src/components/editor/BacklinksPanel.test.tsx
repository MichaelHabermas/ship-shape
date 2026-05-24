import { act, fireEvent, render, screen } from '@testing-library/react';
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

function panelUi(documentId: string) {
  return (
    <MemoryRouter>
      <ToastProvider>
        <BacklinksPanel documentId={documentId} />
      </ToastProvider>
    </MemoryRouter>
  );
}

function renderPanel(documentId = 'target-doc') {
  return render(panelUi(documentId));
}

function rerenderPanel(rerender: ReturnType<typeof render>['rerender'], documentId: string) {
  rerender(panelUi(documentId));
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

    await act(flushPromises);

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

  it('clears backlinks from the previous document while loading a new document', async () => {
    const secondResponse = deferredJsonResponse([{
      id: 'next-source-doc',
      document_type: 'wiki',
      title: 'Next Source Doc',
    }]);
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(() => jsonResponse([backlink]))
      .mockReturnValueOnce(secondResponse.promise);
    global.fetch = fetchMock;

    const { rerender } = renderPanel();

    await act(flushPromises);
    expect(screen.getByText('Source Doc')).toBeInTheDocument();

    rerenderPanel(rerender, 'next-target-doc');
    await act(flushPromises);

    expect(screen.queryByText('Source Doc')).not.toBeInTheDocument();
    expect(screen.getByText('Loading...')).toBeInTheDocument();

    await act(async () => {
      secondResponse.resolve();
      await flushPromises();
    });

    expect(screen.getByText('Next Source Doc')).toBeInTheDocument();
  });

  it('exposes backlink action menu state and hides decorative menu icons from assistive tech', async () => {
    global.fetch = vi.fn(() => jsonResponse([backlink]));

    renderPanel();

    await act(flushPromises);

    const menuButton = screen.getByRole('button', { name: 'Actions for Source Doc' });
    expect(menuButton).toHaveAttribute('aria-haspopup', 'menu');
    expect(menuButton).toHaveAttribute('aria-expanded', 'false');
    expect(menuButton.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');

    fireEvent.click(menuButton);

    expect(menuButton).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('menu', { name: 'Context menu' })).toBeInTheDocument();
    for (const icon of screen.getByRole('menu').querySelectorAll('svg')) {
      expect(icon).toHaveAttribute('aria-hidden', 'true');
    }
  });
});
