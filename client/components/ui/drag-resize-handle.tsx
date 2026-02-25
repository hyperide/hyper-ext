import cn from 'clsx';
import { createPortal } from 'react-dom';
import { useResizeHandle } from '@/pages/Editor/components/hooks/useResizeHandle';

interface DragResizeHandleProps {
	orientation?: 'horizontal' | 'vertical';
	value: number;
	onChange: (value: number) => void;
	minValue: number;
	maxValue: number;
	inverted?: boolean;
	className?: string;
	/** Inline styles — use for position:fixed/absolute overrides */
	style?: React.CSSProperties;
	/**
	 * When true, positions the handle with `position: fixed`, spanning full
	 * viewport height (vertical) or width (horizontal).
	 * Use `offset` to control the edge distance.
	 */
	fixed?: boolean;
	/** Distance in px from the edge (right when inverted, left otherwise for vertical). */
	offset?: number;
}

/**
 * Standalone resize handle for use outside PanelGroup.
 * Default: 11px hitbox with negative margins (1px layout footprint), 1px visible line.
 * Pass `style` with position/sizing to override for fixed or absolute layouts.
 * Visual style matches PanelResizeHandle (react-resizable-panels).
 */
export function DragResizeHandle({
	orientation = 'vertical',
	value,
	onChange,
	minValue,
	maxValue,
	inverted = false,
	className,
	style,
	fixed = false,
	offset,
}: DragResizeHandleProps) {
	const { handleMouseDown, isDragging } = useResizeHandle({
		direction: orientation === 'vertical' ? 'horizontal' : 'vertical',
		value,
		onChange,
		minValue,
		maxValue,
		inverted,
	});

	const fixedStyle: React.CSSProperties | undefined = fixed
		? {
				position: 'fixed',
				zIndex: 50,
				...(orientation === 'vertical'
					? {
							top: 0,
							bottom: 0,
							width: 11,
							...(inverted
								? { right: offset, transform: 'translateX(50%)' }
								: { left: offset, transform: 'translateX(-50%)' }),
						}
					: {
							left: 0,
							right: 0,
							height: 11,
							...(inverted
								? { bottom: offset, transform: 'translateY(50%)' }
								: { top: offset, transform: 'translateY(-50%)' }),
						}),
			}
		: undefined;

	return (
		<button
			type="button"
			aria-label="Resize"
			data-dragging={isDragging || undefined}
			onMouseDown={handleMouseDown}
			style={fixedStyle ?? style}
			className={cn(
				'border-0 p-0 bg-transparent outline-none appearance-none',
				!style?.position && !fixed && 'relative z-[40]',
				!(style?.width || style?.height || fixed) &&
					(orientation === 'vertical'
						? 'w-[11px] -mx-[5px]'
						: 'h-[11px] -my-[5px]'),
				orientation === 'vertical'
					? 'cursor-ew-resize before:absolute before:inset-y-0 before:left-1/2 before:-translate-x-1/2 before:w-px'
					: 'cursor-ns-resize before:absolute before:inset-x-0 before:top-1/2 before:-translate-y-1/2 before:h-px',
				'before:transition-colors before:bg-border',
				'hover:before:bg-blue-500 data-[dragging]:before:bg-blue-500',
				className,
			)}
		>
			{isDragging &&
				createPortal(
					<div
						style={{
							position: 'fixed',
							inset: 0,
							zIndex: 9999,
							cursor:
								orientation === 'vertical' ? 'ew-resize' : 'ns-resize',
						}}
					/>,
					document.body,
				)}
		</button>
	);
}
