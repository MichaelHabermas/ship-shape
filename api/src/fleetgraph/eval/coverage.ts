// FleetGraph coverage matrix names required eval branches for MVP graph work.
import { fleetGraphGoldenCases } from './golden-cases.js';
import type { FleetGraphScenarioLabel } from './types.js';

export type FleetGraphCoverageRequirement = {
  id: string;
  description: string;
  requiredLabels: readonly FleetGraphScenarioLabel[];
  minimumCases: number;
};

export const fleetGraphCoverageRequirements = [
  {
    id: 'proactive-create',
    description: 'Proactive detector candidate becomes an action-ready finding.',
    requiredLabels: ['mode:proactive', 'branch:create'],
    minimumCases: 1,
  },
  {
    id: 'proactive-update',
    description: 'Duplicate candidate updates or suppresses an existing finding.',
    requiredLabels: ['mode:proactive', 'branch:update'],
    minimumCases: 1,
  },
  {
    id: 'quiet-exits',
    description: 'Negative detector and no-safe-output paths exit without model claims.',
    requiredLabels: ['branch:quiet'],
    minimumCases: 5,
  },
  {
    id: 'on-demand-explain',
    description: 'Contextual request explains an existing finding from visible evidence.',
    requiredLabels: ['mode:on_demand', 'branch:explain'],
    minimumCases: 1,
  },
  {
    id: 'draft-refine',
    description: 'Draft refinement updates FleetGraph draft state only.',
    requiredLabels: ['mode:on_demand', 'branch:refine'],
    minimumCases: 1,
  },
  {
    id: 'change-summary',
    description: 'Change summary compares against a real FleetGraph run anchor and returns only useful deltas.',
    requiredLabels: ['mode:on_demand', 'branch:summarize_changes'],
    minimumCases: 4,
  },
  {
    id: 'human-gate',
    description: 'Action preparation stops at a human confirmation boundary.',
    requiredLabels: ['action:human_gate'],
    minimumCases: 2,
  },
  {
    id: 'restricted-evidence',
    description: 'Restricted evidence never leaks hidden source details.',
    requiredLabels: ['evidence:restricted', 'permission:restricted'],
    minimumCases: 3,
  },
  {
    id: 'resolve-condition-gone',
    description: 'Existing findings resolve when the source condition disappears.',
    requiredLabels: ['mode:proactive', 'branch:resolve'],
    minimumCases: 1,
  },
  {
    id: 'dismiss-finding',
    description: 'Human dismiss changes only FleetGraph finding status and does not accept risk.',
    requiredLabels: ['mode:on_demand', 'branch:dismiss'],
    minimumCases: 1,
  },
  {
    id: 'error-path',
    description: 'Fetch or reasoning failures record errors without stale claims.',
    requiredLabels: ['branch:error'],
    minimumCases: 1,
  },
] as const satisfies readonly FleetGraphCoverageRequirement[];

export function casesForRequirement(requirement: FleetGraphCoverageRequirement) {
  return fleetGraphGoldenCases.filter((testCase) =>
    requirement.requiredLabels.every((label) => testCase.labels.some((caseLabel) => caseLabel === label))
  );
}

export const fleetGraphCoverageMatrix = fleetGraphCoverageRequirements.map((requirement) => ({
  ...requirement,
  caseIds: casesForRequirement(requirement).map((testCase) => testCase.id),
}));
