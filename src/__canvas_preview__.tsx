import React from 'react';
import { MemoryRouter } from 'react-router-dom';

// --- Component Imports ---
import { SampleDefault as RightSidebarSampleDefault } from '../client/components/RightSidebar/RightSidebar';
import { SampleDefault as RightSidebarIndexSampleDefault } from '../client/components/RightSidebar/index';
import { SampleDefault as ProjectsSampleDefault } from '../client/pages/Projects';
import { SampleDefault as PaginationSampleDefault } from '../client/components/ui/pagination';
import { SampleDefault as DividerSampleDefault } from '../client/components/icons/Divider';
import { SampleDefault as FillSectionSampleDefault } from '../client/components/RightSidebar/sections/FillSection';
import { SampleDefault as ProjectSettingsSampleDefault } from '../client/pages/ProjectSettings';
import { SampleDefault as CanvasEditorSampleDefault } from '../client/pages/Editor/CanvasEditor';
import { SampleDefault as FillPickerSampleDefault } from '../client/components/ui/fill-picker';
import { SampleDefault as NavigationMenuSampleDefault } from '../client/components/ui/navigation-menu';

// --- Render Maps ---
const SampleDefaultMap: Record<string, React.FC> = {
  'client/components/RightSidebar/RightSidebar.tsx': RightSidebarSampleDefault,
  'client/components/RightSidebar/index.tsx': RightSidebarIndexSampleDefault,
  'client/pages/Projects.tsx': ProjectsSampleDefault,
  'client/components/ui/pagination.tsx': PaginationSampleDefault,
  'client/components/icons/Divider.tsx': DividerSampleDefault,
  'client/components/RightSidebar/sections/FillSection.tsx': FillSectionSampleDefault,
  'client/pages/ProjectSettings.tsx': ProjectSettingsSampleDefault,
  'client/pages/Editor/CanvasEditor.tsx': CanvasEditorSampleDefault,
  'client/components/ui/fill-picker.tsx': FillPickerSampleDefault,
  'client/components/ui/navigation-menu.tsx': NavigationMenuSampleDefault,
};

// Sample variants map - maps component paths to their Sample* variants
const sampleVariantsMap: Record<string, Record<string, React.FC>> = {
  'client/components/RightSidebar/RightSidebar.tsx': {},
  'client/components/RightSidebar/index.tsx': {},
  'client/pages/Projects.tsx': {},
  'client/components/ui/pagination.tsx': {},
  'client/components/icons/Divider.tsx': {},
  'client/components/RightSidebar/sections/FillSection.tsx': {},
  'client/pages/ProjectSettings.tsx': {},
  'client/pages/Editor/CanvasEditor.tsx': {},
  'client/components/ui/fill-picker.tsx': {},
  'client/components/ui/navigation-menu.tsx': {},
};


// --- Canvas Preview Component ---
export default function CanvasPreview() {
  const params = new URLSearchParams(window.location.search);
  const mode = params.get('mode') as 'single' | 'multi';
  const componentName = params.get('component');

  if (!componentName) {
    return <div>Error: No component specified</div>;
  }

  // --- SINGLE MODE ---
  if (mode !== 'multi') {
    const SampleComponent = SampleDefaultMap[componentName];
    if (!SampleComponent) {
      return <div>Error: Component not found</div>;
    }
    return (
      <MemoryRouter>
        <div data-canvas-instance-id="SampleDefault" style={{ padding: '20px' }}>
          <SampleComponent />
        </div>
      </MemoryRouter>
    );
  }

  // --- MULTI MODE ---
  // IframeCanvas passes 'instances' param with {instanceId: {x, y, width, height}}
  const instancesParam = params.get('instances');
  const instances: Record<string, { x?: number; y?: number }> = instancesParam ? JSON.parse(instancesParam) : {};

  const SampleDefault = SampleDefaultMap[componentName];
  const sampleVariants = sampleVariantsMap[componentName] || {};

  const allComponents: Record<string, React.FC | undefined> = {
    SampleDefault,
    ...sampleVariants,
  };

  return (
    <MemoryRouter>
      <div style={{ position: 'relative', width: '100vw', height: '100vh' }}>
        {Object.entries(allComponents).map(([name, Component]) => {
          if (!Component) {
            return null;
          }
          const pos = instances[name] || { x: 0, y: 0 };
          return (
            <div
              key={name}
              data-canvas-instance-id={name}
              style={{
                position: 'absolute',
                left: pos.x,
                top: pos.y,
              }}
            >
              <Component />
            </div>
          );
        })}
      </div>
    </MemoryRouter>
  );
}
