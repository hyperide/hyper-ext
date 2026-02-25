import { IconChevronDown, IconComponents, IconSearch, IconTrash, IconX } from '@tabler/icons-react';
import { useEffect, useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useComponentMeta } from '@/contexts/ComponentMetaContext';
import { useCanvasEngine } from '@/lib/canvas-engine';
import type { ComponentDefinition, FieldsMap } from '@/lib/canvas-engine/models/types';
import { authFetch } from '@/utils/authFetch';
import type { NestedComponent } from '../../shared/api';

interface ComponentNavigatorPanelProps {
  onClose?: () => void;
  elementY?: number;
  onComponentClick?: (componentType: string) => void;
  selectedComponentType?: string | null;
  onSelectComponent?: (type: string) => void;
}

export function ComponentNavigatorPanel({
  onClose,
  elementY = 0,
  onComponentClick,
  selectedComponentType,
  onSelectComponent,
}: ComponentNavigatorPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [topPosition, setTopPosition] = useState<number>(0);
  const engine = useCanvasEngine();

  const handleComponentClick = (type: string) => {
    onSelectComponent?.(type);
    onComponentClick?.(type);
  };

  useEffect(() => {
    if (panelRef.current && elementY) {
      const panelHeight = panelRef.current.offsetHeight;
      const viewportHeight = window.innerHeight;
      // Toolbar height (h-12 = 48px) + bottom offset (bottom-8 = 32px) + gap (20px)
      const TOOLBAR_RESERVED_HEIGHT = 48 + 32 + 20;

      // Вычисляем позицию так, чтобы панель не перекрывалась с Toolbar
      let calculatedTop = elementY;
      if (elementY + panelHeight > viewportHeight - TOOLBAR_RESERVED_HEIGHT) {
        calculatedTop = viewportHeight - panelHeight - TOOLBAR_RESERVED_HEIGHT;
      }

      setTopPosition(Math.max(20, calculatedTop)); // минимум 20px от верха
    }
  }, [elementY]);

  // Группируем по категориям
  const categories = engine.registry.getCategories();

  return (
    <div
      ref={panelRef}
      className="absolute left-0 w-80 rounded-xl bg-background shadow-[0_4px_11px_rgba(0,0,0,0.25)] z-20"
      style={{
        top: topPosition ? `${topPosition}px` : 'auto',
        bottom: topPosition ? 'auto' : '128px',
      }}
    >
      <div className="p-4 flex items-center justify-between border-b border-border">
        <div className="flex items-center gap-1">
          <IconComponents className="w-4 h-4" stroke={1.5} />
          <span className="text-sm font-semibold text-black">Components</span>
        </div>
        <button type="button" onClick={onClose}>
          <IconX className="w-5 h-5" stroke={1.5} />
        </button>
      </div>
      <div className="p-4 border-b border-border">
        <div className="h-6 px-2 bg-gray-100 rounded flex items-center gap-1">
          <IconSearch className="w-4 h-4" stroke={1.5} />
          <span className="text-xs font-medium text-gray-500">Search component</span>
        </div>
      </div>

      <div className="p-4 flex flex-col gap-3 max-h-96 overflow-y-auto">
        {/* Категории */}
        {categories.map((category) => {
          const categoryComponents = engine.registry.getVisibleByCategory(category);
          if (categoryComponents.length === 0) return null;

          return (
            <div key={category}>
              <div className="flex items-center gap-1 mb-2">
                <IconChevronDown className="w-2 h-2 text-gray-400 rotate-[-90deg]" stroke={1.5} />
                <span className="text-xs font-medium text-black">{category}</span>
              </div>
              <div className="grid grid-cols-2 gap-4">
                {categoryComponents.map((comp) => (
                  <button
                    type="button"
                    key={comp.type}
                    className="flex flex-col gap-2 cursor-pointer text-left"
                    onClick={() => handleComponentClick(comp.type)}
                  >
                    <div
                      className={`h-24 rounded-md flex flex-col items-center justify-center ${
                        selectedComponentType === comp.type
                          ? 'border-2 border-button-primary'
                          : 'border border-gray-400'
                      } bg-gray-100`}
                    >
                      <span className="text-xs font-medium text-gray-600">{comp.label}</span>
                    </div>
                    <span className="text-xs font-medium text-black">{comp.label}</span>
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Check if value is a nested component structure
 */
function isNestedComponent(value: unknown): value is NestedComponent {
  if (value === null || typeof value !== 'object') return false;
  const obj = value as Record<string, unknown>;
  return typeof obj.type === 'string' && obj.props !== undefined && typeof obj.props === 'object';
}

/**
 * Recursive component field renderer for nested components
 */
interface NestedComponentFieldProps {
  label: string;
  value: unknown;
  onChange: (newValue: unknown) => void;
  depth?: number;
}

function NestedComponentField({ label, value, onChange, depth = 0 }: NestedComponentFieldProps) {
  const [isExpanded, setIsExpanded] = useState(depth === 0);

  // Handle array of nested components
  if (Array.isArray(value)) {
    return (
      <div className="flex flex-col gap-2 border-l-2 border-border pl-3">
        <button
          type="button"
          onClick={() => setIsExpanded(!isExpanded)}
          className="flex items-center gap-1 text-xs font-medium text-gray-700 hover:text-gray-900"
        >
          <IconChevronDown className={`w-3 h-3 transition-transform ${isExpanded ? '' : '-rotate-90'}`} stroke={1.5} />
          {label} ({value.length} items)
        </button>

        {isExpanded && (
          <div className="flex flex-col gap-2">
            {value.map((item, index) => {
              if (isNestedComponent(item)) {
                return (
                  // biome-ignore lint/suspicious/noArrayIndexKey: nested components have no stable unique id
                  <div key={index} className="flex flex-col gap-1">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-gray-600">
                        {item.type} #{index + 1}
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          const newArray = [...value];
                          newArray.splice(index, 1);
                          onChange(newArray);
                        }}
                        className="p-0.5 hover:bg-red-50 rounded"
                      >
                        <IconTrash className="w-3 h-3 text-red-500" stroke={1.5} />
                      </button>
                    </div>
                    {Object.entries(item.props).map(([propKey, propValue]) => (
                      <NestedComponentField
                        key={propKey}
                        label={propKey}
                        value={propValue}
                        onChange={(newValue) => {
                          const newArray = [...value];
                          newArray[index] = {
                            ...item,
                            props: { ...item.props, [propKey]: newValue },
                          };
                          onChange(newArray);
                        }}
                        depth={depth + 1}
                      />
                    ))}
                  </div>
                );
              }
              return null;
            })}
          </div>
        )}
      </div>
    );
  }

  // Handle single nested component
  if (isNestedComponent(value)) {
    return (
      <div className="flex flex-col gap-2 border-l-2 border-border pl-3">
        <button
          type="button"
          onClick={() => setIsExpanded(!isExpanded)}
          className="flex items-center gap-1 text-xs font-medium text-gray-700 hover:text-gray-900"
        >
          <IconChevronDown className={`w-3 h-3 transition-transform ${isExpanded ? '' : '-rotate-90'}`} stroke={1.5} />
          {label}: {value.type}
        </button>

        {isExpanded && (
          <div className="flex flex-col gap-2">
            {Object.entries(value.props).map(([propKey, propValue]) => (
              <NestedComponentField
                key={propKey}
                label={propKey}
                value={propValue}
                onChange={(newValue) => {
                  onChange({
                    ...value,
                    props: { ...value.props, [propKey]: newValue },
                  });
                }}
                depth={depth + 1}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  // Handle primitive values (string, number, boolean)
  if (typeof value === 'string') {
    return (
      <div className="flex flex-col gap-1">
        <span className="text-xs font-medium text-gray-600">{label}</span>
        <Input type="text" value={value} onChange={(e) => onChange(e.target.value)} className="h-7 text-xs" />
      </div>
    );
  }

  if (typeof value === 'number') {
    return (
      <div className="flex flex-col gap-1">
        <span className="text-xs font-medium text-gray-600">{label}</span>
        <Input type="number" value={value} onChange={(e) => onChange(Number(e.target.value))} className="h-7 text-xs" />
      </div>
    );
  }

  if (typeof value === 'boolean') {
    return (
      <div className="flex flex-col gap-1">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} className="w-4 h-4" />
          <span className="text-xs font-medium text-gray-600">{label}</span>
        </label>
      </div>
    );
  }

  return null;
}

// SVG placeholder for image
const IMAGE_PLACEHOLDER =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='150' viewBox='0 0 200 150'%3E%3Crect fill='%23ddd' width='200' height='150'/%3E%3Ctext fill='%23999' font-family='sans-serif' font-size='14' dy='10.5' font-weight='bold' x='50%25' y='50%25' text-anchor='middle'%3EImage%3C/text%3E%3C/svg%3E";

// Native element definitions for InsertInstancePanel fallback
const NATIVE_ELEMENT_DEFINITIONS: Record<
  string,
  {
    label: string;
    defaultProps: Record<string, unknown>;
    fields?: Record<string, { label: string; type: string; options?: string[] }>;
  }
> = {
  div: {
    label: 'Frame',
    defaultProps: {},
    fields: {},
  },
  span: {
    label: 'Text',
    defaultProps: { children: 'Text' },
    fields: { children: { label: 'Content', type: 'text' } },
  },
  a: {
    label: 'Link',
    defaultProps: { href: 'https://example.com', children: 'Link' },
    fields: {
      href: { label: 'URL', type: 'text' },
      children: { label: 'Text', type: 'text' },
    },
  },
  button: {
    label: 'Button',
    defaultProps: { children: 'Button' },
    fields: { children: { label: 'Label', type: 'text' } },
  },
  img: {
    label: 'Image',
    defaultProps: { src: IMAGE_PLACEHOLDER, alt: 'Image' },
    fields: {
      src: { label: 'Source URL', type: 'text' },
      alt: { label: 'Alt Text', type: 'text' },
    },
  },
};

interface InsertInstancePanelProps {
  onClose?: () => void;
  elementY?: number;
  selectedComponentType: string;
  componentFilePath?: string;
}

export function InsertInstancePanel({
  onClose,
  elementY = 0,
  selectedComponentType,
  componentFilePath: propComponentFilePath,
}: InsertInstancePanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [topPosition, setTopPosition] = useState<number>(0);
  const engine = useCanvasEngine();
  const { meta } = useComponentMeta();

  // Helper to get componentDef with fallback to native elements
  const getComponentDefWithFallback = (type: string): ComponentDefinition | undefined => {
    const def = engine.registry.get(type);
    if (def) return def;

    // Fallback for native HTML elements
    const nativeDef = NATIVE_ELEMENT_DEFINITIONS[type];
    if (nativeDef) {
      return {
        type,
        label: nativeDef.label,
        defaultProps: nativeDef.defaultProps,
        fields: (nativeDef.fields || {}) as FieldsMap,
        render: () => null,
      } satisfies ComponentDefinition;
    }
    return undefined;
  };

  // Track componentDef in state so it updates when registry changes
  const [componentDef, setComponentDef] = useState(() => getComponentDefWithFallback(selectedComponentType));

  // Update componentDef when selectedComponentType changes
  useEffect(() => {
    const def = getComponentDefWithFallback(selectedComponentType);
    console.log(
      '[InsertInstancePanel] Component changed to:',
      selectedComponentType,
      'defaultProps:',
      def?.defaultProps,
    );
    setComponentDef(def);
  }, [engine, selectedComponentType]);

  // Initialize field values from defaultProps
  const [fieldValues, setFieldValues] = useState<Record<string, unknown>>(() => {
    return componentDef?.defaultProps || {};
  });

  const [isGenerating, setIsGenerating] = useState(false);
  const [generationStatus, setGenerationStatus] = useState<string>('');

  useEffect(() => {
    if (panelRef.current && elementY) {
      const panelHeight = panelRef.current.offsetHeight;
      const viewportHeight = window.innerHeight;
      // Toolbar height (h-12 = 48px) + bottom offset (bottom-8 = 32px) + gap (20px)
      const TOOLBAR_RESERVED_HEIGHT = 48 + 32 + 20;

      // Вычисляем позицию так, чтобы панель не перекрывалась с Toolbar
      let calculatedTop = elementY;
      if (elementY + panelHeight > viewportHeight - TOOLBAR_RESERVED_HEIGHT) {
        calculatedTop = viewportHeight - panelHeight - TOOLBAR_RESERVED_HEIGHT;
      }

      setTopPosition(Math.max(20, calculatedTop)); // минимум 20px от верха
    }
  }, [elementY]);

  // Update field values when component changes
  useEffect(() => {
    if (componentDef?.defaultProps) {
      console.log('[InsertInstancePanel] Updating fieldValues from defaultProps:', componentDef.defaultProps);
      setFieldValues(componentDef.defaultProps);
    }
  }, [componentDef]);

  // Listen for reload event to refresh componentDef and fieldValues
  useEffect(() => {
    const handleReload = () => {
      console.log('[InsertInstancePanel] Reloading after component definitions update');
      // Force re-fetch componentDef with fallback
      const updatedDef = getComponentDefWithFallback(selectedComponentType);
      console.log(
        '[InsertInstancePanel] Updated componentDef:',
        updatedDef?.type,
        'defaultProps:',
        updatedDef?.defaultProps,
      );

      setComponentDef(updatedDef);

      if (updatedDef?.defaultProps) {
        console.log('[InsertInstancePanel] Updating fieldValues:', updatedDef.defaultProps);
        setFieldValues(updatedDef.defaultProps);
      }
    };

    window.addEventListener('reload-component-definitions', handleReload);
    return () => {
      window.removeEventListener('reload-component-definitions', handleReload);
    };
  }, [engine, selectedComponentType]);

  // Generate defaultProps with AI if empty
  useEffect(() => {
    if (!componentDef) {
      console.log('[AI] No componentDef');
      return;
    }

    const hasDefaultProps = componentDef.defaultProps && Object.keys(componentDef.defaultProps).length > 0;

    console.log('[AI] Component:', selectedComponentType);
    console.log('[AI] DefaultProps count:', Object.keys(componentDef.defaultProps || {}).length);
    console.log('[AI] Has defaultProps:', hasDefaultProps);

    if (hasDefaultProps) {
      console.log('[AI] ✗ Skipping - defaultProps already exist');
      return;
    }

    // For Atom components: use filePath from componentDef
    // For canvas components: use filePath from meta
    const filePath = componentDef?.filePath || meta?.filePath;
    if (!filePath) {
      console.error('[AI] No filePath in componentDef or meta');
      return;
    }

    // Skip generation for canvas components (they are loaded, not from test-repo)
    if (!componentDef?.filePath) {
      console.log('[AI] ✗ Skipping - not an Atom component');
      return;
    }

    console.log('[AI] ✓ Starting generation...');
    setIsGenerating(true);
    setGenerationStatus('Generating...');

    console.log('[AI] Fetching:', {
      componentType: selectedComponentType,
      filePath,
    });

    authFetch('/api/generate-default-props', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        componentType: selectedComponentType,
        filePath,
      }),
    })
      .then(async (response) => {
        console.log('[AI] Response received:', response.status);

        if (!response.ok) {
          throw new Error(`Failed to generate: ${response.status}`);
        }

        const reader = response.body?.getReader();
        if (!reader) throw new Error('No response body');

        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            console.log('[AI] Stream ended');
            break;
          }

          buffer += decoder.decode(value, { stream: true });
          const messages = buffer.split('\n\n');
          buffer = messages.pop() || '';

          for (const message of messages) {
            if (!message.startsWith('data: ')) continue;
            const data = JSON.parse(message.slice(6));
            console.log('[AI] Message:', data);

            if (data.status === 'complete') {
              console.log('[AI] ✓ Generation complete:', data.defaultProps);
              setGenerationStatus('✓ Generated');
              setIsGenerating(false);

              // Trigger registry reload - App.tsx will dispatch reload-component-definitions after updating
              window.dispatchEvent(
                new CustomEvent('ai-generation-complete', {
                  detail: { componentType: selectedComponentType },
                }),
              );
            } else if (data.status === 'error') {
              console.error('[AI] ✗ Error:', data.error);
              setGenerationStatus('Error');
              setIsGenerating(false);
            } else if (data.status === 'streaming') {
              console.log('[AI] Streaming chunk:', data.chunk?.slice(0, 50));
            }
          }
        }
      })
      .catch((error) => {
        console.error('[AI] ✗ Fetch error:', error);
        setGenerationStatus('Error');
        setIsGenerating(false);
      });
  }, [componentDef, selectedComponentType, meta]);

  if (!componentDef) {
    return null;
  }

  const handleInsert = () => {
    // Get selected element as parent (this is AST ID for iframe components)
    const selection = engine.getSelection();
    const parentId = selection.selectedIds[0] || null;

    // Get filePath from ComponentMetaContext
    const filePath = meta?.filePath;

    if (!filePath) {
      console.error('[InsertInstance] No component loaded. Please load a component first.');
      return;
    }

    // Use prop componentFilePath if provided, otherwise get from componentDef
    const componentFilePath = propComponentFilePath || componentDef?.filePath;

    console.log('[InsertInstance] Inserting element:', selectedComponentType);

    // Insert via engine (records in unified history for undo/redo)
    engine.insertASTElement(parentId, filePath, selectedComponentType, { ...fieldValues }, componentFilePath);

    if (onClose) {
      onClose();
    }
  };

  return (
    <div
      ref={panelRef}
      className="absolute left-80 w-80 rounded-xl bg-background shadow-[0_4px_11px_rgba(0,0,0,0.25)] z-20"
      style={{
        top: topPosition ? `${topPosition}px` : 'auto',
        bottom: topPosition ? 'auto' : '128px',
      }}
    >
      <div className="p-4 flex items-center justify-between border-b border-border">
        <span className="text-sm font-semibold text-black">{componentDef.label}</span>
        <button type="button" onClick={onClose}>
          <IconX className="w-5 h-5" stroke={1.5} />
        </button>
      </div>
      <div className="h-60 bg-gray-100 flex items-center justify-center p-4">
        <div className="text-sm text-gray-600">Preview: {componentDef.label}</div>
      </div>
      <div className="p-4 flex flex-col gap-3">
        {/* AI Generation Status */}
        {isGenerating && (
          <div className="text-xs text-gray-500 italic flex items-center gap-2">
            <div className="w-3 h-3 border-2 border-border border-t-gray-600 rounded-full animate-spin" />
            {generationStatus}
          </div>
        )}

        {/* Render all fields with recursive support for nested components */}
        <div className="flex flex-col gap-3 max-h-64 overflow-y-auto">
          {Object.entries(fieldValues)
            .filter(([name]) => name !== 'className') // Skip className
            .map(([fieldName, fieldValue]) => {
              // Get field definition from componentDef.fields if exists
              const fieldDef = componentDef.fields?.[fieldName];

              // Check if it's a nested component or array
              const isNested =
                isNestedComponent(fieldValue) || (Array.isArray(fieldValue) && fieldValue.some(isNestedComponent));

              // Use NestedComponentField for nested structures
              if (isNested) {
                return (
                  <NestedComponentField
                    key={fieldName}
                    label={fieldDef?.label || fieldName}
                    value={fieldValue}
                    onChange={(newValue) => setFieldValues((prev) => ({ ...prev, [fieldName]: newValue }))}
                  />
                );
              }

              // Legacy rendering for simple fields
              const isSelect = fieldDef?.type === 'select';
              const isBoolean = typeof fieldValue === 'boolean' || fieldDef?.type === 'boolean';
              const isNumber = typeof fieldValue === 'number' || fieldDef?.type === 'number';

              return (
                <div key={fieldName} className="flex flex-col gap-1.5">
                  <span className="text-xs font-medium text-gray-600">{fieldDef?.label || fieldName}</span>

                  {isSelect && fieldDef?.options ? (
                    <Select
                      value={String(fieldValues[fieldName] || '')}
                      onValueChange={(value) => setFieldValues((prev) => ({ ...prev, [fieldName]: value }))}
                    >
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {fieldDef.options.map((option) => (
                          <SelectItem key={option} value={option} className="text-xs">
                            {option}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : isBoolean ? (
                    <label className="flex items-center gap-2 h-8">
                      <input
                        type="checkbox"
                        checked={Boolean(fieldValues[fieldName])}
                        onChange={(e) => setFieldValues((prev) => ({ ...prev, [fieldName]: e.target.checked }))}
                        className="w-4 h-4"
                      />
                      <span className="text-xs text-gray-500">{fieldValues[fieldName] ? 'Yes' : 'No'}</span>
                    </label>
                  ) : isNumber ? (
                    <Input
                      type="number"
                      value={Number(fieldValues[fieldName] || 0)}
                      onChange={(e) => setFieldValues((prev) => ({ ...prev, [fieldName]: Number(e.target.value) }))}
                      className="h-8 text-xs"
                    />
                  ) : (
                    <Input
                      type="text"
                      value={String(fieldValues[fieldName] || '')}
                      onChange={(e) => setFieldValues((prev) => ({ ...prev, [fieldName]: e.target.value }))}
                      className="h-8 text-xs"
                    />
                  )}
                </div>
              );
            })}
        </div>

        <button
          type="button"
          onClick={handleInsert}
          className="w-full h-6 px-2 rounded-md bg-button-primary text-white text-xs font-medium"
        >
          Insert instance
        </button>
      </div>
    </div>
  );
}
