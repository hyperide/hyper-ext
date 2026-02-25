import * as React from 'react';
import {
	IconCheck,
	IconChevronDown,
	IconLink,
	IconLinkOff,
} from '@tabler/icons-react';
import cn from 'clsx';
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from '@/components/ui/popover';
import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from '@/components/ui/command';
import { Input } from '@/components/ui/input';
import {
	TAILWIND_COLORS,
	getColorNames,
	getColorHex,
} from '@/lib/tailwind/tailwind-values';
import {
	TAMAGUI_COLORS,
	TAMAGUI_SEMANTIC_TOKENS,
	getTamaguiColorNames,
	getTamaguiSemanticNames,
	getTamaguiColorHex,
	getTamaguiTokenFromHex,
	findClosestTamaguiColor,
} from '@/lib/tamagui/tamagui-values';

export type TokenSystem = 'tailwind' | 'tamagui';

interface ColorComboboxProps {
	value: string; // hex color value or token
	onChange: (value: string) => void; // Returns hex for tailwind, $token for tamagui
	placeholder?: string;
	inputPlaceholder?: string;
	className?: string;
	tokenSystem: TokenSystem;
	/** Slot to render content between color picker and unlink button (e.g., opacity input) */
	beforeUnlinkSlot?: React.ReactNode;
	/** Whether the value is currently a hex color (unlinked from tokens) */
	isUnlinked?: boolean;
}

type ColorShades = Record<string, string>;

interface ColorOption {
	value: string; // token like 'blue-500' or 'blue9'
	hex: string;
	label: string;
	colorName: string;
}

/**
 * Get token class from hex value based on system
 */
function getTokenFromHex(hex: string, system: TokenSystem): string | null {
	if (!hex) return null;
	const normalizedHex = hex.toLowerCase();

	if (system === 'tamagui') {
		return getTamaguiTokenFromHex(normalizedHex);
	}

	// Tailwind
	if (normalizedHex === '#ffffff') return 'white';
	if (normalizedHex === '#000000') return 'black';
	if (normalizedHex === 'transparent') return 'transparent';

	const colorNames = getColorNames();
	for (const colorName of colorNames) {
		const colorData =
			TAILWIND_COLORS[colorName as keyof typeof TAILWIND_COLORS];
		if (typeof colorData === 'string') continue;

		for (const [shade, shadeHex] of Object.entries(colorData as ColorShades)) {
			if (shadeHex.toLowerCase() === normalizedHex) {
				return `${colorName}-${shade}`;
			}
		}
	}

	return null;
}

/**
 * Get hex from token based on system
 */
function getHexFromToken(token: string, system: TokenSystem): string | null {
	if (system === 'tamagui') {
		return getTamaguiColorHex(token);
	}
	return getColorHex(token);
}

/**
 * Find closest color in the system
 */
function findClosestColor(
	hex: string,
	system: TokenSystem,
): { token: string; hex: string } | null {
	if (!hex) return null;

	if (system === 'tamagui') {
		return findClosestTamaguiColor(hex);
	}

	// Tailwind - simplified closest color search
	function hexToRgb(h: string): { r: number; g: number; b: number } | null {
		const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(h);
		return result
			? {
					r: Number.parseInt(result[1], 16),
					g: Number.parseInt(result[2], 16),
					b: Number.parseInt(result[3], 16),
				}
			: null;
	}

	function colorDistance(hex1: string, hex2: string): number {
		const rgb1 = hexToRgb(hex1);
		const rgb2 = hexToRgb(hex2);
		if (!rgb1 || !rgb2) return Infinity;
		return Math.sqrt(
			(rgb1.r - rgb2.r) ** 2 + (rgb1.g - rgb2.g) ** 2 + (rgb1.b - rgb2.b) ** 2,
		);
	}

	let closestToken = '';
	let closestHex = '';
	let minDistance = Infinity;

	// Check special colors
	for (const special of [
		{ token: 'white', hex: '#ffffff' },
		{ token: 'black', hex: '#000000' },
	]) {
		const distance = colorDistance(hex, special.hex);
		if (distance < minDistance) {
			minDistance = distance;
			closestToken = special.token;
			closestHex = special.hex;
		}
	}

	// Check all palette colors
	const colorNames = getColorNames();
	for (const colorName of colorNames) {
		const colorData =
			TAILWIND_COLORS[colorName as keyof typeof TAILWIND_COLORS];
		if (typeof colorData === 'string') continue;

		for (const [shade, shadeHex] of Object.entries(colorData as ColorShades)) {
			const distance = colorDistance(hex, shadeHex);
			if (distance < minDistance) {
				minDistance = distance;
				closestToken = `${colorName}-${shade}`;
				closestHex = shadeHex;
			}
		}
	}

	return closestToken ? { token: closestToken, hex: closestHex } : null;
}

