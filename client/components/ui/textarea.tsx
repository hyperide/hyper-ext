import * as React from 'react';

import { cn } from '@/lib/utils';

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  autoResize?: boolean;
  maxRows?: number;
}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, autoResize = false, maxRows = 5, onChange, ...props }, ref) => {
    const internalRef = React.useRef<HTMLTextAreaElement>(null);
    const textareaRef = (ref as React.RefObject<HTMLTextAreaElement>) || internalRef;

    const resizeTextarea = React.useCallback(() => {
      const textarea = textareaRef.current;
      if (!textarea || !autoResize) return;

      // Reset height to auto to get the correct scrollHeight
      textarea.style.height = 'auto';

      // Calculate line height
      const lineHeight = Number.parseInt(window.getComputedStyle(textarea).lineHeight, 10);
      const maxHeight = lineHeight * maxRows;

      // Set new height, capped at maxHeight
      const newHeight = Math.min(textarea.scrollHeight, maxHeight);
      textarea.style.height = `${newHeight}px`;
    }, [autoResize, maxRows, textareaRef]);

    const handleChange = React.useCallback(
      (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        onChange?.(e);
        if (autoResize) {
          // Resize after state update
          requestAnimationFrame(() => {
            resizeTextarea();
          });
        }
      },
      [onChange, autoResize, resizeTextarea],
    );

    React.useEffect(() => {
      if (autoResize) {
        resizeTextarea();
      }
    }, [autoResize, resizeTextarea]);

    return (
      <textarea
        className={cn(
          'flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
          autoResize && 'resize-none overflow-y-auto',
          className,
        )}
        ref={textareaRef}
        onChange={handleChange}
        {...props}
      />
    );
  },
);
Textarea.displayName = 'Textarea';

export { Textarea };
