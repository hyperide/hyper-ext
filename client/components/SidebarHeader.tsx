import { IconGitBranch, IconHome } from '@tabler/icons-react';
import { useNavigate } from 'react-router-dom';
import { useGitStore } from '@/stores/gitStore';

export default function SidebarHeader() {
  const navigate = useNavigate();

  const {
    isPushPopoverOpen,
    setIsPushPopoverOpen,
    hasUnpushedChanges,
    unpushedFileCount,
    flowState,
    pushChanges,
    commitMessage,
  } = useGitStore();
  const hasChanges = hasUnpushedChanges;
  const isPushing = flowState === 'pushing';
  const isGenerating = flowState === 'generating';

  const handleClick = async () => {
    if (isPushPopoverOpen) {
      if (hasChanges) {
        // Submit - push changes
        await pushChanges();
      } else {
        // Close - just close the section
        setIsPushPopoverOpen(false);
      }
    } else {
      // Open the section
      setIsPushPopoverOpen(true);
    }
  };

  // Button text logic:
  // - Closed with changes: "Push"
  // - Open with changes: "Submit" (or "Pushing..." when pushing)
  // - Open without changes: "Close"
  // - Closed without changes: "Push" (disabled)
  const getButtonText = () => {
    if (isPushPopoverOpen) {
      if (isPushing) return 'Pushing...';
      return hasChanges ? 'Submit' : 'Close';
    }
    return 'Push';
  };

  const isDisabled =
    (!isPushPopoverOpen && !hasChanges) ||
    isPushing ||
    (isPushPopoverOpen && hasChanges && isGenerating) ||
    (isPushPopoverOpen && hasChanges && !commitMessage.trim());

  return (
    <div className="p-3 flex items-center justify-between border-b border-border">
      <button type="button" onClick={() => navigate('/projects')} className="hover:bg-accent rounded p-1">
        <IconHome className="w-5 h-5" stroke={1.5} />
      </button>

      <button
        type="button"
        onClick={handleClick}
        disabled={isDisabled}
        className="h-7 px-2 rounded-md bg-muted hover:bg-accent text-xs font-medium flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed relative"
        title={isDisabled ? 'No changes to push' : 'Commit and push changes'}
      >
        <IconGitBranch className="w-4 h-4" />
        {getButtonText()}
        {!isPushPopoverOpen && hasChanges && (
          <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 bg-blue-500 text-white text-[10px] font-medium rounded-full flex items-center justify-center">
            {unpushedFileCount}
          </span>
        )}
      </button>
    </div>
  );
}