/**
 * Generate color options based on token system
 */
function generateColorOptions(system: TokenSystem): ColorOption[] {
	const options: ColorOption[] = [];

	if (system === 'tamagui') {
		// Add semantic tokens first (color, background)
		const semanticNames = getTamaguiSemanticNames();
		for (const semanticName of semanticNames) {
			const semanticData =
				TAMAGUI_SEMANTIC_TOKENS[
					semanticName as keyof typeof TAMAGUI_SEMANTIC_TOKENS
				];
			for (const [shade, hex] of Object.entries(semanticData)) {
				options.push({
					value: `${semanticName}${shade}`,
					hex,
					label: `${semanticName}${shade}`,
					colorName: `_${semanticName}`, // Prefix with _ to sort before palette colors
				});
			}
		}

		// Add palette colors
		const colorNames = getTamaguiColorNames();
		for (const colorName of colorNames) {
			const colorData =
				TAMAGUI_COLORS[colorName as keyof typeof TAMAGUI_COLORS];
			for (const [shade, hex] of Object.entries(colorData)) {
				options.push({
					value: `${colorName}${shade}`,
					hex,
					label: `${colorName}${shade}`,
					colorName,
				});
			}
		}
	} else {
		// Tailwind
		options.push({
			value: 'white',
			hex: '#ffffff',
			label: 'White',
			colorName: 'special',
		});
		options.push({
			value: 'black',
			hex: '#000000',
			label: 'Black',
			colorName: 'special',
		});

		const colorNames = getColorNames();
		for (const colorName of colorNames) {
			const colorData =
				TAILWIND_COLORS[colorName as keyof typeof TAILWIND_COLORS];
			if (typeof colorData === 'string') continue;

			for (const [shade, hex] of Object.entries(colorData as ColorShades)) {
				options.push({
					value: `${colorName}-${shade}`,
					hex,
					label: `${colorName}-${shade}`,
					colorName,
				});
			}
		}
	}

	return options;
}

/**
 * Group colors by color name
 */
function getColorGroups(options: ColorOption[]): Record<string, ColorOption[]> {
	const groups: Record<string, ColorOption[]> = {};

	for (const option of options) {
		if (!groups[option.colorName]) {
			groups[option.colorName] = [];
		}
		groups[option.colorName].push(option);
	}

	return groups;
}

