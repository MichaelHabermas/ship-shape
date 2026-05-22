import React, { Suspense } from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate, useParams } from 'react-router-dom';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { queryClient, queryPersister } from '@/lib/queryClient';
import { WorkspaceProvider } from '@/contexts/WorkspaceContext';
import { AuthProvider, useAuth } from '@/hooks/useAuth';
import { RealtimeEventsProvider } from '@/hooks/useRealtimeEvents';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { DocumentsProvider } from '@/contexts/DocumentsContext';
import { ProgramsProvider } from '@/contexts/ProgramsContext';
import { IssuesProvider } from '@/contexts/IssuesContext';
import { ProjectsProvider } from '@/contexts/ProjectsContext';
import { ArchivedPersonsProvider } from '@/contexts/ArchivedPersonsContext';
import { CurrentDocumentProvider } from '@/contexts/CurrentDocumentContext';
import { UploadProvider } from '@/contexts/UploadContext';
import { LoginPage } from '@/pages/Login';
import { AppLayout } from '@/pages/App';
import { ReviewQueueProvider } from '@/contexts/ReviewQueueContext';

import { ToastProvider } from '@/components/ui/Toast';
import { MutationErrorToast } from '@/components/MutationErrorToast';
import './index.css';

const DocumentsPage = React.lazy(() => import('@/pages/Documents').then((module) => ({ default: module.DocumentsPage })));
const IssuesPage = React.lazy(() => import('@/pages/Issues').then((module) => ({ default: module.IssuesPage })));
const ProgramsPage = React.lazy(() => import('@/pages/Programs').then((module) => ({ default: module.ProgramsPage })));
const TeamModePage = React.lazy(() => import('@/pages/TeamMode').then((module) => ({ default: module.TeamModePage })));
const TeamDirectoryPage = React.lazy(() => import('@/pages/TeamDirectory').then((module) => ({ default: module.TeamDirectoryPage })));
const PersonEditorPage = React.lazy(() => import('@/pages/PersonEditor').then((module) => ({ default: module.PersonEditorPage })));
const FeedbackEditorPage = React.lazy(() => import('@/pages/FeedbackEditor').then((module) => ({ default: module.FeedbackEditorPage })));
const PublicFeedbackPage = React.lazy(() => import('@/pages/PublicFeedback').then((module) => ({ default: module.PublicFeedbackPage })));
const ProjectsPage = React.lazy(() => import('@/pages/Projects').then((module) => ({ default: module.ProjectsPage })));
const MyWeekPage = React.lazy(() => import('@/pages/MyWeekPage').then((module) => ({ default: module.MyWeekPage })));
const AdminDashboardPage = React.lazy(() => import('@/pages/AdminDashboard').then((module) => ({ default: module.AdminDashboardPage })));
const AdminWorkspaceDetailPage = React.lazy(() => import('@/pages/AdminWorkspaceDetail').then((module) => ({ default: module.AdminWorkspaceDetailPage })));
const WorkspaceSettingsPage = React.lazy(() => import('@/pages/WorkspaceSettings').then((module) => ({ default: module.WorkspaceSettingsPage })));
const ConvertedDocumentsPage = React.lazy(() => import('@/pages/ConvertedDocuments').then((module) => ({ default: module.ConvertedDocumentsPage })));
const UnifiedDocumentPage = React.lazy(() => import('@/pages/UnifiedDocumentPage').then((module) => ({ default: module.UnifiedDocumentPage })));
const StatusOverviewPage = React.lazy(() => import('@/pages/StatusOverviewPage').then((module) => ({ default: module.StatusOverviewPage })));
const ReviewsPage = React.lazy(() => import('@/pages/ReviewsPage').then((module) => ({ default: module.ReviewsPage })));
const OrgChartPage = React.lazy(() => import('@/pages/OrgChartPage').then((module) => ({ default: module.OrgChartPage })));
const InviteAcceptPage = React.lazy(() => import('@/pages/InviteAccept').then((module) => ({ default: module.InviteAcceptPage })));
const SetupPage = React.lazy(() => import('@/pages/Setup').then((module) => ({ default: module.SetupPage })));

