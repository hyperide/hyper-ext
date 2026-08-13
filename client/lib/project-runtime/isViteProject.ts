import type { ProjectData } from '@/pages/Editor/components/hooks/useProjectControl';

export function isViteProject(project: ProjectData): boolean {
  return project.clientSideRuntime === true;
}
