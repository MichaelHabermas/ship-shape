import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { DevDatabaseBanner } from './DevDatabaseBanner';

const realFetch = global.fetch;

describe('DevDatabaseBanner', () => {
  beforeEach(() => {
    vi.stubEnv('DEV', true);
  });

  afterEach(() => {
    global.fetch = realFetch;
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('shows a banner when the database status endpoint reports disconnected', async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          connected: false,
          hint: 'PostgreSQL is not running.',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );

    render(<DevDatabaseBanner />);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Database unavailable');
      expect(screen.getByRole('alert')).toHaveTextContent('PostgreSQL is not running');
    });
  });

  it('stays hidden when the database is connected', async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ connected: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    render(<DevDatabaseBanner />);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalled();
    });

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
