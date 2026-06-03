// Team Mode types derive allocation wire contracts and keep local grouping state.
import type {
  TeamAssignment,
  TeamAssignmentError,
  TeamAssignResponse,
  TeamGridResponse,
  TeamUnassignResponse,
} from '@/api/schemas';

export type User = TeamGridResponse['users'][number];
export type Sprint = TeamGridResponse['weeks'][number];
export type Assignment = TeamAssignment;
export type TeamGridData = TeamGridResponse;
export type AssignmentResponse = (TeamAssignResponse | TeamUnassignResponse | TeamAssignmentError) & {
  error?: TeamAssignmentError['error'];
  issuesOrphaned?: TeamAssignmentError['issuesOrphaned'];
};

// Program group info for grouping users
export interface ProgramGroup {
  programId: string | null;
  programName: string;
  emoji: string | null;
  color: string | null;
  users: User[];
}
