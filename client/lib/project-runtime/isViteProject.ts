import type { ProjectData } from '@/pages/Editor/components/hooks/useProjectControl';

const VITE_FRAMEWORKS = new Set(['Vite SPA (file-based routing)', 'Vite SPA (JSX router)']);

export function isViteProject(project: ProjectData): boolean {
  return project.framework != null && VITE_FRAMEWORKS.has(project.framework);
}
