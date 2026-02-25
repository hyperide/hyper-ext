import React from 'react';

// Component imports will be added automatically

import { SampleDefault as DividerSampleDefault } from './components/icons/Divider';
// Sample component map - React.FC components for HMR compatibility
import { SampleDefault as indexSampleDefault } from './components/RightSidebar/index';
import { SampleDefault as RightSidebarSampleDefault } from './components/RightSidebar/RightSidebar';
import { SampleDefault as FillSectionSampleDefault } from './components/RightSidebar/sections/FillSection';
import { SampleDefault as fill_pickerSampleDefault } from './components/ui/fill-picker';
import { SampleDefault as navigation_menuSampleDefault } from './components/ui/navigation-menu';
import { SampleDefault as paginationSampleDefault } from './components/ui/pagination';
import { SampleDefault as CanvasEditorSampleDefault } from './pages/Editor/CanvasEditor';
import { SampleDefault as ProjectSettingsSampleDefault } from './pages/ProjectSettings';
import { SampleDefault as ProjectsSampleDefault } from './pages/Projects';

const SampleDefaultMap: Record<string, React.FC> = {
  'client/components/ui/navigation-menu.tsx': navigation_menuSampleDefault,
  'client/components/ui/fill-picker.tsx': fill_pickerSampleDefault,
  'client/pages/Editor/CanvasEditor.tsx': CanvasEditorSampleDefault,
  'client/pages/ProjectSettings.tsx': ProjectSettingsSampleDefault,
  'client/components/RightSidebar/sections/FillSection.tsx': FillSectionSampleDefault,
  'client/components/RightSidebar/RightSidebar.tsx': RightSidebarSampleDefault,
  'client/components/icons/Divider.tsx': DividerSampleDefault,
  'client/components/ui/pagination.tsx': paginationSampleDefault,
  'client/pages/Projects.tsx': ProjectsSampleDefault,
  'client/components/RightSidebar/index.tsx': indexSampleDefault,
}; // Entries will be added automatically

interface CanvasPreviewProps {
  component?: string | null;
}

export default function CanvasPreview({ component }: CanvasPreviewProps) {
  const [componentPath, setComponentPath] = React.useState<string | null>(component || null);
  const [isMounted, setIsMounted] = React.useState(false);

  // Get component from URL on client-side mount
  React.useEffect(() => {
    setIsMounted(true);
    if (!component && typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const urlComponent = params.get('component');
      setComponentPath(urlComponent);
    }
  }, [component]);

  // Only available in development
  if (process.env.NODE_ENV !== 'development') {
    return (
      <div
        style={{
          padding: '20px',
        }}
      >
        Preview not available
      </div>
    );
  }

  if (!componentPath) {
    // Show loading during SSR and before mount (to prevent hydration mismatch)
    if (!isMounted) {
      return (
        <div
          style={{
            padding: '20px',
          }}
        >
          Loading...
        </div>
      );
    }
    // Show error only after mount
    return (
      <div
        style={{
          padding: '20px',
          fontFamily: 'sans-serif',
        }}
      >
        <h2>Error: No component specified</h2>
        <p>Please provide a component path via ?component= parameter</p>
        <p>Available components: {Object.keys(SampleDefaultMap).join(', ')}</p>
      </div>
    );
  }

  const SampleComponent = SampleDefaultMap[componentPath];

  if (!SampleComponent) {
    return (
      <div
        style={{
          padding: '20px',
          fontFamily: 'sans-serif',
        }}
      >
        <h2>Error: Component not found</h2>
        <p>Component "{componentPath}" is not available</p>
        <p>Available components: {Object.keys(SampleDefaultMap).join(', ')}</p>
      </div>
    );
  }

  return (
    <div
      style={{
        padding: '20px',
      }}
    >
      <SampleComponent />
    </div>
  );
}
