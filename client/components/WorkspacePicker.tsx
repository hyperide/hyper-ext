import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { IconChevronDown, IconPlus, IconCheck } from '@tabler/icons-react';
import { useAuthStore, type Workspace } from '@/stores/authStore';

interface WorkspacePickerProps {
  className?: string;
}

export default function WorkspacePicker({ className }: WorkspacePickerProps) {
  const navigate = useNavigate();
  const { workspaces, currentWorkspace, setCurrentWorkspace } = useAuthStore();
  const [open, setOpen] = useState(false);

  const handleWorkspaceSelect = (workspace: Workspace) => {
    setCurrentWorkspace(workspace);
    setOpen(false);
  };

  const handleCreateWorkspace = () => {
    setOpen(false);
    navigate('/workspaces/new');
  };

  if (!currentWorkspace) {
    return null;
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className={className}>
          <span className="truncate max-w-[150px]">{currentWorkspace.name}</span>
          <IconChevronDown className="w-4 h-4 ml-1 opacity-50" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {workspaces.map((workspace) => (
          <DropdownMenuItem
            key={workspace.id}
            onClick={() => handleWorkspaceSelect(workspace)}
            className="cursor-pointer"
          >
            <span className="flex-1 truncate">{workspace.name}</span>
            {workspace.id === currentWorkspace.id && (
              <IconCheck className="w-4 h-4 ml-2 text-primary" />
            )}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={handleCreateWorkspace} className="cursor-pointer">
          <IconPlus className="w-4 h-4 mr-2" />
          Create workspace
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
