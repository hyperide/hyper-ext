import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { Toaster as Sonner } from '@/components/ui/sonner';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import AuthProvider from './components/AuthProvider';
import ProtectedRoute from './components/ProtectedRoute';
import { ThemeProvider } from './components/ThemeProvider';
import { PlatformProvider } from './lib/platform';

// Lazy load pages for code splitting
// EditorWrapper includes CanvasEngine, ComponentMetaProvider, and Index page
const EditorWrapper = lazy(() => import('./components/EditorWrapper'));
const Projects = lazy(() => import('./pages/Projects'));
const ProjectSettings = lazy(() => import('./pages/ProjectSettings'));
const Product = lazy(() => import('./pages/Product'));
const NotFound = lazy(() => import('./pages/NotFound'));
const Login = lazy(() => import('./pages/Login'));
const AuthCallback = lazy(() => import('./pages/AuthCallback'));
const AuthError = lazy(() => import('./pages/AuthError'));
const WorkspaceNew = lazy(() => import('./pages/WorkspaceNew'));
const WorkspaceSettings = lazy(() => import('./pages/WorkspaceSettings'));
const UserSettings = lazy(() => import('./pages/UserSettings'));
const InviteAccept = lazy(() => import('./pages/InviteAccept'));
const ProjectInviteAccept = lazy(() => import('./pages/ProjectInviteAccept'));

const queryClient = new QueryClient();

// Loading fallback for lazy-loaded pages
function PageLoading() {
  return (
    <div className="flex h-screen w-screen items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-3 text-muted-foreground">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-current border-t-transparent" />
        <span className="text-sm">Loading...</span>
      </div>
    </div>
  );
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <PlatformProvider>
      <AuthProvider>
        <ThemeProvider>
          <TooltipProvider>
            <Toaster />
            <Sonner />
            <BrowserRouter>
              <Suspense fallback={<PageLoading />}>
                <Routes>
                  {/* Public routes */}
                  <Route path="/login" element={<Login />} />
                  <Route path="/auth/callback" element={<AuthCallback />} />
                  <Route path="/auth/error" element={<AuthError />} />
                  <Route path="/invite/:token" element={<InviteAccept />} />
                  <Route path="/project-invite/:token" element={<ProjectInviteAccept />} />
                  <Route path="/product" element={<Product />} />

                  {/* Protected routes */}
                  <Route
                    path="/"
                    element={
                      <ProtectedRoute>
                        <EditorWrapper />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/projects"
                    element={
                      <ProtectedRoute>
                        <Projects />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/projects/:id/settings"
                    element={
                      <ProtectedRoute>
                        <ProjectSettings />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/workspaces/new"
                    element={
                      <ProtectedRoute>
                        <WorkspaceNew />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/workspaces/:slug/settings"
                    element={
                      <ProtectedRoute>
                        <WorkspaceSettings />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/settings"
                    element={
                      <ProtectedRoute>
                        <UserSettings />
                      </ProtectedRoute>
                    }
                  />

                  {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
                  <Route path="*" element={<NotFound />} />
                </Routes>
              </Suspense>
            </BrowserRouter>
          </TooltipProvider>
        </ThemeProvider>
      </AuthProvider>
    </PlatformProvider>
  </QueryClientProvider>
);

// Mount the app
// Preview mode uses separate entry point: CanvasPreviewEntry.tsx
// biome-ignore lint/style/noNonNullAssertion: root element is guaranteed by index.html
createRoot(document.getElementById('root')!).render(<App />);

export default App;
