/**
 * InstanceEditPopup - popup for editing instance
 * Supports two modes:
 * 1. Code mode (sampleRenderer) - Monaco editor for JSX code
 * 2. Props mode - Form-based props editor using TypeScript types
 */

import type { InstanceConfig, InstancePosition, SerializableValue } from '@shared/types/canvas';
import { isInstanceConfig } from '@shared/types/canvas';
import type { ComponentPropsSchema, PropTypeInfo } from '@shared/types/props';
import { IconLoader2, IconSearch } from '@tabler/icons-react';
import { useCallback, useEffect, useState } from 'react';
import { authFetch } from '@/utils/authFetch';
import { LazyMonacoEditor, preloadMonacoEditor } from './LazyMonaco';
import { PropsFormField } from './PropsFormField';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogFooter } from './ui/dialog';
import { Input } from './ui/input';
import { Label } from './ui/label';

// Extract component name from file path (e.g., "Button.tsx" -> "Button")
function getComponentNameFromPath(path: string): string | null {
  const match = path.match(/([A-Z][a-zA-Z0-9]*)\.[tj]sx?$/);
  return match ? match[1] : null;
}

type EditMode = 'code' | 'props';

interface InstanceEditPopupProps {
  isOpen: boolean;
  onClose: () => void;
  instanceId: string | null;
  projectId: string | undefined;
  componentPath: string | undefined;
  /** Component name for props type lookup (e.g., "Button") */
  componentName?: string;
  /** Instance config from canvas.json */
  instanceConfig?: InstanceConfig | InstancePosition;
  onSave?: () => void;
  onDelete?: () => void;
  /** When true, hides Duplicate and Delete buttons (for single mode) */
  isSingleMode?: boolean;
}

