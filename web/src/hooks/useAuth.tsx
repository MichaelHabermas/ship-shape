import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  type ReactNode,
} from 'react';
import { api } from '@/lib/api';
import type { UserInfo } from '@/lib/api';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import type { WorkspaceResponse, WorkspaceWithRoleResponse } from '@ship/shared';
import { queryClient } from '@/lib/queryClient';
import { documentKeys, type WikiDocument } from '@/hooks/useDocumentsQuery';
import { programKeys, type Program } from '@/hooks/useProgramsQuery';
import { projectKeys, type Project } from '@/hooks/useProjectsQuery';
import { issueKeys, type IssueListItem } from '@/hooks/useIssuesQuery';
import { standupStatusKeys, type StandupStatus } from '@/hooks/useStandupStatusQuery';
import { actionItemsKeys } from '@/hooks/useActionItemsQuery';

// Cache key for offline auth
const AUTH_CACHE_KEY = 'ship:auth-cache';

interface CachedAuth {
  user: UserInfo;
  currentWorkspace: WorkspaceResponse | null;
  workspaces: WorkspaceWithRoleResponse[];
  impersonating?: { userId: string; userName: string };
  timestamp: number;
}

// Cache auth data to localStorage for offline access
function cacheAuthData(data: CachedAuth): void {
  try {
    localStorage.setItem(AUTH_CACHE_KEY, JSON.stringify(data));
  } catch (e) {
    console.error('Failed to cache auth data:', e);
  }
}

// Get cached auth data
function getCachedAuthData(): CachedAuth | null {
  try {
    const cached = localStorage.getItem(AUTH_CACHE_KEY);
    if (cached) {
      const data = JSON.parse(cached) as CachedAuth;
      // Check if cache is less than 24 hours old
      const maxAge = 24 * 60 * 60 * 1000;
      if (Date.now() - data.timestamp < maxAge) {
        return data;
      }
    }
  } catch (e) {
    console.error('Failed to read auth cache:', e);
  }
  return null;
}

// Clear cached auth data
function clearCachedAuthData(): void {
  try {
    localStorage.removeItem(AUTH_CACHE_KEY);
  } catch (e) {
    console.error('Failed to clear auth cache:', e);
  }
}

interface AuthContextType {
  user: UserInfo | null;
  loading: boolean;
  isSuperAdmin: boolean;
  impersonating: { userId: string; userName: string } | null;
  login: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => Promise<void>;
  endImpersonation: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

/** Mark bootstrap-seeded list caches stale so detail routes refetch full contracts (D045). */
const BOOTSTRAP_STALE_QUERY_META = { updatedAt: 0 };

function seedBootstrapQueries(data: Awaited<ReturnType<typeof api.auth.bootstrap>>['data']): void {
  if (!data) return;

  queryClient.setQueryData<WikiDocument[]>(documentKeys.wikiList(), data.documents as WikiDocument[], BOOTSTRAP_STALE_QUERY_META);
  queryClient.setQueryData<Program[]>(programKeys.lists(), data.programs as Program[]);
  queryClient.setQueryData<Project[]>(projectKeys.lists(), data.projects as Project[], BOOTSTRAP_STALE_QUERY_META);
  queryClient.setQueryData<IssueListItem[]>(issueKeys.list(undefined), data.issues as IssueListItem[]);
  queryClient.setQueryData<StandupStatus>(standupStatusKeys.status(), data.standupStatus as StandupStatus, BOOTSTRAP_STALE_QUERY_META);
  queryClient.setQueryData(actionItemsKeys.list(), data.actionItems, BOOTSTRAP_STALE_QUERY_META);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [impersonating, setImpersonating] = useState<{ userId: string; userName: string } | null>(null);
  const sessionCheckStartedRef = useRef(false);
  const { setCurrentWorkspace, setWorkspaces } = useWorkspace();

  const isSuperAdmin = user?.isSuperAdmin ?? false;

  // Check session on mount
  useEffect(() => {
    // React StrictMode runs effects twice in development; ensure one session check per mount.
    if (sessionCheckStartedRef.current) return;
    sessionCheckStartedRef.current = true;

    const checkSession = async () => {
      try {
        const response = await api.auth.bootstrap();
        if (response.success && response.data) {
          seedBootstrapQueries(response.data);
          setUser(response.data.user);
          setCurrentWorkspace(response.data.currentWorkspace);
          setWorkspaces(response.data.workspaces);
          if (response.data.impersonating) {
            setImpersonating(response.data.impersonating);
          }
          // Cache auth data for offline use
          cacheAuthData({
            user: response.data.user,
            currentWorkspace: response.data.currentWorkspace,
            workspaces: response.data.workspaces,
            impersonating: response.data.impersonating,
            timestamp: Date.now(),
          });
        } else {
          // Session check failed - clear cache if online (session expired)
          if (navigator.onLine) {
            clearCachedAuthData();
          }
        }
      } catch (error) {
        // Network error - try to use cached auth if offline
        if (!navigator.onLine) {
          const cached = getCachedAuthData();
          if (cached) {
            console.log('[Auth] Using cached auth data (offline)');
            setUser(cached.user);
            setCurrentWorkspace(cached.currentWorkspace);
            setWorkspaces(cached.workspaces);
            if (cached.impersonating) {
              setImpersonating(cached.impersonating);
            }
          }
        } else {
          console.error('[Auth] Session check failed:', error);
        }
      } finally {
        setLoading(false);
      }
    };

    checkSession();
  }, [setCurrentWorkspace, setWorkspaces]);

  const login = useCallback(async (email: string, password: string) => {
    const response = await api.auth.login(email, password);
    if (response.success && response.data) {
      setUser(response.data.user);
      setCurrentWorkspace(response.data.currentWorkspace);
      setWorkspaces(response.data.workspaces);
      // Cache auth data for offline use
      cacheAuthData({
        user: response.data.user,
        currentWorkspace: response.data.currentWorkspace,
        workspaces: response.data.workspaces,
        timestamp: Date.now(),
      });
      return { success: true };
    }
    return {
      success: false,
      error: response.error?.message || 'Login failed',
    };
  }, [setCurrentWorkspace, setWorkspaces]);

  const logout = useCallback(async () => {
    await api.auth.logout();
    setUser(null);
    setCurrentWorkspace(null);
    setWorkspaces([]);
    setImpersonating(null);
    clearCachedAuthData();
  }, [setCurrentWorkspace, setWorkspaces]);

  const endImpersonation = useCallback(async () => {
    const response = await api.admin.endImpersonation();
    if (response.success) {
      setImpersonating(null);
      // Refresh session to get original user context
      const meResponse = await api.auth.me();
      if (meResponse.success && meResponse.data) {
        setUser(meResponse.data.user);
        setCurrentWorkspace(meResponse.data.currentWorkspace);
        setWorkspaces(meResponse.data.workspaces);
        // Update cache
        cacheAuthData({
          user: meResponse.data.user,
          currentWorkspace: meResponse.data.currentWorkspace,
          workspaces: meResponse.data.workspaces,
          timestamp: Date.now(),
        });
      }
    }
  }, [setCurrentWorkspace, setWorkspaces]);

  return (
    <AuthContext.Provider value={{ user, loading, isSuperAdmin, impersonating, login, logout, endImpersonation }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}
