import { useQuery } from '@tanstack/react-query';
import { apiClient, assertApiData } from '@/api/client';
import type { components } from '@/api/generated/ship-openapi';

export interface TeamMember {
  id: string;
  user_id: string | null;
  name: string;
  email?: string;
  isPending?: boolean;
  isArchived?: boolean;
}

export const teamMemberKeys = {
  all: ['teamMembers'] as const,
  lists: () => [...teamMemberKeys.all, 'list'] as const,
};

function mapPersonToTeamMember(person: components['schemas']['Person']): TeamMember {
  return {
    id: person.personId,
    user_id: person.id,
    name: person.name,
    email: person.email ?? undefined,
    isPending: person.isPending,
    isArchived: person.isArchived,
  };
}

async function fetchTeamMembers(): Promise<TeamMember[]> {
  const response = await apiClient.GET('/team/people');
  const people = assertApiData(response, 'Failed to fetch team members');
  return people.map(mapPersonToTeamMember);
}

export function useTeamMembersQuery() {
  return useQuery({
    queryKey: teamMemberKeys.lists(),
    queryFn: fetchTeamMembers,
    staleTime: 1000 * 60 * 5,
  });
}

export interface AssignableMember {
  id: string;
  user_id: string;
  name: string;
  email?: string;
}

export function useAssignableMembersQuery() {
  const query = useTeamMembersQuery();
  return {
    ...query,
    data: query.data?.filter((member): member is TeamMember & { user_id: string } =>
      !member.isPending && member.user_id !== null
    ),
  };
}
