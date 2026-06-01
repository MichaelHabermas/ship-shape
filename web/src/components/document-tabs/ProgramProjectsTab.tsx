import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, readJson } from '@/lib/api';
import type { DocumentTabProps } from '@/lib/document-tabs';
import { useCreateProject } from '@/hooks/useProjectsQuery';
import { useToast } from '@/components/ui/Toast';

interface ProgramProject {
  id: string;
  title: string;
  color: string;
  emoji: string | null;
  ice_score: number;
  sprint_count: number;
  issue_count: number;
  owner: { id: string; name: string; email: string } | null;
}

/**
 * ProgramProjectsTab - Shows projects associated with a program
 *
 * This is the "Projects" tab content when viewing a program document.
 */
export default function ProgramProjectsTab({ documentId }: DocumentTabProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const createProjectMutation = useCreateProject();
  const { showToast } = useToast();

  const { data: projects = [], isLoading } = useQuery<ProgramProject[]>({
    queryKey: ['program-projects', documentId],
    queryFn: async () => {
      const response = await apiGet(`/api/programs/${documentId}/projects`);
      if (!response.ok) {
        throw new Error('Failed to fetch projects');
      }
      return readJson<ProgramProject[]>(response);
    },
  });

  const handleCreateProject = async () => {
    try {
      const project = await createProjectMutation.mutateAsync({
        program_id: documentId,
      });
      // Invalidate the program-projects query to refresh the list
      queryClient.invalidateQueries({ queryKey: ['program-projects', documentId] });
      showToast('Project created', 'success');
      // Navigate to the new project
      navigate(`/documents/${project.id}`);
    } catch {
      showToast('Failed to create project', 'error');
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-48">
        <div className="flex items-center gap-2 text-muted">
          <svg className="w-5 h-5 animate-spin" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
          Loading projects...
        </div>
      </div>
    );
  }

  if (projects.length === 0) {
    return (
      <div className="h-full overflow-auto p-4">
        <div className="flex justify-end mb-4">
          <button
            onClick={handleCreateProject}
            disabled={createProjectMutation.isPending}
            className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent/90 transition-colors disabled:opacity-50"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            {createProjectMutation.isPending ? 'Creating...' : 'New Project'}
          </button>
        </div>
        <div className="flex flex-col items-center justify-center h-48 text-muted">
          <svg className="w-12 h-12 mb-3 opacity-50" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
          </svg>
          <p className="text-sm font-medium">No projects in this program</p>
          <p className="text-xs mt-1">Create a project to get started</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto p-4 pb-20">
      <div className="flex justify-end mb-4">
        <button
          onClick={handleCreateProject}
          disabled={createProjectMutation.isPending}
          className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent/90 transition-colors disabled:opacity-50"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          {createProjectMutation.isPending ? 'Creating...' : 'New Project'}
        </button>
      </div>
      <div className="space-y-2">
        {projects.map((project) => (
          <div
            key={project.id}
            onClick={() => navigate(`/documents/${project.id}`)}
            className="flex items-center gap-4 p-3 rounded-lg border border-border hover:bg-accent/5 cursor-pointer transition-colors"
          >
            {/* Project color indicator */}
            <div
              className="flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center text-lg"
              style={{ backgroundColor: project.color + '20' }}
            >
              {project.emoji || (
                <span style={{ color: project.color }} className="text-sm font-bold">
                  {project.title.charAt(0).toUpperCase()}
                </span>
              )}
            </div>

            {/* Project info */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-medium text-foreground truncate">
                  {project.title}
                </h3>
                <span className="inline-flex px-2 py-0.5 text-xs font-medium rounded bg-accent/20 text-accent">
                  ICE: {project.ice_score}
                </span>
              </div>
              <div className="flex items-center gap-3 mt-1 text-xs text-muted">
                {project.owner && <span>{project.owner.name}</span>}
                <span>{project.issue_count} issues</span>
                <span>{project.sprint_count} sprints</span>
              </div>
            </div>

            {/* Arrow */}
            <svg className="w-4 h-4 text-muted flex-shrink-0" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
            </svg>
          </div>
        ))}
      </div>
    </div>
  );
}
