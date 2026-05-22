import { useQuery } from '@tanstack/react-query';
import { apiGetJson } from '@/lib/api';

export interface TeamMember {
  id: string;
  user_id: string | null;
  name: string;
  email?: string;
  isPending?: boolean;
  isArchived?: boolean;
}

// Query keys
export const teamMemberKeys = {
  all: ['teamMembers'] as const,
  lists: () => [...teamMemberKeys.all, 'list'] as const,
};

// Fetch team members (includes pending users with isPending flag)
async function fetchTeamMembers(): Promise<TeamMember[]> {
  return apiGetJson<TeamMember[]>('/api/team/people', 'Failed to fetch team members');
}

// Hook to get team members with TanStack Query (supports offline via cache)
export function useTeamMembersQuery() {
  return useQuery({
    queryKey: teamMemberKeys.lists(),
    queryFn: fetchTeamMembers,
    staleTime: 1000 * 60 * 5, // 5 minutes
  });
}

// Assignable member type (guaranteed to have user_id)
export interface AssignableMember {
  id: string;
  user_id: string;
  name: string;
  email?: string;
}

// Hook to get only assignable members (filters out pending users who can't be assigned)
export function useAssignableMembersQuery() {
  const query = useTeamMembersQuery();
  return {
    ...query,
    data: query.data?.filter((m): m is TeamMember & { user_id: string } =>
      !m.isPending && m.user_id !== null
    ),
  };
}
