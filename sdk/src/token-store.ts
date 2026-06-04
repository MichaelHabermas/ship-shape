// SDK token stores persist OAuth token sets in memory, browser storage, or local files.
import { ShipError } from './errors.js';

export type ShipTokenSet = {
  accessToken: string;
  refreshToken?: string;
  tokenType?: string;
  expiresAt?: number;
  scope?: string;
  clientId?: string;
  userId?: string;
  workspaceId?: string;
};

export interface ITokenStore {
  get(): ShipTokenSet | null | Promise<ShipTokenSet | null>;
  set(tokens: ShipTokenSet): void | Promise<void>;
  clear(): void | Promise<void>;
}

export class MemoryTokenStore implements ITokenStore {
  private tokens: ShipTokenSet | null;

  constructor(initialTokens: ShipTokenSet | null = null) {
    this.tokens = initialTokens;
  }

  get(): ShipTokenSet | null {
    return this.tokens;
  }

  set(tokens: ShipTokenSet): void {
    this.tokens = tokens;
  }

  clear(): void {
    this.tokens = null;
  }
}

export class BrowserTokenStore implements ITokenStore {
  constructor(private readonly key = 'ship.tokens') {}

  get(): ShipTokenSet | null {
    const storage = browserStorage();
    const raw = storage?.getItem(this.key);
    if (!raw) return null;
    return parseTokenSet(raw);
  }

  set(tokens: ShipTokenSet): void {
    const storage = browserStorage();
    if (!storage) throw new ShipError({ kind: 'auth', message: 'localStorage is unavailable' });
    storage.setItem(this.key, JSON.stringify(tokens));
  }

  clear(): void {
    browserStorage()?.removeItem(this.key);
  }
}

export class FileTokenStore implements ITokenStore {
  constructor(private readonly path: string) {}

  async get(): Promise<ShipTokenSet | null> {
    try {
      const fs = await import('node:fs/promises');
      return parseTokenSet(await fs.readFile(this.path, 'utf8'));
    } catch (error) {
      if (isNodeFileNotFound(error)) return null;
      throw error;
    }
  }

  async set(tokens: ShipTokenSet): Promise<void> {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    await fs.mkdir(path.dirname(this.path), { recursive: true, mode: 0o700 });
    await fs.writeFile(this.path, `${JSON.stringify(tokens, null, 2)}\n`, { mode: 0o600 });
  }

  async clear(): Promise<void> {
    try {
      const fs = await import('node:fs/promises');
      await fs.unlink(this.path);
    } catch (error) {
      if (!isNodeFileNotFound(error)) throw error;
    }
  }
}

function parseTokenSet(raw: string): ShipTokenSet | null {
  try {
    const parsed = JSON.parse(raw) as Partial<ShipTokenSet>;
    if (typeof parsed.accessToken !== 'string' || parsed.accessToken.length === 0) return null;
    return {
      accessToken: parsed.accessToken,
      refreshToken: typeof parsed.refreshToken === 'string' ? parsed.refreshToken : undefined,
      tokenType: typeof parsed.tokenType === 'string' ? parsed.tokenType : undefined,
      expiresAt: typeof parsed.expiresAt === 'number' ? parsed.expiresAt : undefined,
      scope: typeof parsed.scope === 'string' ? parsed.scope : undefined,
      clientId: typeof parsed.clientId === 'string' ? parsed.clientId : undefined,
      userId: typeof parsed.userId === 'string' ? parsed.userId : undefined,
      workspaceId: typeof parsed.workspaceId === 'string' ? parsed.workspaceId : undefined,
    };
  } catch {
    return null;
  }
}

function browserStorage(): {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
} | null {
  const candidate = (globalThis as unknown as { localStorage?: unknown }).localStorage;
  if (!candidate || typeof candidate !== 'object') return null;
  return candidate as ReturnType<typeof browserStorage>;
}

function isNodeFileNotFound(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT');
}
