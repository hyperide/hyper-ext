import { IconBinaryTree, IconBraces, IconChevronDown, IconFrame, IconSquareRotated } from '@tabler/icons-react';
import { useEffect, useRef, useState } from 'react';
import type { TreeNode } from '../../lib/types';
import IconSquareRotatedPlus from './icons/IconSquareRotatedPlus';

export type { TreeNode };

interface TreeNodeItemProps {
  node: TreeNode;
  depth: number;
  selectedElements: string[];
  hoveredElement: string | null;
  onSelectElement: (id: string, event: React.MouseEvent | React.KeyboardEvent) => void;
  onOpenPanel?: (id: string) => void;
  onHoverElement: (id: string | null) => void;
  onElementPosition?: (id: string, y: number) => void;
  onFunctionNavigate?: (loc: { line: number; column: number }) => void;
}

function TreeNodeItem({
  node,
  depth,
  selectedElements,
  hoveredElement,
  onSelectElement,
  onOpenPanel,
  onHoverElement,
  onElementPosition,
  onFunctionNavigate,
}: TreeNodeItemProps) {
  const [isCollapsed, setIsCollapsed] = useState(node.collapsed ?? false);
  const elementRef = useRef<HTMLDivElement>(null);
  const hasChildren = node.children && node.children.length > 0;
  const isSelected = selectedElements.includes(node.id);
  const isHovered = hoveredElement === node.id;

  useEffect(() => {
    if (isSelected && elementRef.current && onElementPosition) {
      const rect = elementRef.current.getBoundingClientRect();
      onElementPosition(node.id, rect.top);
    }
  }, [isSelected, node.id, onElementPosition]);

  const getIcon = () => {
    switch (node.type) {
      case 'frame':
        return <IconFrame className="w-3.5 h-3.5 flex-shrink-0" stroke={1.5} />;
      case 'tree':
      case 'map':
        return <IconBinaryTree className="w-3.5 h-3.5 flex-shrink-0" stroke={1.5} />;
      case 'function':
        return <IconBraces className="w-3.5 h-3.5 flex-shrink-0 text-cyan-500" stroke={1.5} />;
      default:
        return <IconSquareRotated className="w-3.5 h-3.5 flex-shrink-0" stroke={1.5} />;
    }
  };

  const handleDoubleClick = (e: React.MouseEvent) => {
    // Double-click on function node navigates to function definition
    if (node.type === 'function' && node.functionLoc && onFunctionNavigate) {
      e.stopPropagation();
      onFunctionNavigate(node.functionLoc.start);
    }
  };

  return (
    <>
      <div
        ref={elementRef}
        className={`h-6 px-2 flex items-center justify-between gap-1.5 rounded hover:bg-muted cursor-pointer ${
          isSelected
            ? 'bg-primary/10 border border-primary/50'
            : isHovered
              ? 'bg-primary/5 border border-primary/30'
              : ''
        }`}
        role="treeitem"
        tabIndex={0}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
        onMouseEnter={() => onHoverElement(node.id)}
        onMouseLeave={() => onHoverElement(null)}
        onClick={(e) => onSelectElement(node.id, e)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onSelectElement(node.id, e);
        }}
        onDoubleClick={handleDoubleClick}
      >
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          {hasChildren ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setIsCollapsed(!isCollapsed);
              }}
              className="flex-shrink-0"
            >
              <IconChevronDown
                className={`w-2 h-2 text-muted-foreground flex-shrink-0 transition-transform ${
                  isCollapsed ? 'rotate-[-90deg]' : ''
                }`}
                stroke={1.5}
              />
            </button>
          ) : (
            <div className="w-2 flex-shrink-0" />
          )}
          {getIcon()}
          <span className="text-xs text-foreground truncate">{node.label}</span>
          {node.name && <span className="text-xs text-foreground truncate">"{node.name}"</span>}
        </div>
        {(isHovered || isSelected) && !node.label.startsWith('svg') && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onOpenPanel?.(node.id);
            }}
            className="flex-shrink-0"
          >
            <IconSquareRotatedPlus className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
      {hasChildren && !isCollapsed && (
        <div>
          {node.children?.map((child) => (
            <TreeNodeItem
              key={child.id}
              node={child}
              depth={depth + 1}
              selectedElements={selectedElements}
              hoveredElement={hoveredElement}
              onSelectElement={onSelectElement}
              onOpenPanel={onOpenPanel}
              onHoverElement={onHoverElement}
              onElementPosition={onElementPosition}
              onFunctionNavigate={onFunctionNavigate}
            />
          ))}
        </div>
      )}
    </>
  );
}

interface ElementsTreeProps {
  tree: TreeNode[];
  selectedElements: string[];
  onSelectElement: (id: string, event: React.MouseEvent | React.KeyboardEvent) => void;
  onOpenPanel?: (id: string) => void;
  onHoverElement?: (id: string | null) => void;
  hoveredElement?: string | null;
  onElementPosition?: (id: string, y: number) => void;
  searchQuery?: string;
  onFunctionNavigate?: (loc: { line: number; column: number }) => void;
}

export default function ElementsTree({
  tree,
  selectedElements,
  onSelectElement,
  onOpenPanel,
  onHoverElement,
  hoveredElement: propHoveredElement,
  onElementPosition,
  searchQuery = '',
  onFunctionNavigate,
}: ElementsTreeProps) {
  // Use prop hoveredElement if provided, otherwise track locally
  const [localHoveredElement, setLocalHoveredElement] = useState<string | null>(null);
  const hoveredElement = propHoveredElement !== undefined ? propHoveredElement : localHoveredElement;

  // Filter tree based on search query
  const filterTree = (nodes: TreeNode[]): TreeNode[] => {
    if (!searchQuery) return nodes;

    const query = searchQuery.toLowerCase();

    const filterNode = (node: TreeNode): TreeNode | null => {
      // Check if current node matches
      const nodeMatches = node.label.toLowerCase().includes(query);

      // Recursively filter children
      const filteredChildren = node.children
        ? node.children.map(filterNode).filter((n): n is TreeNode => n !== null)
        : [];

      // Include node if it matches or has matching children
      if (nodeMatches || filteredChildren.length > 0) {
        return {
          ...node,
          children: filteredChildren.length > 0 ? filteredChildren : node.children,
          // Auto-expand nodes when searching
          collapsed: searchQuery ? false : node.collapsed,
        };
      }

      return null;
    };

    return nodes.map(filterNode).filter((n): n is TreeNode => n !== null);
  };

  const filteredTree = filterTree(tree);

  const handleHoverElement = (id: string | null) => {
    // Update local state if we're not using prop
    if (propHoveredElement === undefined) {
      setLocalHoveredElement(id);
    }
    // Always notify parent
    onHoverElement?.(id);
  };

  return (
    <div className="flex flex-col gap-1 px-2">
      {filteredTree.map((node) => (
        <TreeNodeItem
          key={node.id}
          node={node}
          depth={0}
          selectedElements={selectedElements}
          hoveredElement={hoveredElement}
          onSelectElement={onSelectElement}
          onOpenPanel={onOpenPanel}
          onHoverElement={handleHoverElement}
          onElementPosition={onElementPosition}
          onFunctionNavigate={onFunctionNavigate}
        />
      ))}
    </div>
  );
}
