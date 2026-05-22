import { readJson } from '@/api/read-json';

const API_URL = import.meta.env.VITE_API_URL ?? '';

/** Unauthenticated fetch helper for login/setup flows (no session redirect). */
export async function publicFetchJson<T>(endpoint: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${endpoint}`, {
    credentials: 'include',
    ...init,
  });
  return readJson<T>(res);
}
