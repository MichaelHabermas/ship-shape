// FleetGraph reviewer formatters shorten IDs, dates, and durations for the control room.
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO_TIMESTAMP_PATTERN = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z/g;
const compactDateFormatter = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

export function formatMs(value: number | null | undefined): string {
  if (value === null || value === undefined) return 'missing';
  if (value < 1000) return `${value} ms`;
  const seconds = value / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)} s`;
  return `${(seconds / 60).toFixed(1)} m`;
}

export function shortUuid(value: string): string {
  return UUID_PATTERN.test(value) ? `${value.slice(0, 4)}...${value.slice(-4)}` : value;
}

export function shortTraceUrl(value: string): string {
  try {
    const url = new URL(value);
    const traceId = url.pathname.split('/').filter(Boolean).at(-1);
    return traceId ? `trace ${shortId(traceId)}` : url.hostname;
  } catch {
    return value.length > 18 ? `${value.slice(0, 7)}...${value.slice(-7)}` : value;
  }
}

function shortId(value: string): string {
  return UUID_PATTERN.test(value) ? shortUuid(value) : `${value.slice(0, 4)}...${value.slice(-4)}`;
}

export function formatCompactDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return compactDateFormatter.format(date);
}

export function formatDateText(value: string): string {
  return value.replace(ISO_TIMESTAMP_PATTERN, (match) => formatCompactDate(match));
}

export function toneText(tone: string): string {
  if (tone === 'complete' || tone === 'pass') return 'text-emerald-200';
  if (tone === 'failed' || tone === 'fail') return 'text-rose-200';
  if (tone === 'broken' || tone === 'risk') return 'text-amber-200';
  if (tone === 'in_progress' || tone === 'blocked') return 'text-sky-200';
  return 'text-white';
}
