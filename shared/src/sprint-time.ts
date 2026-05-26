// Shared UTC week-window helpers for workspace sprint/week calculations.
const MS_PER_DAY = 1000 * 60 * 60 * 24;

/** Normalize workspace.sprint_start_date to UTC midnight. */
export function normalizeWorkspaceStartDate(raw: unknown): Date {
  if (raw instanceof Date) {
    return new Date(Date.UTC(raw.getFullYear(), raw.getMonth(), raw.getDate()));
  }
  if (typeof raw === 'string') {
    return new Date(`${raw}T00:00:00Z`);
  }
  return new Date();
}

/** Today at UTC midnight. */
export function utcToday(): Date {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  return today;
}

/** 1-based sprint number from workspace start date. */
export function computeCurrentSprintNumber(
  workspaceStartDate: Date,
  sprintDurationDays = 7,
  today = utcToday()
): number {
  const daysSinceStart = Math.floor(
    (today.getTime() - workspaceStartDate.getTime()) / MS_PER_DAY
  );
  return Math.floor(daysSinceStart / sprintDurationDays) + 1;
}

/** YYYY-MM-DD for standup date keys. */
export function formatUtcDateIso(date: Date): string {
  return date.toISOString().slice(0, 10);
}
