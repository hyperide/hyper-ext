import { useState } from 'react';
import { IconChevronDown, IconSearch, IconListTree } from '@tabler/icons-react';
import cn from 'clsx';
import { Input } from '@/components/ui/input';
import ElementsTree, { type TreeNode } from '../../ElementsTree';

interface ElementsTreeSectionProps {
	collapsed: boolean;
	hasContent: boolean;
	tree: TreeNode[];
	selectedIds: string[];
	hoveredId: string | null;
	onSelectElement: (id: string, event: React.MouseEvent) => void;
	onHoverElement: (id: string | null) => void;
	onOpenPanel?: (id: string) => void;
	onElementPosition?: (id: string, y: number) => void;
	onFunctionNavigate: (loc: { line: number; column: number }) => void;
	onToggle: () => void;
}

export function ElementsTreeSection({
	collapsed,
	hasContent,
	tree,
	selectedIds,
	hoveredId,
	onSelectElement,
	onHoverElement,
	onOpenPanel,
	onElementPosition,
	onFunctionNavigate,
	onToggle,
}: ElementsTreeSectionProps) {
	const [searchVisible, setSearchVisible] = useState(false);
	const [searchQuery, setSearchQuery] = useState('');

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
					<IconListTree className="w-3.5 h-3.5" stroke={1.5} />
					<span className={cn('text-xs font-semibold', {
						'text-foreground': hasContent,
						'text-muted-foreground': !hasContent,
					})}>
						{hasContent ? 'Elements tree' : 'No elements'}
					</span>
				</button>
				{hasContent && (
					<button
						type="button"
						onClick={(e) => { e.stopPropagation(); setSearchVisible(!searchVisible); }}
					>
						<IconSearch className="w-4 h-4" stroke={1.5} />
					</button>
				)}
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
								placeholder="Search elements..."
								className="h-auto border-0 bg-transparent !text-[11px] text-foreground placeholder:text-muted-foreground p-0 focus-visible:ring-0 focus-visible:ring-offset-0 flex-1"
							/>
						</div>
					)}
					<ElementsTree
						tree={tree}
						selectedElements={selectedIds}
						onSelectElement={onSelectElement}
						onOpenPanel={onOpenPanel}
						onHoverElement={onHoverElement}
						hoveredElement={hoveredId}
						onElementPosition={onElementPosition}
						searchQuery={searchQuery}
						onFunctionNavigate={onFunctionNavigate}
					/>
				</div>
			)}
		</div>
	);
}
