const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Normalize a DB or JS date value to OpenAPI DateSchema wire format (YYYY-MM-DD).
 */
export function formatWireDate(value: Date | string | null | undefined): string | null {
  if (value == null) {
    return null;
  }

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      return null;
    }
    // pg DATE columns arrive as local-midnight Date objects — use local calendar parts.
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  if (typeof value === 'string') {
    if (DATE_ONLY_PATTERN.test(value)) {
      return value;
    }
    if (value.includes('T')) {
      const datePart = value.split('T')[0] ?? '';
      return DATE_ONLY_PATTERN.test(datePart) ? datePart : null;
    }
    if (value.includes(' ')) {
      const datePart = value.split(' ')[0] ?? '';
      return DATE_ONLY_PATTERN.test(datePart) ? datePart : null;
    }
    return null;
  }

  return null;
}

/**
 * Like formatWireDate but throws when the input cannot produce a date string.
 */
export function formatWireDateRequired(value: Date | string): string {
  const formatted = formatWireDate(value);
  if (formatted == null) {
    throw new Error('Expected a date value');
  }
  return formatted;
}
