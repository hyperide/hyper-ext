import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Command, CommandGroup, CommandItem, CommandList } from '@/components/ui/command';
import { Textarea } from '@/components/ui/textarea';

export interface MentionUser {
  id: string;
  name: string | null;
  email: string;
  avatarUrl: string | null;
}

interface CommentInputProps {
  placeholder?: string;
  submitLabel?: string;
  onSubmit: (content: string, mentionedUserIds: string[]) => void;
  onCancel?: () => void;
  isSubmitting?: boolean;
  autoFocus?: boolean;
  workspaceMembers?: MentionUser[];
}

export const CommentInput = memo(function CommentInput({
  placeholder = 'Add a comment...',
  submitLabel = 'Comment',
  onSubmit,
  onCancel,
  isSubmitting = false,
  autoFocus = false,
  workspaceMembers = [],
}: CommentInputProps) {
  const [content, setContent] = useState('');
  const [mentionQuery, setMentionQuery] = useState('');
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionPosition, setMentionPosition] = useState({ top: 0, left: 0 });
  const [cursorPosition, setCursorPosition] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Track mentioned users
  const [mentionedUsers, setMentionedUsers] = useState<Set<string>>(new Set());

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSubmit();
      return;
    }

    if (e.key === 'Escape' && mentionOpen) {
      e.preventDefault();
      setMentionOpen(false);
      return;
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    const selectionStart = e.target.selectionStart || 0;

    setContent(value);
    setCursorPosition(selectionStart);

    // Check for @ trigger
    const textBeforeCursor = value.slice(0, selectionStart);
    const lastAtIndex = textBeforeCursor.lastIndexOf('@');

    if (lastAtIndex !== -1) {
      const textAfterAt = textBeforeCursor.slice(lastAtIndex + 1);
      // Check if there's no space after @ (still typing mention)
      if (!textAfterAt.includes(' ') && textAfterAt.length <= 20) {
        setMentionQuery(textAfterAt.toLowerCase());
        setMentionOpen(true);

        // Calculate position for popover
        if (textareaRef.current) {
          const lineHeight = 20;
          const lines = textBeforeCursor.split('\n');
          const currentLine = lines.length - 1;
          const top = (currentLine + 1) * lineHeight + 4;
          setMentionPosition({ top, left: 0 });
        }
        return;
      }
    }

    setMentionOpen(false);
  };

  const insertMention = useCallback(
    (user: MentionUser) => {
      const textBeforeCursor = content.slice(0, cursorPosition);
      const lastAtIndex = textBeforeCursor.lastIndexOf('@');
      const textAfterCursor = content.slice(cursorPosition);

      if (lastAtIndex !== -1) {
        const displayName = user.name || user.email.split('@')[0];
        const newContent = `${textBeforeCursor.slice(0, lastAtIndex)}@${displayName} ${textAfterCursor}`;

        setContent(newContent);
        setMentionedUsers((prev) => new Set(prev).add(user.id));

        // Move cursor after mention
        const newCursorPos = lastAtIndex + displayName.length + 2;
        setTimeout(() => {
          if (textareaRef.current) {
            textareaRef.current.focus();
            textareaRef.current.setSelectionRange(newCursorPos, newCursorPos);
          }
        }, 0);
      }

      setMentionOpen(false);
      setMentionQuery('');
    },
    [content, cursorPosition],
  );

  const handleSubmit = () => {
    const trimmed = content.trim();
    if (!trimmed) return;

    // Extract mentioned user IDs from content
    const mentionedIds = Array.from(mentionedUsers).filter((userId) => {
      const user = workspaceMembers.find((m) => m.id === userId);
      if (!user) return false;
      const displayName = user.name || user.email.split('@')[0];
      return content.includes(`@${displayName}`);
    });

    onSubmit(trimmed, mentionedIds);
    setContent('');
    setMentionedUsers(new Set());
  };

  // Filter members by query
  const filteredMembers = workspaceMembers.filter((member) => {
    if (!mentionQuery) return true;
    const name = (member.name || '').toLowerCase();
    const email = member.email.toLowerCase();
    return name.includes(mentionQuery) || email.includes(mentionQuery);
  });

  // Auto-focus
  useEffect(() => {
    if (autoFocus && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [autoFocus]);

  return (
    <div className="space-y-2 relative">
      <div className="relative">
        <Textarea
          ref={textareaRef}
          value={content}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className="min-h-[80px] text-sm pr-2 resize-none"
          disabled={isSubmitting}
        />

        {/* Mention Popover */}
        {mentionOpen && filteredMembers.length > 0 && (
          <div
            className="absolute z-50 w-64 rounded-md border bg-popover shadow-md"
            style={{
              top: mentionPosition.top,
              left: mentionPosition.left,
            }}
          >
            <Command>
              <CommandList>
                <CommandGroup heading="Members">
                  {filteredMembers.slice(0, 8).map((member) => (
                    <CommandItem
                      key={member.id}
                      value={member.id}
                      onSelect={() => insertMention(member)}
                      className="flex items-center gap-2 cursor-pointer"
                    >
                      {member.avatarUrl ? (
                        <img
                          src={member.avatarUrl}
                          alt={member.name || member.email}
                          className="h-6 w-6 rounded-full"
                        />
                      ) : (
                        <div className="flex h-6 w-6 items-center justify-center rounded-full bg-gray-200 text-xs font-medium">
                          {(member.name || member.email).charAt(0).toUpperCase()}
                        </div>
                      )}
                      <div className="flex flex-col min-w-0">
                        <span className="text-sm font-medium truncate">
                          {member.name || member.email.split('@')[0]}
                        </span>
                        {member.name && <span className="text-xs text-muted-foreground truncate">{member.email}</span>}
                      </div>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">Type @ to mention • Cmd+Enter to send</span>
        <div className="flex gap-2">
          {onCancel && (
            <Button size="sm" variant="ghost" onClick={onCancel} disabled={isSubmitting}>
              Cancel
            </Button>
          )}
          <Button size="sm" onClick={handleSubmit} disabled={!content.trim() || isSubmitting}>
            {submitLabel}
          </Button>
        </div>
      </div>
    </div>
  );
});
