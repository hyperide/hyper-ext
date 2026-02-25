import { memo, useState } from 'react';
import UserMenu from '@/components/UserMenu';
import { NotificationBell } from '@/components/notifications';
import { ShareProjectModal } from '@/components/ShareProjectModal';
import { useEditorStore } from '@/stores/editorStore';

interface HeaderSectionProps {
	onOpenSettings?: () => void;
	projectId?: string | null;
	projectName?: string | null;
}

export const HeaderSection = memo(function HeaderSection({
	onOpenSettings,
	projectId,
	projectName,
}: HeaderSectionProps) {
	const [isShareModalOpen, setIsShareModalOpen] = useState(false);
	const isReadonly = useEditorStore((state) => state.isReadonly);

	return (
		<>
			<div className="h-12 px-3 flex items-center justify-between border-b border-border sticky top-0 bg-background z-10">
				<div className="flex items-center gap-3">
					<UserMenu onOpenProjectSettings={onOpenSettings} />
					{isReadonly && (
						<span className="text-xs bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-200 px-2 py-0.5 rounded">
							View only
						</span>
					)}
				</div>
				<div className="flex items-center gap-2">
					<NotificationBell />
					<button
						type="button"
						className="h-8 px-2 rounded-md bg-button-primary text-white text-xs font-medium disabled:opacity-50"
						onClick={() => setIsShareModalOpen(true)}
						disabled={!projectId}
					>
						Share
					</button>
				</div>
			</div>

			{projectId && projectName && (
				<ShareProjectModal
					isOpen={isShareModalOpen}
					onClose={() => setIsShareModalOpen(false)}
					projectId={projectId}
					projectName={projectName}
				/>
			)}
		</>
	);
});