export function ColorCombobox({
	value,
	onChange,
	placeholder = 'Select color...',
	inputPlaceholder = 'none',
	className,
	tokenSystem,
	beforeUnlinkSlot,
	isUnlinked: controlledIsUnlinked,
}: ColorComboboxProps) {
	const [open, setOpen] = React.useState(false);
	const [search, setSearch] = React.useState('');

	// Generate options based on token system
	const colorOptions = React.useMemo(
		() => generateColorOptions(tokenSystem),
		[tokenSystem],
	);
	const colorGroups = React.useMemo(
		() => getColorGroups(colorOptions),
		[colorOptions],
	);

	// Linked mode: true = use tokens, false = arbitrary hex
	// Can be controlled via isUnlinked prop or determined from value
	const [internalIsLinked, setInternalIsLinked] = React.useState(() => {
		if (!value) return true;
		// For Tamagui, check if value starts with $
		if (tokenSystem === 'tamagui' && value.startsWith('$')) return true;
		// Check if value matches a token
		return !!getTokenFromHex(value, tokenSystem);
	});

	// Use controlled state if provided, otherwise use internal state
	const isLinked =
		controlledIsUnlinked !== undefined
			? !controlledIsUnlinked
			: internalIsLinked;
	const setIsLinked = (linked: boolean) => setInternalIsLinked(linked);

	// Get current hex value (convert token to hex if needed)
	const currentHex = React.useMemo(() => {
		if (!value) return '';
		if (value.startsWith('#')) return value;
		// For Tamagui tokens starting with $
		if (tokenSystem === 'tamagui' && value.startsWith('$')) {
			return getTamaguiColorHex(value) || value;
		}
		// Try to get hex from token
		return getHexFromToken(value, tokenSystem) || value;
	}, [value, tokenSystem]);

	// Find current token from value
	const currentToken = React.useMemo(() => {
		if (!value) return null;
		// If value is already a token (Tamagui with $)
		if (tokenSystem === 'tamagui' && value.startsWith('$')) {
			return value.slice(1);
		}
		// Try to find token from hex
		return getTokenFromHex(
			value.startsWith('#') ? value : currentHex,
			tokenSystem,
		);
	}, [value, currentHex, tokenSystem]);

	// Filter colors based on search
	const filteredGroups = React.useMemo(() => {
		if (!search.trim()) return colorGroups;

		const query = search.toLowerCase().trim();
		const filtered: Record<string, ColorOption[]> = {};

		for (const [groupName, options] of Object.entries(colorGroups)) {
			const groupMatches = groupName.toLowerCase().includes(query);

			if (groupMatches) {
				filtered[groupName] = options;
			} else {
				const matchingColors = options.filter(
					(opt) =>
						opt.value.toLowerCase().includes(query) ||
						opt.label.toLowerCase().includes(query),
				);
				if (matchingColors.length > 0) {
					filtered[groupName] = matchingColors;
				}
			}
		}

		return filtered;
	}, [search, colorGroups]);

	const handleSelect = (token: string) => {
		const hex = getHexFromToken(token, tokenSystem);
		if (hex) {
			// For Tamagui, return $token format
			if (tokenSystem === 'tamagui') {
				onChange(`$${token}`);
			} else {
				onChange(hex);
			}
		}
		setOpen(false);
		setSearch('');
	};

	const handleUnlinkToggle = () => {
		if (isLinked) {
			// Unlinking - switch to hex mode and emit current hex value
			setIsLinked(false);
			if (currentHex) {
				onChange(currentHex);
			}
		} else {
			// Linking - find closest token
			if (currentHex) {
				const closest = findClosestColor(currentHex, tokenSystem);
				if (closest) {
					if (tokenSystem === 'tamagui') {
						onChange(`$${closest.token}`);
					} else {
						onChange(closest.hex);
					}
				}
			}
			setIsLinked(true);
		}
	};

	const handleHexInput = (inputValue: string) => {
		let hex = inputValue.trim();
		if (!hex.startsWith('#') && hex.length > 0) {
			hex = `#${hex}`;
		}
		if (/^#[0-9a-fA-F]{6}$/.test(hex) || /^#[0-9a-fA-F]{3}$/.test(hex)) {
			onChange(hex);
		} else if (hex === '' || hex === '#') {
			onChange('');
		}
	};

	const hasResults = Object.keys(filteredGroups).length > 0;
	const isSearching = search.trim().length > 0;
	const displayHex = currentHex?.replace('#', '') || '';

	return (
		<div className={cn('flex items-center gap-0.5', className)}>
			{isLinked ? (
				<Popover
					open={open}
					onOpenChange={(isOpen) => {
						setOpen(isOpen);
						if (!isOpen) setSearch('');
					}}
				>
					<PopoverTrigger asChild>
						<button
							type="button"
							role="combobox"
							aria-expanded={open}
							className="flex items-center gap-1.5 h-6 px-2 bg-muted rounded-l text-xs hover:bg-accent transition-colors flex-1"
						>
							<div
								className="w-3 h-3 rounded border border-border shrink-0"
								style={{ backgroundColor: currentHex || 'transparent' }}
							/>
							<span className="text-foreground truncate flex-1 text-left">
								{currentToken
									? tokenSystem === 'tamagui'
										? `$${currentToken}`
										: currentToken
									: inputPlaceholder}
							</span>
							<IconChevronDown
								className="w-3 h-3 text-muted-foreground shrink-0"
								stroke={1.5}
							/>
						</button>
					</PopoverTrigger>
					<PopoverContent className="w-[280px] p-0" align="start">
						<Command shouldFilter={false}>
							<CommandInput
								placeholder="Search colors..."
								className="h-9"
								value={search}
								onValueChange={setSearch}
							/>
							<CommandList className="max-h-[300px]">
								{!hasResults && <CommandEmpty>No color found.</CommandEmpty>}

								{isSearching ? (
									<>
										{Object.entries(filteredGroups).map(
											([groupName, options]) => (
												<CommandGroup
													key={groupName}
													heading={
														groupName === 'special'
															? 'Basic'
															: groupName.charAt(0).toUpperCase() +
																groupName.slice(1)
													}
												>
													{options.map((option) => (
														<CommandItem
															key={option.value}
															value={option.value}
															onSelect={() => handleSelect(option.value)}
															className="flex items-center gap-2 cursor-pointer"
														>
															<div
																className="w-4 h-4 rounded border border-border shrink-0"
																style={{ backgroundColor: option.hex }}
															/>
															<span className="flex-1 text-xs">
																{tokenSystem === 'tamagui'
																	? `$${option.label}`
																	: option.label}
															</span>
															{currentToken === option.value && (
																<IconCheck
																	className="w-4 h-4 text-green-600 shrink-0"
																	stroke={2}
																/>
															)}
														</CommandItem>
													))}
												</CommandGroup>
											),
										)}
									</>
								) : (
									<>
										{/* Special colors group (Tailwind only) */}
										{tokenSystem === 'tailwind' && filteredGroups.special && (
											<CommandGroup heading="Basic">
												{filteredGroups.special.map((option) => (
													<CommandItem
														key={option.value}
														value={option.value}
														onSelect={() => handleSelect(option.value)}
														className="flex items-center gap-2 cursor-pointer"
													>
														<div
															className="w-4 h-4 rounded border border-border"
															style={{ backgroundColor: option.hex }}
														/>
														<span className="flex-1 text-xs">
															{option.label}
														</span>
														{currentToken === option.value && (
															<IconCheck
																className="w-4 h-4 text-green-600"
																stroke={2}
															/>
														)}
													</CommandItem>
												))}
											</CommandGroup>
										)}

										{/* Color palette groups - grid view */}
										{Object.entries(filteredGroups)
											.filter(([name]) => name !== 'special')
											.map(([colorName, options]) => (
												<CommandGroup
													key={colorName}
													heading={
														colorName.charAt(0).toUpperCase() +
														colorName.slice(1)
													}
												>
													<div
														className={cn(
															'grid gap-0.5 p-1',
															tokenSystem === 'tamagui'
																? 'grid-cols-12'
																: 'grid-cols-11',
														)}
													>
														{options.map((option) => (
															<button
																key={option.value}
																type="button"
																onClick={() => handleSelect(option.value)}
																title={
																	tokenSystem === 'tamagui'
																		? `$${option.value}`
																		: option.value
																}
																className={cn(
																	'w-5 h-5 rounded border transition-all hover:scale-110 hover:z-10',
																	currentToken === option.value
																		? 'border-foreground ring-1 ring-foreground ring-offset-1 ring-offset-background'
																		: 'border-border hover:border-muted-foreground',
																)}
																style={{ backgroundColor: option.hex }}
															/>
														))}
													</div>
												</CommandGroup>
											))}
									</>
								)}
							</CommandList>
						</Command>
					</PopoverContent>
				</Popover>
			) : (
				<div className="flex items-center gap-0 h-6 bg-muted rounded-l flex-1">
					<label className="relative cursor-pointer px-2">
						<input
							type="color"
							value={currentHex || '#000000'}
							onChange={(e) => onChange(e.target.value)}
							className="absolute opacity-0 w-0 h-0"
						/>
						<div
							className="w-3 h-3 rounded border border-border cursor-pointer"
							style={{ backgroundColor: currentHex || 'transparent' }}
						/>
					</label>
					<Input
						type="text"
						value={displayHex}
						placeholder={inputPlaceholder}
						onChange={(e) => handleHexInput(e.target.value)}
						className="h-6 border-0 bg-transparent !text-[11px] text-foreground p-0 px-1 focus-visible:ring-0 focus-visible:ring-offset-0 flex-1 font-mono"
					/>
				</div>
			)}

			{/* Slot for additional controls (e.g., opacity input) */}
			{beforeUnlinkSlot}

			<button
				type="button"
				onClick={handleUnlinkToggle}
				title={
					isLinked
						? `Unlink from ${tokenSystem} tokens`
						: `Link to nearest ${tokenSystem} token`
				}
				className={cn(
					'h-6 px-1.5 flex items-center justify-center transition-colors',
					beforeUnlinkSlot ? 'rounded' : 'rounded-r',
					isLinked
						? 'bg-muted hover:bg-accent text-muted-foreground'
						: 'bg-amber-100 hover:bg-amber-200 text-amber-700 dark:bg-amber-900/50 dark:hover:bg-amber-900 dark:text-amber-400',
				)}
			>
				{isLinked ? (
					<IconLink className="w-3.5 h-3.5" stroke={1.5} />
				) : (
					<IconLinkOff className="w-3.5 h-3.5" stroke={1.5} />
				)}
			</button>
		</div>
	);
}
