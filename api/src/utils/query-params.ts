type QueryIntegerOptions = {
  defaultValue: number;
  min?: number;
  max?: number;
};

export function getQueryString(value: unknown, fallback = ''): string {
  if (Array.isArray(value)) {
    const firstValue = (value as readonly unknown[])[0];
    return typeof firstValue === 'string' ? firstValue : fallback;
  }

  return typeof value === 'string' ? value : fallback;
}

export function getOptionalQueryString(value: unknown): string | undefined {
  const queryValue = getQueryString(value);
  return queryValue === '' ? undefined : queryValue;
}

export function getTrimmedQueryString(value: unknown, fallback = ''): string {
  return getQueryString(value, fallback).trim();
}

export function getClampedIntegerQuery(value: unknown, options: QueryIntegerOptions): number {
  const parsedValue = parseInt(getQueryString(value), 10);
  const valueOrDefault = parsedValue || options.defaultValue;
  const minBounded = options.min === undefined ? valueOrDefault : Math.max(valueOrDefault, options.min);
  return options.max === undefined ? minBounded : Math.min(minBounded, options.max);
}
