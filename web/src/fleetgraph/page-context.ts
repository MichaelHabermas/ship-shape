// Builds bounded FleetGraph page context capsules and stable fingerprints for registration.
import type { FleetGraphPageContext, FleetGraphPageContextItem } from '@ship/shared';

type RouteLocation = {
  pathname: string;
  search: string;
  hash: string;
};

export function routeFromLocation(location: RouteLocation): string {
  return `${location.pathname}${location.search}${location.hash}`;
}

export function buildIssuesListPageContext(input: {
  location: RouteLocation;
  scoped: boolean;
  stateFilter: string | null;
  programFilter: string | null;
  projectFilter: string | null;
  sprintFilter: string | null;
  effectiveProgramId: string | null | undefined;
  effectiveProjectId: string | null | undefined;
  showAllIssues: boolean;
  sortBy: string;
  viewMode: string;
  totalCount: number;
  filteredCount: number;
  selectedCount: number;
  visibleIssues: Array<{
    id: string;
    title: string | null;
    state: string;
    priority: string;
    assignee_name?: string | null;
  }>;
  selectedIds: Iterable<string>;
}): FleetGraphPageContext {
  return {
    route: routeFromLocation(input.location),
    surface: input.scoped ? 'scoped_issues_list' : 'issues_list',
    title: input.scoped ? 'Scoped issues' : 'Issues',
    filters: {
      state: input.stateFilter || null,
      programId: input.programFilter || input.effectiveProgramId || null,
      projectId: input.projectFilter || input.effectiveProjectId || null,
      sprintId: input.sprintFilter || null,
      showAllIssues: input.showAllIssues,
    },
    sort: input.sortBy,
    viewMode: input.viewMode,
    counts: {
      total: input.totalCount,
      filtered: input.filteredCount,
      selected: input.selectedCount,
    },
    visibleItems: input.visibleIssues.slice(0, 25).map((issue) => ({
      kind: 'issue',
      id: issue.id,
      title: issue.title || 'Untitled',
      state: issue.state,
      priority: issue.priority,
      owner: issue.assignee_name ?? undefined,
    })),
    selectedItemIds: [...input.selectedIds].slice(0, 8),
  };
}

type MyWeekData = {
  week: { week_number: number; is_current: boolean };
  projects: Array<{ id: string; title: string; program_name: string | null }>;
  plan: { id: string; submitted_at: string | null } | null;
  retro: { id: string; submitted_at: string | null } | null;
  standups: Array<{ date: string; standup: { id: string } | null }>;
};

export function buildMyWeekPageContext(input: {
  location: RouteLocation;
  data: MyWeekData;
}): FleetGraphPageContext {
  const visibleItems: FleetGraphPageContextItem[] = [
    ...input.data.projects.slice(0, 10).map((project) => ({
      kind: 'project' as const,
      id: project.id,
      title: project.title,
      summary: project.program_name ?? undefined,
    })),
    ...(input.data.plan?.id ? [{
      kind: 'document' as const,
      id: input.data.plan.id,
      title: `Week ${input.data.week.week_number} plan`,
      state: input.data.plan.submitted_at ? 'submitted' : 'open',
    }] : []),
    ...(input.data.retro?.id ? [{
      kind: 'document' as const,
      id: input.data.retro.id,
      title: `Week ${input.data.week.week_number} retro`,
      state: input.data.retro.submitted_at ? 'submitted' : 'open',
    }] : []),
    ...input.data.standups.slice(0, 10).map((slot) => ({
      kind: 'document' as const,
      id: slot.standup?.id,
      title: `Standup ${slot.date}`,
      state: slot.standup ? 'present' : 'missing',
    })),
  ].slice(0, 25);

  return {
    route: routeFromLocation(input.location),
    surface: 'my_week',
    title: `My Week ${input.data.week.week_number}`,
    filters: { weekNumber: input.data.week.week_number, current: input.data.week.is_current },
    counts: {
      projects: input.data.projects.length,
      standups: input.data.standups.length,
      visible: visibleItems.length,
    },
    visibleItems,
  };
}

export function fingerprintPageContext(context: FleetGraphPageContext | null): string {
  if (!context) return '';
  return JSON.stringify({
    route: context.route,
    surface: context.surface,
    title: context.title,
    filters: context.filters ?? null,
    sort: context.sort ?? null,
    viewMode: context.viewMode ?? null,
    counts: context.counts ?? null,
    visibleItems: context.visibleItems.map((item) => ({
      kind: item.kind,
      id: item.id ?? null,
      title: item.title,
      state: item.state ?? null,
      priority: item.priority ?? null,
      owner: item.owner ?? null,
    })),
    selectedItemIds: context.selectedItemIds ?? [],
  });
}
