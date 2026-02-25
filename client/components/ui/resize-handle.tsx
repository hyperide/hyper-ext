import { Separator as PanelResizeHandle } from 'react-resizable-panels';
import cn from 'clsx';
import { ComponentProps } from 'react';

type PanelResizeHandleProps = ComponentProps<typeof PanelResizeHandle>;

interface ResizeHandleProps extends Omit<PanelResizeHandleProps, 'className'> {
  orientation?: 'horizontal' | 'vertical';
  className?: string;
}

/**
 * Unified resize handle for react-resizable-panels.
 * Uses 11px hitbox with 1px visible line (pseudo-element).
 * Matches LeftSidebar pattern for consistency.
 */
export function ResizeHandle({
  orientation = 'horizontal',
  className,
  ...props
}: ResizeHandleProps) {
  return (
    <PanelResizeHandle
      className={cn(
        'relative outline-none transition-colors',
        orientation === 'horizontal'
          ? 'h-[11px] -my-[5px] cursor-ns-resize before:absolute before:inset-x-0 before:top-1/2 before:-translate-y-1/2 before:h-px'
          : 'w-[11px] -mx-[5px] cursor-ew-resize before:absolute before:inset-y-0 before:left-1/2 before:-translate-x-1/2 before:w-px',
        'before:bg-border hover:before:bg-blue-500 data-[separator=active]:before:bg-blue-500 before:transition-colors',
        className
      )}
      {...props}
    />
  );
}
