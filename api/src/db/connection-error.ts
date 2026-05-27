/** True when the driver could not open a TCP connection to PostgreSQL. */
export function isDatabaseUnreachableError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const err = error as { code?: string; errors?: Array<{ code?: string }> };
  if (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND' || err.code === 'ETIMEDOUT') {
    return true;
  }

  if (Array.isArray(err.errors)) {
    return err.errors.some(
      (nested) =>
        nested?.code === 'ECONNREFUSED' || nested?.code === 'ENOTFOUND' || nested?.code === 'ETIMEDOUT'
    );
  }

  return false;
}
