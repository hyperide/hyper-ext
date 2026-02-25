/**
 * Hook for managing resize state in CanvasEditor.
 * Stores panel dimensions and tracks active resize for overlay.
 * Drag logic lives in DragResizeHandle / useResizeHandle.
 */

import { useState } from 'react';

interface UseCanvasResizeHandlersReturn {
	logsHeight: number;
	commentsSidebarWidth: number;
	setLogsHeight: (height: number) => void;
	setCommentsSidebarWidth: (width: number) => void;
}

export function useCanvasResizeHandlers(): UseCanvasResizeHandlersReturn {
	const [logsHeight, setLogsHeight] = useState(200);
	const [commentsSidebarWidth, setCommentsSidebarWidth] = useState(350);

	return {
		logsHeight,
		commentsSidebarWidth,
		setLogsHeight,
		setCommentsSidebarWidth,
	};
}
