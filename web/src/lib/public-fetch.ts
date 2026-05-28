import { readJson } from '@/api/read-json';

const API_URL = import.meta.env.VITE_API_URL ?? '';
const PUBLIC_API_TIMEOUT_MS = 15_000;

/** Unauthenticated fetch helper for login/setup flows (no session redirect). */
export async function publicFetchJson<T>(endpoint: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), PUBLIC_API_TIMEOUT_MS);
  try {
    const res = await fetch(`${API_URL}${endpoint}`, {
      credentials: 'include',
      ...init,
      signal: controller.signal,
    });
    return readJson<T>(res);
  } finally {
    window.clearTimeout(timeout);
  }
}
