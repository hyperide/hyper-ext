import { memo } from 'react';
import { ColorCombobox } from '../../ui/color-combobox';
import { FillPicker, type FillMode } from '../../ui/fill-picker';
import { Input } from '../../ui/input';
import type { UIKitType } from '../types';
import { hexWithAlpha } from '../utils';

interface FillSectionProps {
	backgroundColor: string;
	fillOpacity: string;
	backgroundImage: string | null;
	textColor: string;
	fillMode: FillMode;
	projectUIKit: UIKitType;
	publicDirExists: boolean;
	activeProjectId: string | null;
	onBackgroundColorChange: (value: string) => void;
	onFillOpacityChange: (value: string) => void;
	onBackgroundImageChange: (path: string | null) => void;
	onTextColorChange: (value: string) => void;
	onFillModeChange: (mode: FillMode) => void;
	syncStyleChange: (key: string, value: string) => void;
}

export const FillSection = memo(function FillSection({
	backgroundColor,
	fillOpacity,
	backgroundImage,
	textColor,
	fillMode,
	projectUIKit,
	publicDirExists,
	activeProjectId,
	onBackgroundColorChange,
	onFillOpacityChange,
	onBackgroundImageChange,
	onTextColorChange,
	onFillModeChange,
	syncStyleChange,
}: FillSectionProps) {
	const handleColorChange = (val: string) => {
		onBackgroundColorChange(val);
		if (val?.startsWith('#')) {
			const opacityValue = fillOpacity || '100';
			const colorWithAlpha =
				opacityValue !== '100' ? hexWithAlpha(val, opacityValue) : val;
			syncStyleChange('backgroundColor', colorWithAlpha);
			if (!fillOpacity) {
				onFillOpacityChange('100');
			}
		} else {
			syncStyleChange('backgroundColor', val);
			if (projectUIKit === 'tamagui') {
				onFillOpacityChange('');
			}
		}
		if (val && backgroundImage) {
			onBackgroundImageChange(null);
			syncStyleChange('backgroundImage', '');
		}
	};

	const handleImageChange = (path: string | null) => {
		onBackgroundImageChange(path);
		syncStyleChange('backgroundImage', path || '');
		if (path && backgroundColor) {
			onBackgroundColorChange('');
			syncStyleChange('backgroundColor', '');
		}
	};

	const handleFillOpacityChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		const value = e.target.value.replace('%', '').trim(); // nosemgrep: incomplete-sanitization -- stripping '%' from CSS opacity input, not security sanitization
		onFillOpacityChange(value);
		if (backgroundColor?.startsWith('#')) {
			const colorWithAlpha = hexWithAlpha(backgroundColor, value || '100');
			syncStyleChange('backgroundColor', colorWithAlpha);
		}
	};

	const handleFillOpacityKeyDown = (
		e: React.KeyboardEvent<HTMLInputElement>,
	) => {
		if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
		e.preventDefault();
		const increment = e.key === 'ArrowUp' ? 1 : -1;
		const step = e.shiftKey || e.altKey ? 10 : 1;
		const num = Number.parseFloat(fillOpacity || '100') || 0;
		const newNum = Math.max(0, Math.min(100, num + increment * step));
		onFillOpacityChange(`${newNum}`);
		if (backgroundColor?.startsWith('#')) {
			const colorWithAlpha = hexWithAlpha(backgroundColor, `${newNum}`);
			syncStyleChange('backgroundColor', colorWithAlpha);
		}
	};

	return (
		<div
			data-uniq-id="2f95e299-d823-4ec1-ba66-9d71ab8c8074"
			className="px-4 py-3 border-t border-border max-w-sidebar-section overflow-hidden"
		>
			<div
				data-uniq-id="42945982-1ada-4134-8f07-5756a6c5f2de"
				className="flex items-center justify-between mb-3"
			>
				<span
					data-uniq-id="344f7abc-528e-43a9-b6f0-9146899c1566"
					className="text-xs font-semibold text-foreground"
				>
					Fill
				</span>
			</div>
			<div
				data-uniq-id="15b6a55d-3b27-4f99-91b2-a894945e244b"
				className="flex items-center gap-2"
			>
				<div
					data-uniq-id="f16a5fbc-a44e-4bf2-9f47-b3b761107f3c"
					className="flex items-end gap-px flex-1"
				>
					<FillPicker
						data-uniq-id="d86f7556-47ca-4162-94e1-70539c34dfd0"
						colorValue={backgroundColor || ''}
						onColorChange={handleColorChange}
						tokenSystem={projectUIKit === 'tamagui' ? 'tamagui' : 'tailwind'}
						imageValue={backgroundImage}
						onImageChange={handleImageChange}
						mode={fillMode}
						onModeChange={onFillModeChange}
						publicDirExists={publicDirExists}
						projectId={activeProjectId || ''}
						inputPlaceholder="transparent"
						className="flex-1"
						beforeUnlinkSlot={
							fillMode === 'color' &&
							backgroundColor &&
							(projectUIKit !== 'tamagui' ||
								backgroundColor.startsWith('#')) ? (
								<div className="h-6 w-14 px-2 bg-muted rounded flex items-center">
									<Input
										type="text"
										value={`${fillOpacity || '100'}%`}
										placeholder="100%"
										onChange={handleFillOpacityChange}
										onKeyDown={handleFillOpacityKeyDown}
										className="h-auto border-0 bg-transparent !text-[11px] text-foreground p-0 focus-visible:ring-0 focus-visible:ring-offset-0 flex-1 text-center"
									/>
								</div>
							) : undefined
						}
					/>
				</div>
			</div>
			{/* Text Color */}
			<div
				data-uniq-id="885cbe9f-d98b-442f-b5ad-bf282bc55810"
				className="flex flex-col gap-2 mt-4"
			>
				<span
					data-uniq-id="332590c5-dc7d-462d-96fd-22ea5d625953"
					className="text-xs text-muted-foreground min-w-[60px]"
				>
					Text
				</span>
				<ColorCombobox
					data-uniq-id="d59ad045-1334-475e-b11c-440bc0539261"
					value={textColor || ''}
					onChange={(val) => {
						onTextColorChange(val);
						syncStyleChange('color', val);
					}}
					inputPlaceholder="000000"
					className="w-sidebar-content"
					tokenSystem={projectUIKit === 'tamagui' ? 'tamagui' : 'tailwind'}
				/>
			</div>
		</div>
	);
});

export const SampleDefault = () => {
	return (
		<FillSection
			backgroundColor="#ffffff"
			fillOpacity="90"
			backgroundImage="/assets/wood-texture.png"
			textColor="#333333"
			fillMode="color"
			projectUIKit="tailwind"
			publicDirExists={true}
			activeProjectId="proj-abc-123"
			onBackgroundColorChange={(value) =>
				console.log('Background color changed:', value)
			}
			onFillOpacityChange={(value) =>
				console.log('Fill opacity changed:', value)
			}
			onBackgroundImageChange={(path) =>
				console.log('Background image changed:', path)
			}
			onTextColorChange={(value) => console.log('Text color changed:', value)}
			onFillModeChange={(mode) => console.log('Fill mode changed:', mode)}
			syncStyleChange={(key, value) =>
				console.log(`Style synchronized: ${key} = ${value}`) // nosemgrep: unsafe-formatstring -- JS template literal, not a format string
			}
		/>
	);
};
