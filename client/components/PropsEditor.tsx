/**
 * Props editor component that generates form based on TypeScript types
 */

import type { ComponentPropsSchema } from '@shared/types/props';
import { IconChevronDown, IconSearch } from '@tabler/icons-react';
import { useCallback, useEffect, useState } from 'react';
import { Input } from '@/components/ui/input';
import { useTamaguiTokens } from '@/hooks/useTamaguiTokens';
import { useCanvasEngine, useSelectedIds } from '@/lib/canvas-engine';
import type { ASTNode } from '@/lib/canvas-engine/types/ast';
import { authFetch } from '@/utils/authFetch';
import { PropsFormField } from './PropsFormField';

export function PropsEditor() {
  const engine = useCanvasEngine();
  const selectedIds = useSelectedIds();
  const { tokens: tamaguiTokens } = useTamaguiTokens();

  const [schema, setSchema] = useState<ComponentPropsSchema | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [propsValues, setPropsValues] = useState<Record<string, unknown>>({});
  const [isExpanded, setIsExpanded] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [showAllProps, setShowAllProps] = useState(false);

  // Get file path from metadata
  const getFilePath = useCallback((): string | null => {
    if (selectedIds.length === 0) {
      return null;
    }

    const root = engine.getRoot();

    // For iframe components: check root.metadata.filePath
    if (root.metadata?.filePath) {
      console.log('[PropsEditor] Found filePath in root:', root.metadata.filePath);
      return root.metadata.filePath as string;
    }

    // For registered components: check children metadata
    const rootChildren = root.children || [];
    for (const childId of rootChildren) {
      const inst = engine.getInstance(childId);
      if (inst?.metadata?.filePath) {
        console.log('[PropsEditor] Found filePath in child:', inst.metadata.filePath);
        return inst.metadata.filePath as string;
      }
    }

    return null;
  }, [selectedIds, engine]);

  // Get selected element from AST
  const getSelectedElementFromAST = useCallback((): ASTNode | null => {
    if (selectedIds.length === 0) return null;

    const selectedId = selectedIds[0];
    const root = engine.getRoot();

    // Helper to find node by id
    const findNodeById = (nodes: ASTNode[], id: string): ASTNode | null => {
      for (const node of nodes) {
        if (node.id === id) return node;
        if (node.children) {
          const found = findNodeById(node.children, id);
          if (found) return found;
        }
      }
      return null;
    };

    // Check root AST
    const rootAst = root.metadata?.astStructure;
    if (Array.isArray(rootAst)) {
      const node = findNodeById(rootAst, selectedId);
      if (node) return node;
    }

    // Check children AST
    const rootChildren = root.children || [];
    for (const childId of rootChildren) {
      const inst = engine.getInstance(childId);
      const childAst = inst?.metadata?.astStructure;
      if (Array.isArray(childAst)) {
        const node = findNodeById(childAst, selectedId);
        if (node) return node;
      }
    }

    return null;
  }, [selectedIds, engine]);

  // Get selected element type from AST
  const getSelectedElementType = useCallback((): string | null => {
    const node = getSelectedElementFromAST();
    return node?.type || null;
  }, [getSelectedElementFromAST]);

  // Load props schema from API
  useEffect(() => {
    console.log('[PropsEditor] useEffect triggered');
    const filePath = getFilePath();
    const elementType = getSelectedElementType();

    console.log('[PropsEditor] FilePath:', filePath);
    console.log('[PropsEditor] ElementType:', elementType);

    if (!filePath || !elementType) {
      setSchema(null);
      setError(null);
      return;
    }

    // Skip HTML elements (lowercase) - they don't have TypeScript types
    // React components start with uppercase, HTML elements with lowercase
    const isHtmlElement = elementType[0] === elementType[0].toLowerCase();
    if (isHtmlElement) {
      console.log('[PropsEditor] Skipping HTML element:', elementType);
      setSchema(null);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);

    // Fetch component props - server will follow imports if needed
    const url = `/api/component-props-types?filePath=${encodeURIComponent(filePath)}&componentName=${encodeURIComponent(elementType)}`;
    console.log('[PropsEditor] Fetching schema from:', url);

    authFetch(url)
      .then((res) => {
        if (!res.ok) {
          // For 404 or 400 errors (component without types), fail silently
          if (res.status === 404 || res.status === 400) {
            console.debug('[PropsEditor] Component has no TypeScript types');
            return { success: false, silent: true };
          }
          throw new Error(`HTTP ${res.status}`);
        }
        return res.json();
      })
      .then((data) => {
        if (data.success) {
          setSchema({
            componentName: data.componentName,
            props: data.props,
          });

          // Initialize props values from AST node
          const astNode = getSelectedElementFromAST();
          console.log('[PropsEditor] AST node:', astNode);
          console.log('[PropsEditor] AST node props:', astNode?.props);
          if (astNode?.props) {
            setPropsValues(astNode.props);
          }
        } else if (!data.silent) {
          setError('Could not load component props');
        }
      })
      .catch((err) => {
        console.error('[PropsEditor] Error loading schema:', err);
        setError('Failed to load props schema');
      })
      .finally(() => {
        setLoading(false);
      });
  }, [selectedIds, engine]);

  // Sync prop change to file
  const syncPropToFile = useCallback(
    (propName: string, value: unknown) => {
      const filePath = getFilePath();
      if (!filePath || selectedIds.length === 0) {
        return;
      }

      // Route through engine for undo/redo support
      engine.updateASTProp(selectedIds[0], filePath, propName, value);
    },
    [getFilePath, selectedIds, engine],
  );

  // Update prop value
  const handlePropChange = useCallback(
    (propName: string, value: unknown) => {
      if (selectedIds.length === 0) return;

      // Update local state for immediate UI feedback
      setPropsValues((prev) => ({
        ...prev,
        [propName]: value,
      }));

      // Sync to file - the file change will trigger re-parse and update the canvas
      syncPropToFile(propName, value);
    },
    [selectedIds, syncPropToFile],
  );

  // Don't show if no file path
  if (!getFilePath()) {
    return null;
  }

  // Loading state
  if (loading) {
    return (
      <div className="px-4 py-3 border-b border-gray-200">
        <div className="flex items-center gap-2 text-[11px] text-gray-400">
          <div className="animate-spin h-3 w-3 border-2 border-gray-400 border-t-transparent rounded-full" />
          Loading props...
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="px-4 py-3 border-b border-gray-200">
        <div className="text-[11px] text-red-500">{error}</div>
      </div>
    );
  }

  // No schema
  if (!schema) {
    return null;
  }

  const propsCount = Object.keys(schema.props).length;

  // No props to edit
  if (propsCount === 0) {
    return (
      <div className="px-4 py-3 border-b border-gray-200">
        <div className="text-[11px] text-gray-400 italic">No editable props</div>
      </div>
    );
  }

  return (
    <div className="px-4 py-3 border-b border-gray-200">
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center justify-between w-full mb-3"
      >
        <span className="text-xs font-semibold text-black">Component Props</span>
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-gray-400">{propsCount}</span>
          <IconChevronDown className={`h-3 w-3 transition-transform text-gray-400 ${isExpanded ? '' : '-rotate-90'}`} />
        </div>
      </button>

      {isExpanded && (
        <div className="space-y-3">
          {/* Search input */}
          {propsCount > 3 && (
            <div className="h-6 px-2 bg-gray-100 rounded flex items-center gap-1.5">
              <IconSearch className="w-3.5 h-3.5 text-gray-400" stroke={1.5} />
              <Input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search props..."
                className="h-auto border-0 bg-transparent !text-[11px] text-gray-800 placeholder:text-gray-500 p-0 focus-visible:ring-0 focus-visible:ring-offset-0 flex-1"
              />
            </div>
          )}

          {/* Filtered props */}
          {(() => {
            const filteredProps = Object.entries(schema.props).filter(([propName]) =>
              propName.toLowerCase().includes(searchQuery.toLowerCase()),
            );

            const N = 8;
            const threshold = N + 2; // 10
            const shouldLimit = filteredProps.length > threshold;
            const displayedProps = shouldLimit && !showAllProps ? filteredProps.slice(0, N) : filteredProps;

            return (
              <>
                {displayedProps.map(([propName, propInfo]) => (
                  <PropsFormField
                    key={propName}
                    name={propName}
                    propInfo={propInfo}
                    value={propsValues[propName]}
                    onChange={(value) => handlePropChange(propName, value)}
                    tamaguiTokens={tamaguiTokens}
                  />
                ))}

                {/* Show all button */}
                {shouldLimit && !showAllProps && (
                  <button
                    type="button"
                    onClick={() => setShowAllProps(true)}
                    className="w-full h-6 px-2 bg-gray-100 hover:bg-gray-200 rounded flex items-center justify-center text-[11px] text-gray-600 font-medium transition-colors"
                  >
                    Show all ({filteredProps.length})
                  </button>
                )}
              </>
            );
          })()}
        </div>
      )}
    </div>
  );
}
