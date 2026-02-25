import { Button } from '@/components/ui/button';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import ProjectSettingsTab from './ProjectSettingsTab';

interface ProjectSettingsProps {
  onClose: () => void;
}

export default function ProjectSettings({ onClose }: ProjectSettingsProps) {
  useDocumentTitle('Project Settings');

  return (
    <div className="fixed inset-0 z-50 bg-background flex flex-col overflow-hidden">
      {/* Header — fixed */}
      <div className="shrink-0 container mx-auto px-6 pt-6 max-w-6xl w-full">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-3xl font-bold">Project Settings</h1>
          <Button onClick={onClose} variant="outline">
            Close
          </Button>
        </div>
      </div>

      {/* Content — scrollable */}
      <div className="flex-1 overflow-auto">
        <div className="container mx-auto px-6 pb-6 max-w-6xl">
          <ProjectSettingsTab />
        </div>
      </div>
    </div>
  );
}
