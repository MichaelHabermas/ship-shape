import { useNavigate } from 'react-router-dom';
import { useDocuments } from '@/contexts/DocumentsContext';
import { usePrograms } from '@/contexts/ProgramsContext';
import { useIssues } from '@/contexts/IssuesContext';
import { useProjects } from '@/contexts/ProjectsContext';
import { useCurrentDocument } from '@/contexts/CurrentDocumentContext';
import { cn } from '@/lib/cn';
import { Tooltip } from '@/components/ui/Tooltip';
import type { Mode } from '@/hooks/useAppMode';
import { DocumentsTree } from './DocumentsTree.js';
import { IssuesSidebar } from './IssuesSidebar.js';
import { ProjectsList } from './ProjectsList.js';
import { ProgramsList } from './ProgramsList.js';
import { TeamSidebar } from './TeamSidebar.js';
import { PlusIcon, CollapseLeftIcon } from './sidebar-icons.js';

export type AppSidebarProps = {
  collapsed: boolean;
  onCollapse: () => void;
  hidden: boolean;
  activeMode: Mode;
  activeDocumentId?: string;
  onCreateDocument: () => void;
  onCreateIssue: () => void;
  onCreateProject: () => void;
};

export function AppSidebar({
  collapsed,
  onCollapse,
  hidden,
  activeMode,
  activeDocumentId,
  onCreateDocument,
  onCreateIssue,
  onCreateProject,
}: AppSidebarProps) {
  const navigate = useNavigate();
  const { documents } = useDocuments();
  const { programs, updateProgram } = usePrograms();
  const { issues, updateIssue } = useIssues();
  const { projects, updateProject } = useProjects();
  const { currentDocumentProjectId } = useCurrentDocument();

  return (
    <aside
      className={cn(
        'flex flex-col border-r border-border transition-all duration-200 overflow-hidden select-none',
        (collapsed || hidden) ? 'w-0 border-r-0' : 'w-56'
      )}
      aria-label="Document list"
    >
      <div className="flex w-56 flex-col h-full">
        <div className="flex h-10 items-center justify-between border-b border-border px-3">
          <h2 className="text-sm font-medium text-foreground m-0">
            {activeMode === 'docs' && 'Docs'}
            {activeMode === 'issues' && 'Issues'}
            {activeMode === 'projects' && 'Projects'}
            {activeMode === 'programs' && 'Programs'}
            {activeMode === 'sprints' && 'Weeks'}
            {activeMode === 'team' && 'Teams'}
            {activeMode === 'settings' && 'Settings'}
          </h2>
          <div className="flex items-center gap-1">
            {activeMode === 'docs' && (
              <Tooltip content="New document">
                <button
                  onClick={onCreateDocument}
                  className="flex h-6 w-6 items-center justify-center rounded text-muted hover:bg-border hover:text-foreground transition-colors"
                  aria-label="New document"
                >
                  <PlusIcon />
                </button>
              </Tooltip>
            )}
            {activeMode === 'issues' && (
              <Tooltip content="New issue">
                <button
                  onClick={onCreateIssue}
                  className="flex h-6 w-6 items-center justify-center rounded text-muted hover:bg-border hover:text-foreground transition-colors"
                  aria-label="New issue"
                >
                  <PlusIcon />
                </button>
              </Tooltip>
            )}
            {activeMode === 'projects' && (
              <Tooltip content="New project">
                <button
                  onClick={onCreateProject}
                  className="flex h-6 w-6 items-center justify-center rounded text-muted hover:bg-border hover:text-foreground transition-colors"
                  aria-label="New project"
                >
                  <PlusIcon />
                </button>
              </Tooltip>
            )}
            <Tooltip content="Collapse sidebar">
              <button
                onClick={() => onCollapse()}
                className="flex h-6 w-6 items-center justify-center rounded text-muted hover:bg-border hover:text-foreground transition-colors"
                aria-label="Collapse sidebar"
              >
                <CollapseLeftIcon />
              </button>
            </Tooltip>
          </div>
        </div>

        <div className="flex-1 overflow-auto py-2">
          {activeMode === 'docs' && (
            <DocumentsTree
              documents={documents}
              activeId={activeDocumentId}
            />
          )}
          {activeMode === 'issues' && (
            <IssuesSidebar
              issues={issues}
              activeId={activeDocumentId}
              onUpdateIssue={updateIssue}
            />
          )}
          {activeMode === 'projects' && (
            <ProjectsList
              projects={projects}
              activeId={activeDocumentId}
              currentProjectId={currentDocumentProjectId}
              onUpdateProject={updateProject}
            />
          )}
          {activeMode === 'programs' && (
            <ProgramsList
              programs={programs}
              activeId={activeDocumentId}
              onSelect={(id) => navigate(`/documents/${id}`)}
              onUpdateProgram={updateProgram}
            />
          )}
          {activeMode === 'team' && (
            <TeamSidebar />
          )}
          {activeMode === 'settings' && (
            <div className="px-3 py-2 text-sm text-muted">Settings</div>
          )}
        </div>
      </div>
    </aside>
  );
}
