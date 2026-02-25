import { memo } from 'react';
import { DockerLogsViewer } from '@/components/DockerLogsViewer';
import { DragResizeHandle } from '@/components/ui/drag-resize-handle';
import type { RuntimeError } from '@/../../shared/runtime-error';

interface ProjectInfo {
	name: string;
	framework: string;
	path: string;
	devCommand: string;
}

interface LogsPanelProps {
	projectId: string;
	containerStatus?: string;
	projectInfo: ProjectInfo;
	proxyError?: string | null;
	runtimeError?: RuntimeError | null;
	height: number;
	onHeightChange: (height: number) => void;
	onClose: () => void;
}

/**
 * Panel for displaying Docker container logs with resize handle.
 * Shown when gateway error is detected (502, etc.).
 */
export const LogsPanel = memo(function LogsPanel({
	projectId,
	containerStatus,
	projectInfo,
	proxyError,
	runtimeError,
	height,
	onHeightChange,
	onClose,
}: LogsPanelProps) {
	return (
		<div
			data-logs-panel
			className="absolute bottom-20 left-0 right-0 bg-background border-t border-border shadow-lg z-50"
			style={{ height: `${height}px` }}
		>
			<DragResizeHandle
				orientation="horizontal"
				value={height}
				onChange={onHeightChange}
				minValue={100}
				maxValue={600}
				inverted
				style={{
					position: 'absolute',
					top: 0,
					left: 0,
					right: 0,
					zIndex: 10,
				}}
			/>
			<DockerLogsViewer
				projectId={projectId}
				height="100%"
				containerStatus={containerStatus}
				projectInfo={projectInfo}
				proxyError={proxyError}
				runtimeError={runtimeError}
				onClose={onClose}
			/>
		</div>
	);
});
