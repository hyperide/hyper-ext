import { IconCircleFilled, IconX } from '@tabler/icons-react';

interface EditorTab {
  path: string;
  filename: string;
  isDirty: boolean;
}

interface EditorTabsProps {
  tabs: EditorTab[];
  activeTab: string | null;
  onTabClick: (path: string) => void;
  onTabClose: (path: string) => void;
  diffMode?: boolean;
  onExitDiff?: () => void;
}

export default function EditorTabs({ tabs, activeTab, onTabClick, onTabClose, diffMode, onExitDiff }: EditorTabsProps) {
  if (tabs.length === 0) {
    return null;
  }

  return (
    <div className="h-10 flex-shrink-0 bg-muted border-b border-border flex items-center overflow-x-auto">
      {tabs.map((tab) => (
        <button
          key={tab.path}
          type="button"
          onClick={() => onTabClick(tab.path)}
          className={`group h-full px-3 flex items-center gap-2 border-r border-border min-w-0 max-w-[200px] ${
            activeTab === tab.path ? 'bg-background' : 'bg-muted hover:bg-accent'
          }`}
        >
          <span
            className={`text-xs truncate ${
              activeTab === tab.path ? 'font-medium text-foreground' : 'text-muted-foreground'
            }`}
          >
            {tab.filename}
          </span>
          {tab.isDirty && <IconCircleFilled className="w-2 h-2 text-blue-500 flex-shrink-0" />}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onTabClose(tab.path);
            }}
            className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-accent rounded flex-shrink-0"
          >
            <IconX className="w-3 h-3 text-muted-foreground" stroke={1.5} />
          </button>
        </button>
      ))}
      {diffMode && onExitDiff && (
        <button
          type="button"
          onClick={onExitDiff}
          className="ml-auto mr-2 px-3 py-1 text-xs font-medium text-white bg-blue-600 rounded hover:bg-blue-700"
        >
          Exit Diff
        </button>
      )}
    </div>
  );
}
