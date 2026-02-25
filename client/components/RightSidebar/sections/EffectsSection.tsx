import { memo, useCallback } from 'react';
import { IconPlus } from '@tabler/icons-react';
import type { EffectItem } from '../types';
import { mapShadowSizeToValues, generateBoxShadow } from '../utils';

interface EffectsSectionProps {
	effects: EffectItem[];
	onEffectsChange: (effects: EffectItem[]) => void;
	syncStyleChange: (key: string, value: string) => void;
}

export const EffectsSection = memo(function EffectsSection({
	effects,
	onEffectsChange,
	syncStyleChange,
}: EffectsSectionProps) {
	const handleAddEffect = useCallback(() => {
		const defaultValues = mapShadowSizeToValues('default', 'drop-shadow');
		const newEffect: EffectItem = {
			id: Date.now().toString(),
			visible: true,
			type: 'drop-shadow',
			x: defaultValues.x,
			y: defaultValues.y,
			blur: defaultValues.blur,
			spread: defaultValues.spread,
			color: '#000000',
			opacity: '100',
		};
		onEffectsChange([newEffect]);
		syncStyleChange(
			'boxShadow',
			generateBoxShadow(
				'drop-shadow',
				defaultValues.x,
				defaultValues.y,
				defaultValues.blur,
				defaultValues.spread,
				'#000000',
				'100',
			),
		);
	}, [onEffectsChange, syncStyleChange]);

	const getEffectLabel = (type: EffectItem['type']) => {
		switch (type) {
			case 'drop-shadow':
				return 'Drop shadow';
			case 'inner-shadow':
				return 'Inner shadow';
			case 'blur':
				return 'Blur';
			default:
				return type;
		}
	};

	return (
		<div className="px-4 py-3 border-t border-border max-w-sidebar-section overflow-hidden">
			<div className="flex items-center justify-between mb-3">
				<span
					className={`text-xs font-semibold ${effects.length === 0 ? 'text-muted-foreground hover:text-foreground cursor-pointer transition-colors' : 'text-foreground'}`}
					onClick={() => {
						if (effects.length === 0) {
							handleAddEffect();
						}
					}}
				>
					Effects
				</span>
				<button
					type="button"
					onClick={handleAddEffect}
					className="hover:bg-muted rounded p-0.5"
				>
					<IconPlus className="w-4 h-4" stroke={1.5} />
				</button>
			</div>
			{effects.length > 0 && (
				<div className="text-xs text-muted-foreground">
					{getEffectLabel(effects[0]?.type)}
				</div>
			)}
		</div>
	);
});
