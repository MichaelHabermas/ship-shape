export interface User {
  personId: string; // Document ID - used for allocations (works for both pending and active)
  id: string | null; // User account ID - null for pending users
  name: string;
  email: string;
  isArchived?: boolean;
  isPending?: boolean;
  reportsTo?: string | null; // user_id of supervisor
}

export interface Sprint {
  number: number;
  name: string;
  startDate: string;
  endDate: string;
  isCurrent: boolean;
}

export interface Assignment {
  projectId: string | null;
  projectName: string | null;
  projectColor: string | null;
  programId: string | null;
  programName: string | null;
  emoji?: string | null;
  color: string | null;
}

export interface TeamGridData {
  users: User[];
  weeks: Sprint[];
  currentSprintNumber: number;
}

export interface AssignmentResponse {
  error?: string;
  issuesOrphaned?: Array<{ id: string; title: string }>;
}

// Program group info for grouping users
export interface ProgramGroup {
  programId: string | null;
  programName: string;
  emoji: string | null;
  color: string | null;
  users: User[];
}
