const API_URL = import.meta.env.VITE_API_URL ?? '';

let quietCsrfToken: string | null = null;

export async function getQuietCsrfToken(): Promise<string | null> {
  if (quietCsrfToken) return quietCsrfToken;
  try {
    const res = await fetch(`${API_URL}/api/csrf-token`, { credentials: 'include' });
    if (!res.ok) return null;
    const data = await res.json();
    quietCsrfToken = data.token;
    return quietCsrfToken;
  } catch {
    return null;
  }
}

export function clearQuietCsrfToken(): void {
  quietCsrfToken = null;
}

export function resetQuietCsrfTokenForTests(): void {
  clearQuietCsrfToken();
}

export async function quietGet(endpoint: string): Promise<Response> {
  return fetch(`${API_URL}${endpoint}`, { credentials: 'include' });
}

export async function quietPost(endpoint: string, body: object): Promise<Response> {
  const token = await getQuietCsrfToken();
  return fetch(`${API_URL}${endpoint}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { 'X-CSRF-Token': token } : {}),
    },
    credentials: 'include',
    body: JSON.stringify(body),
  });
}

export async function quietPatch(endpoint: string, body: object): Promise<Response> {
  const token = await getQuietCsrfToken();
  return fetch(`${API_URL}${endpoint}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { 'X-CSRF-Token': token } : {}),
    },
    credentials: 'include',
    body: JSON.stringify(body),
  });
}
