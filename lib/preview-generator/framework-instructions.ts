/**
 * Shared framework-specific AI-sample instructions.
 *
 * Spec: styles-system master spec §5.6 — the ProjectDetector is "shared-first across realms",
 * NOT server-only. Both realms that generate AI `Sample*` components run the SAME shared
 * detector ({@link detectFramework}, `framework-routing.ts`) and feed its result here to build
 * the router/params guidance block appended to the base sample prompt:
 *   - server: `server/routes/parseComponent.ts` (`generateSampleDefault`)
 *   - VS Code extension: `vscode-extension/.../services/SampleAIGenerator.ts`
 *
 * User-facing impact: AI-generated `SampleDefault` components for routed components (Next.js
 * App/Pages Router params, Remix loader params, React Router wrappers) get the correct
 * scaffolding instructions. Previously only the server passed these, so extension-generated
 * samples for routed components were more likely to render broken. Moving this out of the
 * server route makes it a single source of truth both realms import.
 */

import type { DetectionResult } from './framework-routing';

/**
 * Build framework-specific instructions and routing examples for AI sample generation.
 * Pure: maps a {@link DetectionResult} (from the shared `detectFramework`) to a prompt block.
 *
 * NOTE: Solito projects are detected as nextjs-pages-router (Solito is built on Next.js Pages
 * Router). The nextjs-pages-router case handles both plain Next.js Pages Router and Solito.
 */
