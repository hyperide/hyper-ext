import posthog from 'posthog-js';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { lazy, Suspense } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { Toaster as Sonner } from '@/components/ui/sonner';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import AuthProvider from './components/AuthProvider';
import ProtectedRoute from './components/ProtectedRoute';
import { ThemeProvider } from './components/ThemeProvider';
import { getOrCreateHmrRoot } from './lib/hmr-root';
import { PlatformProvider } from './lib/platform';

// Initialize PostHog EU analytics only in production.
// Token is a public project key — safe to commit.
// The client is bundled by Bun (Bun.serve HTML import / Bun.build), NOT Vite: Vite's
// `import.meta` env object does not exist here — Bun leaves such reads verbatim in
// browser output, where they are undefined at runtime, so a bare `...env.PROD` guard
// throws a TypeError at module top level and white-screens the whole app (HYP-855).
// `process.env.NODE_ENV` IS statically inlined by Bun in both dev and production
// serving, so this guard folds to a constant at bundle time. The try/catch wraps the
// guard too, so no future bundler surprise can ever prevent the app from mounting.
try {
  if (process.env.NODE_ENV === 'production') {
    posthog.init('phc_zPBEBNdNyiie4jygsN7ZUkLjig5afSKCYTrPing5Ts7f', {
      api_host: 'https://eu.i.posthog.com',
      defaults: '2026-05-30',
    });
  }
} catch {
  // Analytics init failure must not block the app.
}

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
const OAuthConsent = lazy(() => import('./pages/OAuthConsent'));

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
                  <Route path="/v2/login" element={<Login />} />
                  <Route path="/auth/callback" element={<AuthCallback />} />
                  <Route path="/auth/error" element={<AuthError />} />
                  <Route path="/invite/:token" element={<InviteAccept />} />
                  <Route path="/project-invite/:token" element={<ProjectInviteAccept />} />
                  {/* OAuth consent must be PUBLIC: the user may be unauthenticated on first
                      landing (the page itself handles login + resume). Wrapping it in
                      ProtectedRoute would re-stash a wrong auth_redirect and lose the ticket. */}
                  <Route path="/oauth/consent" element={<OAuthConsent />} />
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

// Mount the app.
//
// Reuse the existing React root across Bun HMR module re-evaluations instead of calling
// createRoot() again on every hot-reload cycle. This file is both the SPA entry AND the
// router shell (see index.html), so Bun's dev server (server/main.ts, `development.hmr:
// true`) re-executes this module's top-level code whenever anything in its dependency
// graph changes. Without the guard, each cycle calls createRoot() on the SAME #root
// container that a previous cycle already passed to createRoot() — React warns
// "You are calling ReactDOMClient.createRoot() on a container that has already been
// passed to createRoot() before" and, once two roots both think they own the same DOM
// nodes, can eventually crash with removeChild()/NotFoundError. See HYP-1380 for the
// live before/after verification numbers (distinct from the componentMissing-retry loop
// #754 already fixed for this file). HYP-1385 tracks the structural fix — splitting this
// file's mount side effect into a separate entry module — which would let App.tsx export
// only a component and remove the need for this guard entirely; land that first if it's
// still open when touching this block again.
//
// import.meta.hot is undefined for any Bun dev-server reload cycle where the HMR
// transform doesn't apply (and is always undefined outside Bun's own bundler, e.g. a
// production build, where Bun dead-code-eliminates the whole `if` branch down to a bare
// createRoot call). The `else` branch keeps behavior identical to the pre-fix code for
// such cases — it does not, by itself, make this module safe to import outside a
// browser: `document.getElementById` still requires a DOM either way.
//
// The actual get-or-create logic lives in ./lib/hmr-root.ts (getOrCreateHmrRoot) — a
// side-effect-free extraction so it has a real unit test (client/lib/__tests__/hmr-root.test.ts)
// without importing this file, which mounts a real app to the DOM as an import-time side effect.
// eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- root element is guaranteed by index.html
const rootElement = document.getElementById('root')!;
if (import.meta.hot) {
  const hotData = import.meta.hot.data as { root?: Root };
  const root = getOrCreateHmrRoot(hotData, () => createRoot(rootElement));
  root.render(<App />);
} else {
  createRoot(rootElement).render(<App />);
}

export default App;
