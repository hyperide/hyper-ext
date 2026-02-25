import { Button } from './ui/button';

interface SetupTailwindButtonProps {
	onSetupClick: () => void;
}

export function SetupTailwindButton({ onSetupClick }: SetupTailwindButtonProps) {
	return (
		<div className="px-4 py-3 border-t border-gray-200 bg-amber-50">
			<div className="flex flex-col gap-2">
				<Button
					onClick={onSetupClick}
					variant="outline"
					size="sm"
					className="w-full"
				>
					Setup project
				</Button>
				<p className="text-xs text-gray-500 text-center">
					TailwindCSS required
				</p>
			</div>
		</div>
	);
}
