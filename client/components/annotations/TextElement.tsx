import { memo, useRef, useEffect, useState } from 'react';
import type { TextAnnotation } from '../../../shared/types/annotations';

export interface TextElementProps {
	text: TextAnnotation;
	isSelected: boolean;
	isEditing: boolean;
	isDark?: boolean;
	onEndEdit: () => void;
	onChange: (text: TextAnnotation) => void;
	onSizeChange?: (id: string, width: number, height: number) => void;
}

/**
 * SVG Text element with inline editing via foreignObject
 * Pure rendering component - selection/drag is handled by AnnotationsLayer
 */
export const TextElement = memo(function TextElement({
	text,
	isSelected,
	isEditing,
	isDark = false,
	onEndEdit,
	onChange,
	onSizeChange,
}: TextElementProps) {
	const editableRef = useRef<HTMLDivElement>(null);
	const textRef = useRef<HTMLDivElement>(null);
	const [textSize, setTextSize] = useState({ width: 100, height: 24 });
	const onSizeChangeRef = useRef(onSizeChange);
	onSizeChangeRef.current = onSizeChange;

	// Measure actual text size using ResizeObserver (only when not editing to avoid resize loop)
	useEffect(() => {
		if (isEditing) return;
		const ref = textRef.current;
		if (!ref) return;

		const updateSize = (width: number, height: number) => {
			setTextSize({ width, height });
			onSizeChangeRef.current?.(text.id, width, height);
		};

		const observer = new ResizeObserver((entries) => {
			const entry = entries[0];
			if (entry) {
				updateSize(entry.contentRect.width, entry.contentRect.height);
			}
		});

		observer.observe(ref);
		// Initial measurement
		const rect = ref.getBoundingClientRect();
		updateSize(rect.width, rect.height);

		return () => observer.disconnect();
	}, [isEditing, text.id]);

	// Focus and select all text when entering edit mode
	useEffect(() => {
		if (isEditing && editableRef.current) {
			editableRef.current.focus();
			// Select all text
			const selection = window.getSelection();
			const range = document.createRange();
			range.selectNodeContents(editableRef.current);
			selection?.removeAllRanges();
			selection?.addRange(range);
		}
	}, [isEditing]);

	const saveAndEndEdit = () => {
		if (editableRef.current) {
			const newText = editableRef.current.textContent || '';
			if (newText !== text.text) {
				onChange({ ...text, text: newText, version: text.version + 1 });
			}
		}
		onEndEdit();
	};

	const handleBlur = (e: React.FocusEvent) => {
		// Don't save on window focus loss (e.g., switching apps)
		// relatedTarget is null when focus goes outside the document
		if (!e.relatedTarget && !document.hasFocus()) {
			return;
		}
		saveAndEndEdit();
	};

	const handleKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === 'Escape') {
			e.preventDefault();
			onEndEdit();
		} else if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			saveAndEndEdit();
		}
	};

	return (
		<g data-annotation-id={text.id} data-annotation-type="text">
			<foreignObject
				data-text-area={text.id}
				x={text.x}
				y={text.y}
				width={isEditing ? 1000 : Math.max(textSize.width + 20, 120)}
				height={isEditing ? 500 : Math.max(textSize.height + 10, 30)}
				style={{ overflow: 'visible' }}
			>
				{isEditing ? (
					<div
						ref={editableRef}
						contentEditable
						suppressContentEditableWarning
						onBlur={handleBlur}
						onKeyDown={handleKeyDown}
						style={{
							fontSize: text.fontSize,
							color: text.color,
							fontFamily: 'system-ui, sans-serif',
							outline: 'none',
							border: '1px solid #3b82f6',
							borderRadius: 2,
							padding: '2px 4px',
							backgroundColor: 'white',
							display: 'inline-block',
							minWidth: 50,
							whiteSpace: 'pre-wrap',
						}}
					>
						{text.text}
					</div>
				) : (
					<div
						ref={textRef}
						style={{
							fontSize: text.fontSize,
							color: text.color,
							fontFamily: 'system-ui, sans-serif',
							cursor: isSelected ? 'move' : 'pointer',
							userSelect: 'none',
							whiteSpace: 'pre-wrap',
							wordBreak: 'break-word',
							display: 'inline-block',
							// White text stroke for dark mode
							...(isDark && {
								textShadow: '-1px -1px 0 white, 1px -1px 0 white, -1px 1px 0 white, 1px 1px 0 white',
							}),
						}}
					>
						{text.text || 'Double-click to edit'}
					</div>
				)}
			</foreignObject>

			{/* Selection outline - only shown when selected but not editing */}
			{isSelected && !isEditing && (
				<rect
					x={text.x - 4}
					y={text.y - 4}
					width={textSize.width + 8}
					height={textSize.height + 8}
					fill="none"
					stroke="#3b82f6"
					strokeWidth={1}
					strokeDasharray="4 2"
					pointerEvents="none"
				/>
			)}
		</g>
	);
});
