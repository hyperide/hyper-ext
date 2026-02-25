/**
 * Right Panel App — thin wrapper for VS Code Secondary Side Bar.
 *
 * Sets up PlatformProvider + SharedEditorState sync,
 * then renders the shared RightSidebar component.
 */

import {
	PlatformProvider,
	usePlatformCanvas,
} from '@/lib/platform';
import { useSharedEditorState, useSharedEditorStateSync } from '@/lib/platform/shared-editor-state';
import RightSidebar from '@/components/RightSidebar/RightSidebar';

export function RightPanelApp() {
	return (
		<PlatformProvider>
			<RightPanelContent />
		</PlatformProvider>
	);
}

function RightPanelContent() {
	const canvas = usePlatformCanvas();
	useSharedEditorStateSync(canvas);

	const projectUIKit = useSharedEditorState((s) => s.projectUIKit) ?? 'none';

	return <RightSidebar projectUIKit={projectUIKit} />;
}
