// Selects the smallest useful Ship audience for FleetGraph attention recommendations.
import type { FleetGraphInput } from '../types.js';

export type FleetGraphAudience = {
  role: 'issue_assignee' | 'project_owner' | 'sprint_owner' | 'program_owner' | 'unassigned';
  userId: string | null;
  displayName?: string;
  rationale: string;
};

type DetectorCandidate = Extract<FleetGraphInput['trigger'], { type: 'detector_decision' }>['detectorDecision']['candidate'];

export function nextActionForCandidate(
  candidate: DetectorCandidate,
  audience: FleetGraphAudience
): string {
  const recipient = audience.displayName ?? audienceLabel(audience.role);
  if (candidate.signalType === 'stale') return `Ask ${recipient} to post a fresh status or close the work if it is no longer active.`;
  if (candidate.signalType === 'at_risk') return `Ask ${recipient} to confirm scope, owner, and whether this can still land this week.`;
  if (!candidate.blocker_text.trim()) return `Ask ${recipient} to add the blocker reason.`;
  const context = candidate.sprint_number ? `Week ${candidate.sprint_number}` : candidate.sprint_title;
  return `Ask ${recipient} to confirm owner and next step for ${context}.`;
}

export function audienceForCandidate(candidate: DetectorCandidate): FleetGraphAudience {
  if (candidate.signalType === 'stale' || candidate.signalType === 'at_risk') {
    return firstAudience([
      audience('issue_assignee', candidate.issue_assignee_id, candidate.issue_assignee_name, 'The issue assignee is closest to the current work.'),
      audience('project_owner', candidate.project_owner_id, candidate.project_owner_name, 'The project owner is the next useful attention audience.'),
      audience('sprint_owner', candidate.sprint_owner_id, candidate.sprint_owner_name, 'The week owner is the fallback attention audience.'),
      audience('program_owner', candidate.program_owner_id, candidate.program_owner_name, 'The program owner is the final connected fallback.'),
    ]);
  }

  if (!candidate.blocker_text.trim()) {
    return firstAudience([
      audience('project_owner', candidate.project_owner_id, candidate.project_owner_name, 'Missing blocker reason belongs with the project owner first.'),
      audience('sprint_owner', candidate.sprint_owner_id, candidate.sprint_owner_name, 'Missing blocker reason falls back to the week owner.'),
      audience('issue_assignee', candidate.issue_assignee_id, candidate.issue_assignee_name, 'Missing blocker reason falls back to the issue assignee.'),
      audience('program_owner', candidate.program_owner_id, candidate.program_owner_name, 'Missing blocker reason falls back to the program owner.'),
    ]);
  }

  return firstAudience([
    audience('issue_assignee', candidate.issue_assignee_id, candidate.issue_assignee_name, 'The issue assignee is closest to the execution blocker.'),
    audience('project_owner', candidate.project_owner_id, candidate.project_owner_name, 'The project owner is the next useful unblock audience.'),
    audience('sprint_owner', candidate.sprint_owner_id, candidate.sprint_owner_name, 'The week owner is the fallback unblock audience.'),
    audience('program_owner', candidate.program_owner_id, candidate.program_owner_name, 'The program owner is the final connected fallback.'),
  ]);
}

function audience(
  role: FleetGraphAudience['role'],
  userId: string | null | undefined,
  displayName: string | null | undefined,
  rationale: string
): FleetGraphAudience | null {
  if (!userId && !displayName) return null;
  return {
    role,
    userId: userId ?? null,
    ...(displayName?.trim() ? { displayName: displayName.trim() } : {}),
    rationale,
  };
}

function firstAudience(audiences: Array<FleetGraphAudience | null>): FleetGraphAudience {
  return audiences.find((item): item is FleetGraphAudience => item !== null) ?? {
    role: 'unassigned',
    userId: null,
    displayName: undefined,
    rationale: 'No issue, project, week, or program owner was found in Ship context.',
  };
}

function audienceLabel(role: FleetGraphAudience['role']): string {
  switch (role) {
    case 'issue_assignee':
      return 'the issue assignee';
    case 'project_owner':
      return 'the project owner';
    case 'sprint_owner':
      return 'the week owner';
    case 'program_owner':
      return 'the program owner';
    case 'unassigned':
      return 'an owner';
  }
}
