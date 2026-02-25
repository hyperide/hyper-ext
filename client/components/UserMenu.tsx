// ⚠️ Vanilla JS copy exists in server/main.ts (IDE injection) - sync on changes
import { useNavigate } from 'react-router-dom';
import {
  IconChevronDown,
  IconLogout,
  IconSettings,
  IconUser,
  IconSun,
  IconMoon,
  IconDeviceDesktop,
} from '@tabler/icons-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuPortal,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from '@/components/ui/dropdown-menu';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { useAuthStore } from '@/stores/authStore';
import { useTheme } from '@/components/ThemeProvider';

interface UserMenuProps {
  onOpenProjectSettings?: () => void;
}

export default function UserMenu({ onOpenProjectSettings }: UserMenuProps) {
  const navigate = useNavigate();
  const { user, currentWorkspace, logout, updateTheme } = useAuthStore();
  const { theme, setTheme } = useTheme();

  const handleThemeChange = (value: string) => {
    const newTheme = value as 'light' | 'dark' | 'system';
    setTheme(newTheme);
    // Save to database (which also syncs to IDE settings.json)
    updateTheme(newTheme);
  };

  const initials = user?.name
    ? user.name
        .split(' ')
        .map((n) => n[0])
        .join('')
        .toUpperCase()
        .slice(0, 2)
    : user?.email?.slice(0, 2).toUpperCase() || '?';

  const handleLogout = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className="flex items-center gap-1">
          <Avatar className="w-6 h-6">
            <AvatarImage
              src={user?.avatarUrl || undefined}
              alt={user?.name || user?.email || 'User'}
            />
            <AvatarFallback className="text-xs">{initials}</AvatarFallback>
          </Avatar>
          <IconChevronDown className="w-3 h-3" stroke={1.5} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        {user && (
          <>
            <DropdownMenuLabel>
              <div className="flex flex-col space-y-1">
                <p className="text-sm font-medium">{user.name || 'User'}</p>
                <p className="text-xs text-muted-foreground truncate">{user.email}</p>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuItem
          onClick={() => navigate('/settings')}
          className="cursor-pointer"
        >
          <IconUser className="w-4 h-4 mr-2" />
          Account settings
        </DropdownMenuItem>
        {onOpenProjectSettings && (
          <DropdownMenuItem onClick={() => onOpenProjectSettings()} className="cursor-pointer">
            <IconSettings className="w-4 h-4 mr-2" />
            Project settings
          </DropdownMenuItem>
        )}
        {currentWorkspace && (
          <DropdownMenuItem
            onClick={() => navigate(`/workspaces/${currentWorkspace.slug}/settings`)}
            className="cursor-pointer"
          >
            <IconSettings className="w-4 h-4 mr-2" />
            Workspace settings
          </DropdownMenuItem>
        )}
        <DropdownMenuSub>
          <DropdownMenuSubTrigger className="cursor-pointer">
            {theme === 'dark' ? (
              <IconMoon className="w-4 h-4 mr-2" />
            ) : theme === 'light' ? (
              <IconSun className="w-4 h-4 mr-2" />
            ) : (
              <IconDeviceDesktop className="w-4 h-4 mr-2" />
            )}
            Theme
          </DropdownMenuSubTrigger>
          <DropdownMenuPortal>
            <DropdownMenuSubContent>
              <DropdownMenuRadioGroup value={theme} onValueChange={handleThemeChange}>
                <DropdownMenuRadioItem value="light" className="cursor-pointer">
                  <IconSun className="w-4 h-4 mr-2" />
                  Light
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="dark" className="cursor-pointer">
                  <IconMoon className="w-4 h-4 mr-2" />
                  Dark
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="system" className="cursor-pointer">
                  <IconDeviceDesktop className="w-4 h-4 mr-2" />
                  System
                </DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuPortal>
        </DropdownMenuSub>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={handleLogout} className="cursor-pointer text-destructive">
          <IconLogout className="w-4 h-4 mr-2" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
