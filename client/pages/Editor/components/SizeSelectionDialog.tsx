import { memo, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import {
	AlertDialog,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { SIZE_PRESETS } from '@/components/RightSidebar/constants';

interface SizeSelectionDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onSelectSize: (width: number, height: number) => void;
}

/**
 * Dialog for selecting viewport size before adding comments.
 * Shown when user tries to add comment with Auto size.
 */
export const SizeSelectionDialog = memo(function SizeSelectionDialog({
	open,
	onOpenChange,
	onSelectSize,
}: SizeSelectionDialogProps) {
	const handleOpenChange = useCallback(
		(newOpen: boolean) => {
			if (!newOpen) {
				onOpenChange(false);
			}
		},
		[onOpenChange],
	);

	return (
		<AlertDialog open={open} onOpenChange={handleOpenChange}>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>Select viewport size</AlertDialogTitle>
					<AlertDialogDescription>
						To add comments, please select a viewport size first. This ensures
						comments stay in the correct position.
					</AlertDialogDescription>
				</AlertDialogHeader>
				<div className="grid grid-cols-2 gap-2 py-4">
					{SIZE_PRESETS.map((preset) => (
						<Button
							key={preset.label}
							variant="outline"
							className="justify-start"
							onClick={() => onSelectSize(preset.width, preset.height)}
						>
							{preset.label}
							<span className="ml-auto text-xs text-muted-foreground">
								{preset.width}×{preset.height}
							</span>
						</Button>
					))}
				</div>
				<AlertDialogFooter>
					<AlertDialogCancel>Cancel</AlertDialogCancel>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
});
