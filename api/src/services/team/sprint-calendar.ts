/**
 * Workspace sprint calendar helpers shared by team grid and accountability views.
 */

export const SPRINT_DURATION_DAYS = 7;

export type SprintPeriod = {
  number: number;
  name: string;
  startDate: string;
  endDate: string;
  isCurrent: boolean;
};

export function normalizeSprintStartDate(rawSprintStartDate: Date | string | null | undefined, today = new Date()): Date {
  if (rawSprintStartDate instanceof Date) {
    return new Date(Date.UTC(rawSprintStartDate.getFullYear(), rawSprintStartDate.getMonth(), rawSprintStartDate.getDate()));
  }
  if (typeof rawSprintStartDate === 'string') {
    return new Date(rawSprintStartDate + 'T00:00:00Z');
  }
  return new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()));
}

export function getCurrentSprintNumber(startDate: Date, today = new Date(), sprintDurationDays = SPRINT_DURATION_DAYS): number {
  const daysSinceStart = Math.floor((today.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
  return Math.max(1, Math.floor(daysSinceStart / sprintDurationDays) + 1);
}

export function buildSprintPeriods(input: {
  startDate: Date;
  fromSprint: number;
  toSprint: number;
  currentSprintNumber: number;
  sprintDurationDays?: number;
}): SprintPeriod[] {
  const { startDate, fromSprint, toSprint, currentSprintNumber, sprintDurationDays = SPRINT_DURATION_DAYS } = input;
  const sprints: SprintPeriod[] = [];
  for (let i = fromSprint; i <= toSprint; i++) {
    const sprintStart = new Date(startDate);
    sprintStart.setUTCDate(sprintStart.getUTCDate() + (i - 1) * sprintDurationDays);

    const sprintEnd = new Date(sprintStart);
    sprintEnd.setUTCDate(sprintEnd.getUTCDate() + sprintDurationDays - 1);

    sprints.push({
      number: i,
      name: `Week ${i}`,
      startDate: sprintStart.toISOString().slice(0, 10),
      endDate: sprintEnd.toISOString().slice(0, 10),
      isCurrent: i === currentSprintNumber,
    });
  }
  return sprints;
}

export function sprintNumberFromDate(
  date: Date | string,
  startDate: Date,
  sprintDurationDays = SPRINT_DURATION_DAYS
): number {
  const d = typeof date === 'string' ? new Date(date) : date;
  const daysSinceStart = Math.floor((d.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
  return Math.max(1, Math.floor(daysSinceStart / sprintDurationDays) + 1);
}

export function parseSprintRangeQuery(
  query: { fromSprint?: string; toSprint?: string },
  currentSprintNumber: number,
  defaults: { back: number; forward: number } = { back: 7, forward: 7 }
): { fromSprint: number; toSprint: number } {
  const fromSprint = query.fromSprint
    ? Math.max(1, parseInt(query.fromSprint, 10))
    : Math.max(1, currentSprintNumber - defaults.back);
  const toSprint = query.toSprint
    ? parseInt(query.toSprint, 10)
    : currentSprintNumber + defaults.forward;
  return { fromSprint, toSprint };
}

export type WorkspaceSprintCalendar = {
  startDate: Date;
  currentSprintNumber: number;
  sprints: SprintPeriod[];
};

export function buildWorkspaceSprintCalendar(
  rawSprintStartDate: Date | string | null | undefined,
  options: {
    query?: { fromSprint?: string; toSprint?: string };
    rangeDefaults?: { back: number; forward: number };
    trailingSprintCount?: number;
    today?: Date;
  } = {}
): WorkspaceSprintCalendar {
  const today = options.today ?? new Date();
  const startDate = normalizeSprintStartDate(rawSprintStartDate, today);
  const currentSprintNumber = getCurrentSprintNumber(startDate, today, SPRINT_DURATION_DAYS);

  const { fromSprint, toSprint } = options.trailingSprintCount !== undefined
    ? {
        fromSprint: Math.max(1, currentSprintNumber - (options.trailingSprintCount - 1)),
        toSprint: currentSprintNumber,
      }
    : parseSprintRangeQuery(options.query ?? {}, currentSprintNumber, options.rangeDefaults);

  const sprints = buildSprintPeriods({
    startDate,
    fromSprint,
    toSprint,
    currentSprintNumber,
    sprintDurationDays: SPRINT_DURATION_DAYS,
  });

  return { startDate, currentSprintNumber, sprints };
}
