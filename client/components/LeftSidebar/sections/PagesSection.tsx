import { useState } from 'react';
import { IconChevronDown, IconPlus, IconSearch } from '@tabler/icons-react';
import cn from 'clsx';
import { Input } from '@/components/ui/input';
import { ComponentGroupList } from '../../ComponentGroupList';
import type { ComponentGroup, ComponentListItem } from '../../../../lib/component-scanner/types';

interface PagesSectionProps {
	collapsed: boolean;
	hasContent: boolean;
	groups: ComponentGroup[];
	activePath: string | null;
	loadingComponent: string | null;
	onComponentClick: (component: ComponentListItem) => void;
	onToggle: () => void;
	onCreatePage?: () => void;
	isVSCode: boolean;
}

export function PagesSection({
	collapsed,
	hasContent,
	groups,
	activePath,
	loadingComponent,
	onComponentClick,
	onToggle,
	onCreatePage,
	isVSCode,
}: PagesSectionProps) {
	const [searchVisible, setSearchVisible] = useState(false);
	const [searchQuery, setSearchQuery] = useState('');

	const filteredGroups = searchQuery
		? groups
				.map((group) => ({
					...group,
					components: group.components.filter((comp) =>
						comp.name.toLowerCase().includes(searchQuery.toLowerCase()),
					),
				}))
				.filter((group) => group.components.length > 0)
		: groups;

	const hasFilteredContent = filteredGroups.length > 0;

	return (
		<div className="h-full overflow-hidden flex flex-col">
			<div className="h-6 px-2 flex items-center justify-between bg-muted border-t border-border w-full shrink-0">
				<button
					type="button"
					onClick={onToggle}
					className="flex items-center gap-1 flex-1"
					disabled={!hasContent}
				>
					<IconChevronDown
						className={cn('w-3 h-3 transition-transform duration-200', {
							'rotate-[-90deg]': collapsed || !hasContent,
						})}
						stroke={1.5}
					/>
					<span className={cn('text-xs font-semibold', {
						'text-foreground': hasContent,
						'text-muted-foreground': !hasContent,
					})}>
						{hasContent ? 'Pages' : 'No pages'}
					</span>
				</button>
				<div className="flex items-center gap-1.5">
					{!isVSCode && (
						<button type="button" onClick={(e) => { e.stopPropagation(); onCreatePage?.(); }}>
							<IconPlus className="w-4 h-4" stroke={1.5} />
						</button>
					)}
					{hasContent && (
						<button
							type="button"
							onClick={(e) => { e.stopPropagation(); setSearchVisible(!searchVisible); }}
						>
							<IconSearch className="w-4 h-4" stroke={1.5} />
						</button>
					)}
				</div>
			</div>
			{!collapsed && hasContent && (
				<div className="flex-1 overflow-y-auto flex flex-col gap-2.5">
					{searchVisible && (
						<div className="h-6 px-2 bg-muted rounded flex items-center gap-1.5 mx-2 mt-2">
							<IconSearch className="w-3.5 h-3.5 text-muted-foreground" stroke={1.5} />
							<Input
								type="text"
								value={searchQuery}
								onChange={(e) => setSearchQuery(e.target.value)}
								placeholder="Search pages..."
								className="h-auto border-0 bg-transparent !text-[11px] text-foreground placeholder:text-muted-foreground p-0 focus-visible:ring-0 focus-visible:ring-offset-0 flex-1"
							/>
						</div>
					)}
					<div className="flex flex-col px-2">
						<ComponentGroupList
							groups={filteredGroups}
							activeComponentPath={activePath}
							loadingComponentPath={loadingComponent}
							onComponentClick={onComponentClick}
						/>
					</div>
				</div>
			)}
		</div>
	);
}
