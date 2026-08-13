/**
 * Props editor — a TypeScript-type-driven form for the selected element's component props,
 * with Tamagui design-token autocomplete (color/size/space datalists).
 *
 * Accessed via: RightSidebar inspector body (PropsSection), in BOTH realms — the SaaS web
 * client and the VS Code extension right panel (HYP-709).
 *
 * Assumptions: every environment-backed dependency (selection + selected AST node, props schema,
 * Tamagui tokens, prop writes) is sourced through the platform-converged seam in
 * `@/hooks/usePropsEditorSource`. This component holds NO direct `useCanvasEngine`/`authFetch`
 * coupling, so it renders identically in both realms — see that file's header for the seam map.
 */

import { IconChevronDown, IconSearch } from '@tabler/icons-react';
import { useEffect, useState } from 'react';
import { Input } from '@/components/ui/input';
import type { PropColorUIKit } from '@/components/ui/prop-color-field';
import {
  usePropsEditorSelection,
  usePropsSchemaSource,
  usePropWriter,
  useTamaguiTokensSource,
} from '@/hooks/usePropsEditorSource';
import { PropsFormField } from './PropsFormField';

interface PropsEditorProps {
  /** Project UI kit — drives the themed color control for color-category props. */
  uiKit?: PropColorUIKit;
  /** Source file of the selected component — passed to the color control. */
  componentPath?: string | null;
}

export function PropsEditor({ uiKit = 'none', componentPath }: PropsEditorProps = {}) {
  const { selectedId, filePath, elementType, astNode } = usePropsEditorSelection();
  const { tokens: tamaguiTokens } = useTamaguiTokensSource();
  const { schema, loading, error } = usePropsSchemaSource(filePath, elementType);
  const writeProp = usePropWriter(selectedId, filePath);

  const [propsValues, setPropsValues] = useState<Record<string, unknown>>({});
  const [isExpanded, setIsExpanded] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [showAllProps, setShowAllProps] = useState(false);

  // Seed the form's local values from the selected element's AST node whenever a schema
  // resolves for a new selection. Optimistic local state: edits update here immediately while
  // the async write round-trips (esp. the ext host roundtrip), then reconcile when the next
  // astNode arrives. Keyed by selectedId so switching elements re-seeds.
  // biome-ignore lint/correctness/useExhaustiveDependencies: schema presence + selectedId are the intended re-seed triggers; astNode is read at seed time only.
  useEffect(() => {
    if (schema && astNode?.props) {
      setPropsValues(astNode.props);
    } else if (!schema) {
      setPropsValues({});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schema, selectedId]);

  const handlePropChange = (propName: string, value: unknown) => {
    if (!selectedId) return;
    // Update local state for immediate UI feedback, then sync to the source file.
    setPropsValues((prev) => ({ ...prev, [propName]: value }));
    writeProp(propName, value);
  };

  // Don't show if no file path for the selection.
  if (!filePath) {
    return null;
  }

  // Loading state
  if (loading) {
    return (
      <div data-testid="PropsEditor" className="px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <div className="animate-spin h-3 w-3 border-2 border-muted-foreground border-t-transparent rounded-full" />
          Loading props...
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="px-4 py-3 border-b border-border">
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
      <div data-testid="PropsEditor" className="px-4 py-3 border-b border-border">
        <div className="text-[11px] text-muted-foreground italic">No editable props</div>
      </div>
    );
  }

  return (
    <div data-testid="PropsEditor" className="px-4 py-3 border-b border-border">
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center justify-between w-full mb-3"
      >
        <span className="text-xs font-semibold text-foreground">Component Props</span>
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-muted-foreground">{propsCount}</span>
          <IconChevronDown
            className={`h-3 w-3 transition-transform text-muted-foreground ${isExpanded ? '' : '-rotate-90'}`}
          />
        </div>
      </button>

      {isExpanded && (
        <div className="space-y-3">
          {/* Search input */}
          {propsCount > 3 && (
            <div className="h-6 px-2 bg-muted rounded flex items-center gap-1.5">
              <IconSearch className="w-3.5 h-3.5 text-muted-foreground" stroke={1.5} />
              <Input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search props..."
                className="h-auto border-0 bg-transparent !text-[11px] text-foreground placeholder:text-muted-foreground p-0 focus-visible:ring-0 focus-visible:ring-offset-0 flex-1"
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
                    uiKit={uiKit}
                    engine={null}
                    componentPath={componentPath}
                  />
                ))}

                {/* Show all button */}
                {shouldLimit && !showAllProps && (
                  <button
                    type="button"
                    onClick={() => setShowAllProps(true)}
                    className="w-full h-6 px-2 bg-muted hover:bg-accent rounded flex items-center justify-center text-[11px] text-muted-foreground font-medium transition-colors"
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