export function buildFrameworkInstructions(frameworkInfo: DetectionResult): string {
  const lines: string[] = [];

  switch (frameworkInfo.framework) {
    case 'nextjs-app-router':
      lines.push(
        '**PROJECT FRAMEWORK**: Next.js App Router (app/ directory)',
        '',
        '**Router/Params Support**:',
        'This is a Next.js App Router project. If the component uses routing hooks or needs params:',
        '- Component receives `params` and `searchParams` as props',
        '- Pass them directly as props, NO router wrapper needed',
        "- Example: `<PageComponent params={{ id: '123' }} searchParams={{ tab: 'overview' }} />`",
        '- DO NOT use react-router-dom or any router wrappers',
      );
      break;

    case 'nextjs-pages-router':
      lines.push(
        '**PROJECT FRAMEWORK**: Next.js Pages Router (pages/ directory)',
        '',
        '**Router/Params Support**:',
        'This is a Next.js Pages Router project. If the component uses `useRouter` or needs routing:',
        '- Create simple wrapper component that provides router context',
        '- Use inline object with query, pathname, push, etc.',
        '- Create context provider wrapper (see Example C below)',
        '- DO NOT use react-router-dom',
        '',
        '**Solito projects (createParam / useParam)**: Provide Next.js RouterContext with query params:',
        '```tsx',
        "import { RouterContext } from 'next/dist/shared/lib/router-context.shared-runtime';",
        '',
        'export const SampleDefault = () => {',
        '  const mockRouter = {',
        "    pathname: '/user/[id]',",
        "    route: '/user/[id]',",
        "    query: { id: '123' },",
        "    asPath: '/user/123',",
        "    basePath: '',",
        '    push: async () => true,',
        '    replace: async () => true,',
        '    reload: () => {},',
        '    back: () => {},',
        '    prefetch: async () => {},',
        '    beforePopState: () => {},',
        '    events: { on: () => {}, off: () => {}, emit: () => {} },',
        '    isFallback: false,',
        '    isLocaleDomain: false,',
        '    isReady: true,',
        '    isPreview: false,',
        '  };',
        '  return (',
        '    <RouterContext.Provider value={mockRouter as any}>',
        '      <Page />',
        '    </RouterContext.Provider>',
        '  );',
        '};',
        '```',
      );
      break;

    case 'vite-spa-jsx-router':
    case 'vite-spa-file-based':
      lines.push(
        '**PROJECT FRAMEWORK**: React Router (react-router-dom)',
        '',
        '**Router/Params Support**:',
        'This is a React Router project. If the component uses routing hooks or needs params:',
        "- Import MemoryRouter, Routes, Route from 'react-router-dom'",
        '- Wrap component in MemoryRouter with appropriate route path',
        '- Provide realistic mock params (e.g., id: "123", slug: "example-post")',
        '- See Example A below',
      );
      break;

    case 'remix':
      lines.push(
        '**PROJECT FRAMEWORK**: Remix (app/routes/ directory)',
        '',
        '**Router/Params Support**:',
        'This is a Remix project. If the component uses routing:',
        '- Component may receive `params` from loader',
        '- Pass them as props similar to Next.js App Router',
        "- Example: `<PageComponent params={{ id: '123' }} />`",
      );
      break;

    default:
      // webpack, parcel, unknown — no framework-specific routing instructions
      lines.push(
        '**PROJECT FRAMEWORK**: No routing framework detected',
        '',
        '**Router/Params Support**:',
        "- If component uses routing hooks, it likely won't work in preview",
        '- Just render the component with required props',
        '- DO NOT add any router wrappers unless you see routing imports in the component',
      );
      break;
  }

  // Routing examples (useful regardless of detected framework)
  lines.push(
    '',
    '**Example A - React Router (react-router-dom)**:',
    '```',
    "import { MemoryRouter, Routes, Route } from 'react-router-dom';",
    '',
    'export const SampleDefault = () => {',
    '  return (',
    "    <MemoryRouter initialEntries={['/users/123']}>",
    '      <Routes>',
    '        <Route path="/users/:id" element={<UserDetailPage />} />',
    '      </Routes>',
    '    </MemoryRouter>',
    '  );',
    '};',
    '```',
    '',
    '**Example B - Next.js App Router (next/navigation)**:',
    '```',
    'export const SampleDefault = () => {',
    '  return (',
    '    <UserDetailPage',
    "      params={{ id: '123' }}",
    "      searchParams={{ tab: 'overview' }}",
    '    />',
    '  );',
    '};',
    '```',
    '',
    '**Example C - Next.js Pages Router (next/router)**:',
    '```',
    "import { createContext } from 'react';",
    '',
    'const MockRouterContext = createContext({',
    "  query: { id: '123' },",
    "  pathname: '/users/[id]',",
    '  push: () => Promise.resolve(true),',
    '  replace: () => Promise.resolve(true),',
    '  back: () => {},',
    '});',
    '',
    'export const SampleDefault = () => {',
    '  return (',
    '    <MockRouterContext.Provider value={{',
    "      query: { id: '123' },",
    "      pathname: '/users/[id]',",
    '      push: () => Promise.resolve(true),',
    '      replace: () => Promise.resolve(true),',
    '      back: () => {},',
    '    }}>',
    '      <UserDetailPage />',
    '    </MockRouterContext.Provider>',
    '  );',
    '};',
    '```',
    '',
    '**Example D - Simple component (no routing)**:',
    '```',
    'export const SampleDefault = () => {',
    '  return <ActualComponentName title="Product Dashboard" onSubmit={() => {}} />;',
    '};',
    '```',
    '',
    '**Example E - Toast/Notification component**:',
    '```',
    'export const SampleDefault = () => {',
    '  return (',
    '    <ToastProvider>',
    '      <ToastViewport />',
    '      <Toast open={true}>',
    '        <Toast.Title>New Message</Toast.Title>',
    '        <Toast.Description>You have a new notification</Toast.Description>',
    '        <Toast.Action altText="View">View</Toast.Action>',
    '      </Toast>',
    '    </ToastProvider>',
    '  );',
    '};',
    '```',
    '',
    '**Example F - Modal/Dialog component**:',
    '```',
    'export const SampleDefault = () => {',
    '  return (',
    '    <Dialog open={true}>',
    '      <Dialog.Content>',
    '        <Dialog.Title>Confirm Action</Dialog.Title>',
    '        <Dialog.Description>Are you sure you want to proceed?</Dialog.Description>',
    '        <Button>Confirm</Button>',
    '      </Dialog.Content>',
    '    </Dialog>',
    '  );',
    '};',
    '```',
    '',
    '**Example G - Provider component**:',
    '```',
    'export const SampleDefault = () => {',
    '  return (',
    "    <ThemeProvider value={{ theme: 'dark' }}>",
    '      <Card>',
    '        <Text>Content using theme context</Text>',
    '      </Card>',
    '    </ThemeProvider>',
    '  );',
    '};',
    '```',
  );

  return lines.join('\n');
}