function LazyRoute({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={null}>{children}</Suspense>;
}

const ReactQueryDevtools = import.meta.env.DEV
  ? React.lazy(() => import('@tanstack/react-query-devtools').then((module) => ({ default: module.ReactQueryDevtools })))
  : null;

/**
 * Redirect component for type-specific routes to canonical /documents/:id
 * Uses replace to ensure browser history only has one entry
 */
function DocumentRedirect() {
  const { id } = useParams<{ id: string }>();
  return <Navigate to={`/documents/${id}`} replace />;
}

/**
 * Redirect component for /programs/:id/* routes to /documents/:id/*
 * Preserves the tab portion of the path (issues, projects, sprints)
 */
function ProgramTabRedirect() {
  const { id, '*': splat } = useParams<{ id: string; '*': string }>();
  const tab = splat || '';
  const targetPath = tab ? `/documents/${id}/${tab}` : `/documents/${id}`;
  return <Navigate to={targetPath} replace />;
}

/**
 * Redirect component for /sprints/:id/* routes to /documents/:id/*
 * Maps old sprint sub-routes to new unified document tab routes
 */
function SprintTabRedirect({ tab }: { tab?: string }) {
  const { id } = useParams<{ id: string }>();
  // Map 'planning' to 'plan' for consistency
  const mappedTab = tab === 'planning' ? 'plan' : tab;
  // 'view' maps to root (overview tab)
  const targetPath = mappedTab && mappedTab !== 'view'
    ? `/documents/${id}/${mappedTab}`
    : `/documents/${id}`;
  return <Navigate to={targetPath} replace />;
}

function PublicRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="text-muted">Loading...</div>
      </div>
    );
  }

  if (user) {
    return <Navigate to="/docs" replace />;
  }

  return <>{children}</>;
}

function SuperAdminRoute({ children }: { children: React.ReactNode }) {
  const { user, loading, isSuperAdmin } = useAuth();

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="text-muted">Loading...</div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (!isSuperAdmin) {
    return <Navigate to="/docs" replace />;
  }

  return <>{children}</>;
}

function App() {
  return (
    <Routes>
      {/* Truly public routes - no AuthProvider wrapper */}
      <Route
        path="/feedback/:programId"
        element={<LazyRoute><PublicFeedbackPage /></LazyRoute>}
      />
      {/* Routes that need AuthProvider (even if some are public) */}
      <Route
        path="/*"
        element={
          <WorkspaceProvider>
            <AuthProvider>
              <RealtimeEventsProvider>
                <AppRoutes />
              </RealtimeEventsProvider>
            </AuthProvider>
          </WorkspaceProvider>
        }
      />
    </Routes>
  );
}

