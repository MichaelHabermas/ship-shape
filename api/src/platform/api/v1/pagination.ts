// Cursor helpers keep public list pagination opaque and stable across resources.
export type PublicCursorPayload = {
  id: string;
  timestamp: string;
};

export type PublicListResponse<T> = {
  data: T[];
  next_cursor: string | null;
};

export function encodePublicCursor(payload: PublicCursorPayload): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

export function decodePublicCursor(cursor: string): PublicCursorPayload | null {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as unknown;
    if (!parsed || typeof parsed !== 'object') return null;
    const candidate = parsed as Partial<PublicCursorPayload>;
    if (typeof candidate.id !== 'string' || typeof candidate.timestamp !== 'string') return null;
    if (Number.isNaN(Date.parse(candidate.timestamp))) return null;
    return { id: candidate.id, timestamp: candidate.timestamp };
  } catch {
    return null;
  }
}

export function publicListLimitFromQuery(limit: number | undefined): number {
  return limit ?? 25;
}
