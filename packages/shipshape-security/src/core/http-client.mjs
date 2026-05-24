export class ProbeHttpClient {
  constructor(baseUrl) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.cookies = new Map();
    this.csrfToken = null;
    this.lastLogin = null;
  }

  cookieHeader() {
    return [...this.cookies.entries()].map(([key, value]) => `${key}=${value}`).join('; ');
  }

  absorbSetCookie(headers) {
    const setCookie = headers.getSetCookie ? headers.getSetCookie() : [];
    for (const cookie of setCookie) {
      const [pair] = cookie.split(';');
      const eq = pair.indexOf('=');
      if (eq > 0) this.cookies.set(pair.slice(0, eq), pair.slice(eq + 1));
    }
    return setCookie;
  }

  async request(path, options = {}) {
    const headers = new Headers(options.headers || {});
    if (!headers.has('content-type') && options.body && !(options.body instanceof Uint8Array)) {
      headers.set('content-type', 'application/json');
    }
    if (!headers.has('cookie') && this.cookies.size > 0) headers.set('cookie', this.cookieHeader());
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers,
      body: options.body && !(options.body instanceof Uint8Array) && typeof options.body !== 'string'
        ? JSON.stringify(options.body)
        : options.body,
      redirect: 'manual',
    });
    const setCookie = this.absorbSetCookie(response.headers);
    const text = await response.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return { response, status: response.status, headers: response.headers, setCookie, text, json };
  }

  async csrf() {
    const result = await this.request('/api/csrf-token');
    this.csrfToken = result.json?.token || null;
    return this.csrfToken;
  }

  async login(email, password) {
    await this.csrf();
    const result = await this.request('/api/auth/login', {
      method: 'POST',
      headers: this.csrfToken ? { 'x-csrf-token': this.csrfToken } : {},
      body: { email, password },
    });
    this.lastLogin = result;
    return result;
  }

  async api(path, options = {}) {
    const headers = new Headers(options.headers || {});
    if (options.method && options.method !== 'GET' && this.csrfToken && !headers.has('x-csrf-token')) {
      headers.set('x-csrf-token', this.csrfToken);
    }
    return this.request(path, { ...options, headers });
  }
}

export function redactedHeaders(headers) {
  const out = {};
  for (const [key, value] of headers.entries()) {
    out[key] = key.toLowerCase() === 'set-cookie' || key.toLowerCase() === 'cookie' ? '[redacted]' : value;
  }
  return out;
}

