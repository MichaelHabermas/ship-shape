import {
  createContext,
  useContext,
  useState,
  useCallback,
  type ReactNode,
} from 'react';
import type { WorkspaceWithRoleResponse } from '@ship/shared';
import { api, type Workspace } from '@/lib/api';

export type WorkspaceWithRole = WorkspaceWithRoleResponse;

interface WorkspaceContextType {
  currentWorkspace: Workspace | null;
  workspaces: WorkspaceWithRole[];
  isWorkspaceAdmin: boolean;
  setCurrentWorkspace: (workspace: Workspace | null) => void;
  setWorkspaces: (workspaces: WorkspaceWithRole[]) => void;
  switchWorkspace: (workspaceId: string) => Promise<boolean>;
  refreshWorkspaces: () => Promise<void>;
}

const WorkspaceContext = createContext<WorkspaceContextType | null>(null);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [currentWorkspace, setCurrentWorkspace] = useState<Workspace | null>(null);
  const [workspaces, setWorkspaces] = useState<WorkspaceWithRole[]>([]);

  const isWorkspaceAdmin = workspaces.find(w => w.id === currentWorkspace?.id)?.role === 'admin';

  const switchWorkspace = useCallback(async (workspaceId: string): Promise<boolean> => {
    const response = await api.workspaces.switch(workspaceId);
    if (response.success && response.data) {
      setCurrentWorkspace(response.data.workspace);
      return true;
    }
    return false;
  }, []);

  const refreshWorkspaces = useCallback(async () => {
    const response = await api.workspaces.list();
    if (response.success && response.data) {
      setWorkspaces(response.data);
    }
  }, []);

  return (
    <WorkspaceContext.Provider
      value={{
        currentWorkspace,
        workspaces,
        isWorkspaceAdmin,
        setCurrentWorkspace,
        setWorkspaces,
        switchWorkspace,
        refreshWorkspaces,
      }}
    >
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace() {
  const context = useContext(WorkspaceContext);
  if (!context) {
    throw new Error('useWorkspace must be used within WorkspaceProvider');
  }
  return context;
}