export function InstanceEditPopup({
  isOpen,
  onClose,
  instanceId,
  projectId,
  componentPath,
  componentName,
  instanceConfig,
  onSave,
  onDelete,
  isSingleMode = false,
}: InstanceEditPopupProps) {
  const [instanceName, setInstanceName] = useState('');
  const [mode, setMode] = useState<EditMode>('code');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editorReady, setEditorReady] = useState(false);

  // Code mode state
  const [code, setCode] = useState('');

  // Props mode state
  const [schema, setSchema] = useState<ComponentPropsSchema | null>(null);
  const [propsValues, setPropsValues] = useState<Record<string, SerializableValue>>({});
  const [searchQuery, setSearchQuery] = useState('');
  const [showAllProps, setShowAllProps] = useState(false);

  // Preload Monaco chunk when the dialog opens for the first time
  useEffect(() => {
    if (isOpen) preloadMonacoEditor();
  }, [isOpen]);

  // Determine mode and load data
  useEffect(() => {
    if (!isOpen || !projectId || !componentPath || !instanceId) {
      return;
    }

    setInstanceName(instanceId);
    setLoading(true);
    setError(null);
    setEditorReady(false);
    setSchema(null);
    setCode('');
    setPropsValues({});
    setSearchQuery('');
    setShowAllProps(false);

    const loadData = async () => {
      try {
        // Check if sampleRenderer exists for this instance
        const existsParams = new URLSearchParams({
          projectId,
          componentPath,
          name: instanceId,
        });

        const existsResponse = await authFetch(`/api/sample-renderer/exists?${existsParams.toString()}`);
        const existsData = await existsResponse.json();
        const hasSampleRenderer = existsData.success && existsData.exists;

        if (hasSampleRenderer) {
          // Code mode - load sampleRenderer code
          setMode('code');

          const codeParams = new URLSearchParams({
            projectId,
            componentPath,
            name: instanceId,
          });

          const codeResponse = await authFetch(`/api/sample-renderer/code?${codeParams.toString()}`);
          const codeData = await codeResponse.json();

          if (!codeResponse.ok || !codeData.success) {
            throw new Error(codeData.error || 'Failed to load code');
          }

          setCode(codeData.code);
        } else {
          // Props mode - load component props schema
          setMode('props');

          // Determine component name for props API
          const compName = componentName || getComponentNameFromPath(componentPath);

          if (compName) {
            const schemaParams = new URLSearchParams({
              filePath: componentPath,
              componentName: compName,
            });

            const schemaResponse = await authFetch(`/api/component-props-types?${schemaParams.toString()}`);
            const schemaData = await schemaResponse.json();

            if (schemaResponse.ok && schemaData.success) {
              setSchema({
                componentName: schemaData.componentName,
                props: schemaData.props,
              });
            } else {
              console.warn('[InstanceEditPopup] Could not load props schema:', schemaData.error);
              // Continue without schema - user can still edit raw props
            }
          }

          // Load current props from instanceConfig
          if (instanceConfig && isInstanceConfig(instanceConfig)) {
            setPropsValues(instanceConfig.props || {});
          }
        }
      } catch (err) {
        console.error('[InstanceEditPopup] Load error:', err);
        setError(err instanceof Error ? err.message : 'Failed to load');
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [isOpen, projectId, componentPath, instanceId, componentName, instanceConfig]);

  // Handle prop value change
  const handlePropChange = useCallback((propName: string, value: SerializableValue) => {
    setPropsValues((prev) => ({
      ...prev,
      [propName]: value,
    }));
  }, []);

  // Save code mode
  const handleSaveCode = async () => {
    if (!projectId || !componentPath || !instanceId) return;

    setSaving(true);
    setError(null);

    try {
      const nameChanged = instanceName !== instanceId;

      if (nameChanged) {
        // Delete old renderer
        await authFetch('/api/sample-renderer/delete', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            projectId,
            componentPath,
            name: instanceId,
          }),
        });

        // Add new renderer with new name
        const addResponse = await authFetch('/api/sample-renderer/add', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            projectId,
            componentPath,
            name: instanceName,
            code,
          }),
        });

        const addData = await addResponse.json();
        if (!addResponse.ok || !addData.success) {
          throw new Error(addData.error || 'Failed to rename');
        }

        // Update canvas.json: create new instance, then delete old
        // Get old instance config to preserve position/size
        const compResponse = await authFetch(
          `/api/canvas-composition/${projectId}/${encodeURIComponent(componentPath)}`,
        );
        const compData = await compResponse.json();
        const oldConfig = compData.composition?.instances?.[instanceId] || {};

        const createRes = await authFetch(`/api/canvas-composition/${projectId}/instance`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            componentPath,
            instanceId: instanceName,
            config: { ...oldConfig, props: {} },
          }),
        });
        const createData = await createRes.json();
        if (!createRes.ok || !createData.success) {
          throw new Error(createData.error || 'Failed to create renamed instance');
        }

        await authFetch(
          `/api/canvas-composition/${projectId}/${encodeURIComponent(componentPath)}/${encodeURIComponent(instanceId)}`,
          { method: 'DELETE' },
        );
      } else {
        // Just update code
        const updateResponse = await authFetch('/api/sample-renderer/update', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            projectId,
            componentPath,
            name: instanceId,
            code,
          }),
        });

        const updateData = await updateResponse.json();
        if (!updateResponse.ok || !updateData.success) {
          throw new Error(updateData.error || 'Failed to update code');
        }

        // Clear props from canvas.json since sampleRenderer takes priority
        if (instanceConfig && isInstanceConfig(instanceConfig) && Object.keys(instanceConfig.props).length > 0) {
          await authFetch(`/api/canvas-composition/${projectId}/instance/${encodeURIComponent(instanceId)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              componentPath,
              updates: { props: {} },
            }),
          });
        }
      }

      onSave?.();
      onClose();
    } catch (err) {
      console.error('[InstanceEditPopup] Save code error:', err);
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  // Save props mode
  const handleSaveProps = async () => {
    if (!projectId || !componentPath || !instanceId) return;

    setSaving(true);
    setError(null);

    try {
      const nameChanged = instanceName !== instanceId;

      if (nameChanged) {
        // Rename: get old config, create new, delete old
        const compResponse = await authFetch(
          `/api/canvas-composition/${projectId}/${encodeURIComponent(componentPath)}`,
        );
        const compData = await compResponse.json();
        const oldConfig = compData.composition?.instances?.[instanceId] || {};

        const createRes = await authFetch(`/api/canvas-composition/${projectId}/instance`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            componentPath,
            instanceId: instanceName,
            config: { ...oldConfig, props: propsValues },
          }),
        });
        const createData = await createRes.json();
        if (!createRes.ok || !createData.success) {
          throw new Error(createData.error || 'Failed to create renamed instance');
        }

        await authFetch(
          `/api/canvas-composition/${projectId}/${encodeURIComponent(componentPath)}/${encodeURIComponent(instanceId)}`,
          { method: 'DELETE' },
        );
      } else {
        // Update props via API
        await authFetch(`/api/canvas-composition/${projectId}/instance/${encodeURIComponent(instanceId)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            componentPath,
            updates: { props: propsValues },
          }),
        });
      }

      onSave?.();
      onClose();
    } catch (err) {
      console.error('[InstanceEditPopup] Save props error:', err);
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const handleSave = () => {
    if (mode === 'code') {
      handleSaveCode();
    } else {
      handleSaveProps();
    }
  };

  const handleDuplicate = async () => {
    if (!projectId || !componentPath || !instanceId) return;

    setSaving(true);
    setError(null);

    try {
      // Generate new name
      const baseName = instanceId.replace(/\d+$/, '');
      const number = Number.parseInt(instanceId.replace(/^\D+/, ''), 10) || 1;
      const newName = `${baseName}${number + 1}`;

      if (mode === 'code') {
        // Duplicate sampleRenderer
        const addResponse = await authFetch('/api/sample-renderer/add', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            projectId,
            componentPath,
            name: newName,
            code,
          }),
        });

        const addData = await addResponse.json();
        if (!addResponse.ok || !addData.success) {
          throw new Error(addData.error || 'Failed to duplicate');
        }
      }

      // Add new instance to canvas.json via POST /instance
      const currentX = instanceConfig && isInstanceConfig(instanceConfig) ? instanceConfig.x : 100;
      const currentY = instanceConfig && isInstanceConfig(instanceConfig) ? instanceConfig.y : 100;

      const createResponse = await authFetch(`/api/canvas-composition/${projectId}/instance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          componentPath,
          instanceId: newName,
          config: {
            x: (currentX || 100) + 50,
            y: (currentY || 100) + 50,
            props: mode === 'props' ? { ...propsValues } : {},
          },
        }),
      });
      const createData = await createResponse.json();
      if (!createResponse.ok || !createData.success) {
        throw new Error(createData.error || 'Failed to create duplicate instance');
      }

      onSave?.();
      onClose();
    } catch (err) {
      console.error('[InstanceEditPopup] Duplicate error:', err);
      setError(err instanceof Error ? err.message : 'Failed to duplicate');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!projectId || !componentPath || !instanceId) return;

    if (!window.confirm(`Delete instance "${instanceId}"?`)) {
      return;
    }

    setSaving(true);
    setError(null);

    try {
      if (mode === 'code') {
        // Delete sampleRenderer
        const deleteResponse = await authFetch('/api/sample-renderer/delete', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            projectId,
            componentPath,
            name: instanceId,
          }),
        });

        const deleteData = await deleteResponse.json();
        if (!deleteResponse.ok || !deleteData.success) {
          throw new Error(deleteData.error || 'Failed to delete');
        }
      }

      // Delete from canvas.json
      await authFetch(
        `/api/canvas-composition/${projectId}/${encodeURIComponent(componentPath)}/${encodeURIComponent(instanceId)}`,
        { method: 'DELETE' },
      );

      onDelete?.();
      onClose();
    } catch (err) {
      console.error('[InstanceEditPopup] Delete error:', err);
      setError(err instanceof Error ? err.message : 'Failed to delete');
    } finally {
      setSaving(false);
    }
  };

  // Render props form
  const renderPropsForm = () => {
    if (!schema || Object.keys(schema.props).length === 0) {
      // No schema or empty props - show raw JSON editor hint
      return (
        <div className="flex flex-col items-center justify-center h-full text-muted-foreground p-6">
          <p className="text-sm mb-2">No props schema available for this component.</p>
          <p className="text-xs text-muted-foreground/70">
            The component may not have typed props or the file is JavaScript.
          </p>
          {Object.keys(propsValues).length > 0 && (
            <div className="mt-4 w-full">
              <Label className="text-xs text-muted-foreground mb-2 block">Current props (JSON):</Label>
              <pre className="text-xs bg-muted p-3 rounded overflow-auto max-h-40">
                {JSON.stringify(propsValues, null, 2)}
              </pre>
            </div>
          )}
        </div>
      );
    }

    const filteredProps = Object.entries(schema.props).filter(([propName]) =>
      propName.toLowerCase().includes(searchQuery.toLowerCase()),
    );

    const propsCount = filteredProps.length;
    const N = 8;
    const threshold = N + 2;
    const shouldLimit = propsCount > threshold;
    const displayedProps = shouldLimit && !showAllProps ? filteredProps.slice(0, N) : filteredProps;

    return (
      <div className="p-4 space-y-4 overflow-y-auto flex-1">
        {/* Header */}
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-foreground">Component Props</span>
          <span className="text-[10px] text-muted-foreground">{Object.keys(schema.props).length} props</span>
        </div>

        {/* Search */}
        {Object.keys(schema.props).length > 3 && (
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

        {/* Props fields */}
        <div className="space-y-3">
          {displayedProps.map(([propName, propInfo]) => (
            <PropsFormField
              key={propName}
              name={propName}
              propInfo={propInfo as PropTypeInfo}
              value={propsValues[propName]}
              onChange={(value) => handlePropChange(propName, value as SerializableValue)}
            />
          ))}

          {/* Show all button */}
          {shouldLimit && !showAllProps && (
            <button
              type="button"
              onClick={() => setShowAllProps(true)}
              className="w-full h-6 px-2 bg-muted hover:bg-accent rounded flex items-center justify-center text-[11px] text-muted-foreground font-medium transition-colors"
            >
              Show all ({propsCount})
            </button>
          )}
        </div>
      </div>
    );
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl !h-[70vh] !flex !flex-col !gap-0 !p-0">
        {/* Header with instance name — pr-12 reserves space for the dialog close button */}
        <div className="pl-6 pr-12 pt-4 pb-3 border-b border-border shrink-0 flex items-center">
          <Input
            value={instanceName}
            onChange={(e) => {
              const sanitized = e.target.value.replace(/[^a-zA-Z0-9_]/g, '');
              setInstanceName(sanitized);
            }}
            className="h-9 text-base font-semibold border-0 bg-transparent hover:bg-muted focus-visible:ring-0 focus-visible:ring-offset-0 focus-visible:shadow-[0_0_0_2px_hsl(var(--ring))] px-2 rounded transition-all min-w-0 max-w-xs"
            placeholder="instance-name"
          />
        </div>

        {/* Content area */}
        <div className="flex-1 min-h-0 flex flex-col">
          {loading ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-sm text-muted-foreground">Loading...</div>
            </div>
          ) : error && mode === 'code' ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-sm text-destructive">{error}</div>
            </div>
          ) : mode === 'code' ? (
            <LazyMonacoEditor
              filepath={componentPath ? `${componentPath}:${instanceName}` : 'sampleRenderer.tsx'}
              value={code}
              onChange={(value) => setCode(value || '')}
              onSave={handleSave}
              onReady={(ready) => setEditorReady(ready)}
            />
          ) : (
            renderPropsForm()
          )}
        </div>

        {/* Footer with actions */}
        <div className="px-6 py-4 border-t border-border shrink-0">
          {error && !loading && mode === 'props' && <div className="text-sm text-destructive mb-3">{error}</div>}

          <div className="flex items-center">
            {mode === 'code' && !editorReady && !loading && (
              <div className="flex items-center gap-1.5">
                <IconLoader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />
                <span className="text-xs text-muted-foreground">Initializing IntelliSense...</span>
              </div>
            )}
            <DialogFooter className="gap-2 ml-auto">
              {!isSingleMode && (
                <Button onClick={handleDelete} variant="destructive" disabled={saving}>
                  Delete
                </Button>
              )}
              {!isSingleMode && (
                <Button onClick={handleDuplicate} variant="outline" disabled={saving}>
                  Duplicate
                </Button>
              )}
              <Button onClick={handleSave} disabled={saving}>
                {saving ? 'Saving...' : 'Save'}
              </Button>
            </DialogFooter>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
