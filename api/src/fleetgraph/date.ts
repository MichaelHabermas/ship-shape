// FleetGraph date helpers parse strict UTC calendar dates for detector inputs.
export function parseUtcCalendarDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.toISOString().slice(0, 10) === value ? date : null;
}

export function isUtcCalendarDate(value: string): boolean {
  return parseUtcCalendarDate(value) !== null;
}
