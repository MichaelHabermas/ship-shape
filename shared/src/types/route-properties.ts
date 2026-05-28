// API route / repository extensions to document properties (not full domain documents).

import type { ProjectProperties, WeekProperties } from './document.js';

export type CanonicalWeekProperties = Partial<Pick<WeekProperties, 'sprint_number' | 'owner_id'>> & {
  owner_id?: string | null;
};

/** Sprint JSON stored on week documents and returned by week/project routes. */
export type SprintRouteProperties = CanonicalWeekProperties &
  Partial<
    Pick<
      WeekProperties,
      | 'status'
      | 'plan'
      | 'success_criteria'
      | 'confidence'
      | 'plan_history'
      | 'plan_approval'
      | 'review_approval'
      | 'review_rating'
    >
  > & {
    assignee_ids?: string[] | null;
    is_complete?: boolean | null;
    missing_fields?: string[];
    planned_issue_ids?: string[] | null;
    snapshot_taken_at?: string | null;
    accountable_id?: string | null;
  };

/** Subset of sprint route properties used in project week listings. */
export type ProjectSprintProperties = CanonicalWeekProperties &
  Partial<Pick<WeekProperties, 'status' | 'plan' | 'success_criteria' | 'confidence'>>;

/** Project JSON extensions on route responses (completeness, bootstrap). */
export type ProjectRouteProperties = Partial<ProjectProperties> & {
  is_complete?: boolean | null;
  missing_fields?: string[];
  plan?: string | null;
  has_retro?: boolean;
  target_date?: string | null;
};