function AppRoutes() {
  return (
    <Routes>
      <Route
        path="/setup"
        element={<LazyRoute><SetupPage /></LazyRoute>}
      />
      <Route
        path="/login"
        element={
          <PublicRoute>
            <LoginPage />
          </PublicRoute>
        }
      />
      <Route
        path="/invite/:token"
        element={<LazyRoute><InviteAcceptPage /></LazyRoute>}
      />
      <Route
        path="/admin"
        element={
          <SuperAdminRoute>
            <LazyRoute><AdminDashboardPage /></LazyRoute>
          </SuperAdminRoute>
        }
      />
      <Route
        path="/admin/workspaces/:id"
        element={
          <SuperAdminRoute>
            <LazyRoute><AdminWorkspaceDetailPage /></LazyRoute>
          </SuperAdminRoute>
        }
      />
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <CurrentDocumentProvider>
              <ArchivedPersonsProvider>
                <DocumentsProvider>
                  <ProgramsProvider>
                    <ProjectsProvider>
                      <IssuesProvider>
                        <UploadProvider>
                          <AppLayout />
                        </UploadProvider>
                      </IssuesProvider>
                    </ProjectsProvider>
                  </ProgramsProvider>
                </DocumentsProvider>
              </ArchivedPersonsProvider>
            </CurrentDocumentProvider>
          </ProtectedRoute>
        }
      >
        <Route index element={<Navigate to="/my-week" replace />} />
        <Route path="dashboard" element={<Navigate to="/my-week" replace />} />
        <Route path="my-week" element={<LazyRoute><MyWeekPage /></LazyRoute>} />
        <Route path="docs" element={<LazyRoute><DocumentsPage /></LazyRoute>} />
        <Route path="docs/:id" element={<DocumentRedirect />} />
        <Route path="documents/:id/*" element={<LazyRoute><UnifiedDocumentPage /></LazyRoute>} />
        <Route path="issues" element={<LazyRoute><IssuesPage /></LazyRoute>} />
        <Route path="issues/:id" element={<DocumentRedirect />} />
        <Route path="projects" element={<LazyRoute><ProjectsPage /></LazyRoute>} />
        <Route path="projects/:id" element={<DocumentRedirect />} />
        <Route path="programs" element={<LazyRoute><ProgramsPage /></LazyRoute>} />
        <Route path="programs/:programId/sprints/:id" element={<DocumentRedirect />} />
        <Route path="programs/:id/*" element={<ProgramTabRedirect />} />
        <Route path="sprints" element={<Navigate to="/team/allocation" replace />} />
        {/* Sprint routes - redirect legacy views to /documents/:id, keep planning workflow */}
        <Route path="sprints/:id" element={<DocumentRedirect />} />
        <Route path="sprints/:id/view" element={<SprintTabRedirect tab="view" />} />
        <Route path="sprints/:id/plan" element={<SprintTabRedirect tab="plan" />} />
        <Route path="sprints/:id/planning" element={<SprintTabRedirect tab="planning" />} />
        <Route path="sprints/:id/standups" element={<SprintTabRedirect tab="standups" />} />
        <Route path="sprints/:id/review" element={<SprintTabRedirect tab="review" />} />
        <Route path="team" element={<Navigate to="/team/allocation" replace />} />
        <Route path="team/allocation" element={<LazyRoute><TeamModePage /></LazyRoute>} />
        <Route path="team/directory" element={<LazyRoute><TeamDirectoryPage /></LazyRoute>} />
        <Route path="team/status" element={<LazyRoute><StatusOverviewPage /></LazyRoute>} />
        <Route path="team/reviews" element={<LazyRoute><ReviewsPage /></LazyRoute>} />
        <Route path="team/org-chart" element={<LazyRoute><OrgChartPage /></LazyRoute>} />
        {/* Person profile stays in Teams context - no redirect to /documents */}
        <Route path="team/:id" element={<LazyRoute><PersonEditorPage /></LazyRoute>} />
        <Route path="feedback/:id" element={<LazyRoute><FeedbackEditorPage /></LazyRoute>} />
        <Route path="settings" element={<LazyRoute><WorkspaceSettingsPage /></LazyRoute>} />
        <Route path="settings/conversions" element={<LazyRoute><ConvertedDocumentsPage /></LazyRoute>} />
      </Route>
    </Routes>
  );
}

const root = document.getElementById('root');
if (!root) {
  throw new Error('Root element not found');
}

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{ persister: queryPersister }}
    >
      <ToastProvider>
        <MutationErrorToast />
        <BrowserRouter>
          <ReviewQueueProvider>
            <App />
          </ReviewQueueProvider>
        </BrowserRouter>
      </ToastProvider>
      {ReactQueryDevtools && (
        <React.Suspense fallback={null}>
          <ReactQueryDevtools initialIsOpen={false} />
        </React.Suspense>
      )}
    </PersistQueryClientProvider>
  </React.StrictMode>
);
