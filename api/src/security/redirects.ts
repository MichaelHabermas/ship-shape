const SAFE_RETURN_TO_PREFIXES = [
  '/',
];

function decodeRepeated(value: string): string | null {
  let current = value;
  for (let i = 0; i < 3; i += 1) {
    try {
      const decoded = decodeURIComponent(current);
      if (decoded === current) return decoded;
      current = decoded;
    } catch {
      return null;
    }
  }
  return current;
}

export function safeRelativeReturnTo(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  if (value.length > 2048 || /[\u0000-\u001f\u007f]/.test(value)) return null;

  const decoded = decodeRepeated(value);
  if (!decoded) return null;
  if (!SAFE_RETURN_TO_PREFIXES.some(prefix => decoded.startsWith(prefix))) return null;
  if (!decoded.startsWith('/') || decoded.startsWith('//')) return null;
  if (decoded.includes('\\')) return null;
  if (/^\/\s*https?:/i.test(decoded)) return null;
  if (/^https?:/i.test(decoded)) return null;

  return decoded;
}
