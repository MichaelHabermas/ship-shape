import { useEffect, useState } from 'react';
import { readJson } from '@/api/read-json';

const API_URL = import.meta.env.VITE_API_URL ?? '';

type DatabaseStatusResponse = {
  connected: boolean;
  unreachable?: boolean;
  hint?: string;
};

const RECHECK_MS = 15_000;

/**
 * Persistent dev-only banner when the API cannot reach PostgreSQL.
 * Hidden in production builds and when the database is healthy.
 */
export function DevDatabaseBanner() {
  const [hint, setHint] = useState<string | null>(null);

  useEffect(() => {
    if (!import.meta.env.DEV) {
      return;
    }

    let cancelled = false;

    async function checkDatabase() {
      try {
        const res = await fetch(`${API_URL}/api/dev/database-status`, {
          credentials: 'include',
        });
        const data = await readJson<DatabaseStatusResponse>(res);
        if (cancelled) {
          return;
        }
        if (data.connected) {
          setHint(null);
          return;
        }
        setHint(
          data.hint ??
            'Cannot reach the database. Start PostgreSQL or run pnpm docker:up, then refresh.'
        );
      } catch {
        if (!cancelled) {
          setHint('Cannot reach the API or database. Is pnpm dev running with PostgreSQL up?');
        }
      }
    }

    void checkDatabase();
    const intervalId = window.setInterval(() => {
      void checkDatabase();
    }, RECHECK_MS);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, []);

  if (!import.meta.env.DEV || !hint) {
    return null;
  }

  return (
    <div
      role="alert"
      className="fixed inset-x-0 top-0 z-[100] border-b border-amber-700/40 bg-amber-500 px-4 py-2 text-center text-sm text-black shadow-md"
    >
      <strong className="font-semibold">Database unavailable.</strong> {hint}
    </div>
  );
}
