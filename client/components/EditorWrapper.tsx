/**
 * EditorWrapper - Lazy-loaded wrapper for the editor page
 * Contains CanvasEngine setup to avoid loading it on other pages
 */
import { useEffect, useMemo, useRef } from 'react';
import { ComponentMetaProvider, useComponentMeta } from '@/contexts/ComponentMetaContext';
import { CanvasEngine, CanvasEngineProvider, type ComponentDefinition } from '@/lib/canvas-engine';
import type { ASTNode } from '@/lib/canvas-engine/types/ast';

/** Data returned by parse-component API */
interface ComponentLoadData {
  success: boolean;
  componentName?: string;
  filePath?: string;
  structure?: ASTNode[];
  sampleStructure?: ASTNode[] | null;
  sampleName?: string | null;
  repoPath?: string;
  projectName?: string;
  projectId?: string;
  relativeFilePath?: string;
  error?: string;
}

import { htmlComponents } from '@/lib/htmlComponents';
import Index from '@/pages/Editor/Index';
import { authFetch } from '@/utils/authFetch';

// Legacy: canvas components are now loaded from user projects via iframe
const canvasComponents: ComponentDefinition[] = [];

function CanvasEngineSetup({ children }: { children: React.ReactNode }) {
  const { setMeta, setParseError, currentSampleName } = useComponentMeta();
  const filePathRef = useRef<string | null>(null);
  const sampleNameRef = useRef<string | null>(null);

  // Keep ref in sync with context state
  sampleNameRef.current = currentSampleName;

  const engine = useMemo(() => {
    const eng = new CanvasEngine({
      debug: true,
      onStateChange: (snapshot) => {
        // Can sync with localStorage or postMessage
        console.log('Canvas state changed:', snapshot.version);
      },
      serverSync: {
        getFilePath: () => filePathRef.current,
        onSyncError: (error, operation) => {
          console.error(
            // nosemgrep: unsafe-formatstring -- JS template literal, not a format string
            `[ServerSync] Operation "${operation.name}" failed:`,
            error,
          );
          // Show error notification to user
          alert(`Failed to sync changes: ${error.message}`);
        },
      },
    });

    // Register HTML components
    htmlComponents.forEach((comp) => {
      eng.registerComponent(comp as ComponentDefinition);
    });

    // Register components from test-repo (legacy)
    canvasComponents.forEach((comp) => {
      eng.registerComponent(comp as ComponentDefinition);
    });

    // nosemgrep: unsafe-formatstring -- JS template literal, not a format string
    console.log(`[Canvas Engine] Registered ${htmlComponents.length + canvasComponents.length} base components`);

    // Helper to collect all IDs from AST structure in order
    function collectIds(nodes: ASTNode[]): string[] {
      const ids: string[] = [];
      for (const node of nodes) {
        ids.push(node.id);
        if (node.children && node.children.length > 0) {
          ids.push(...collectIds(node.children));
        }
      }
      return ids;
    }

    // Function to load component structure
    async function loadComponentStructure(data: ComponentLoadData) {
      if (data.success && data.componentName) {
        // Clear any previous parse error on success
        setParseError(null);
        console.log('[Canvas Engine] Loading component:', data.componentName);

        const filePath = data.filePath;
        const isSameFile = filePathRef.current === filePath;

        // Start batch mode to defer all events until final commit
        eng.startBatch();

        // Only clear instances if loading a different component
        if (!isSameFile) {
          console.log('[Canvas Engine] Different component - clearing instances');
          eng.clearInstances();
          eng.clearHistory();
        } else {
          console.log('[Canvas Engine] Same component - updating structure only');
        }

        // For iframe-rendered components: store AST in root metadata
        // For registered components: create instance as before
        const componentDef = eng.registry.get(data.componentName);

        if (!isSameFile) {
          // Loading new component
          if (componentDef) {
            // Legacy: component is registered, create instance
            const instanceId = eng.loadInstances(data.componentName, {}, null, []);
            console.log('[Canvas Engine] Created component instance:', instanceId, 'type:', data.componentName);
          } else {
            // New: iframe component, no instance needed
            console.log('[Canvas Engine] Component not registered (iframe mode):', data.componentName);
          }
        }

        // ALWAYS store metadata on root for consistency
        // This ensures LeftSidebar can always read from root.metadata
        const root = eng.getRoot();
        if (data.structure && filePath) {
          console.log('[Canvas Engine] Updating metadata on root');
          console.log('[Canvas Engine] New structure has', data.structure.length, 'elements');

          if (!root.metadata) {
            root.metadata = {};
          }

          root.metadata = {
            ...root.metadata,
            astStructure: data.structure,
            sampleStructure: data.sampleStructure ?? null,
            filePath,
          };

          console.log('[Canvas Engine] ✓ Metadata updated');

          // Trigger store update so components react to astStructure change
          eng.events.emit('tree:change', {
            changedIds: [root.id],
          });

          // Update current file path
          filePathRef.current = filePath;

          // Inject unique IDs into source file
          // parseComponent generates UUIDs for all elements (either reads from file or creates new)
          // injectUniqueIds will only write to file if IDs are missing
          const allIds = collectIds(data.structure);
          const idMap: Record<string, string> = {};
          allIds.forEach((id, index) => {
            idMap[index.toString()] = id;
          });

          // Build Sample* idMap if sampleStructure exists
          let sampleIdMap: Record<string, string> | undefined;
          if (data.sampleStructure && data.sampleStructure.length > 0) {
            const sampleIds = collectIds(data.sampleStructure);
            const map: Record<string, string> = {};
            sampleIds.forEach((id, index) => {
              map[index.toString()] = id;
            });
            sampleIdMap = map;
          }

          try {
            console.log(
              '[Canvas Engine] Injecting unique IDs for',
              allIds.length,
              'elements in component:',
              data.componentName,
            );
            const injectResponse = await authFetch('/api/inject-unique-ids', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                filePath,
                idMap,
                componentName: data.componentName,
                sampleName: data.sampleName ?? undefined,
                sampleIdMap,
              }),
            });
            const injectResult = await injectResponse.json();
            if (!injectResult.success) {
              console.error('[Canvas Engine] Failed to inject unique IDs:', injectResult.error);
            } else {
              console.log(
                '[Canvas Engine] ✓ Injected unique IDs into source file, added:',
                injectResult.addedCount || 0,
              );

              // If new IDs were added, re-parse to get updated structure
              if (injectResult.addedCount && injectResult.addedCount > 0) {
                // nosemgrep: unsafe-formatstring -- no template literal, but multiline log
                console.log('[Canvas Engine] Re-parsing component to get updated IDs');
                let reParseUrl = `/api/parse-component?path=${encodeURIComponent(filePath)}`;
                if (data.sampleName) {
                  reParseUrl += `&sampleName=${encodeURIComponent(data.sampleName)}`;
                }
                const reParseResponse = await authFetch(reParseUrl);
                const reParseData = await reParseResponse.json();
                if (reParseData.success && reParseData.structure) {
                  // Update root metadata with new structure
                  root.metadata.astStructure = reParseData.structure;
                  root.metadata.sampleStructure = reParseData.sampleStructure ?? null;
                  console.log('[Canvas Engine] ✓ Updated AST structure with new IDs');
                  // Trigger store update so components react to astStructure change
                  eng.events.emit('tree:change', {
                    changedIds: [root.id],
                  });
                }
              }
            }
          } catch (error) {
            console.error('[Canvas Engine] Error injecting unique IDs:', error);
          }
        }

        // Finalize batch mode - emit all deferred events at once
        // This ensures UI updates only once with final state
        eng.finalizeBatch();

        const rootChildren = eng.getChildren(eng.getRoot().id);
        console.log('[Canvas Engine] Now have', rootChildren.length, 'root instances');

        // Update component metadata AFTER all metadata updates are done
        // This ensures LeftSidebar re-renders with correct astStructure
        if (data.componentName && data.repoPath) {
          setMeta({
            componentName: data.componentName,
            projectName: data.projectName,
            projectId: data.projectId,
            repoPath: data.repoPath,
            filePath: data.filePath,
            relativeFilePath: data.relativeFilePath,
          });
        }
      } else {
        console.error('[Canvas Engine] Component definition not found:', data.componentName);
      }
    }

    // Listen for component load events (triggered by useComponentAutoLoad)
    const handleComponentLoaded = (event: CustomEvent) => {
      loadComponentStructure(event.detail);
    };

    window.addEventListener('component-loaded', handleComponentLoaded as EventListener);

    // Auto-reload component when files change (ComponentWatcher SSE)
    const handleFilesChanged = () => {
      // Reload current component to re-inject IDs
      const currentFilePath = filePathRef.current;
      if (currentFilePath) {
        console.log('[Canvas Engine] Files changed, reloading current component:', currentFilePath);
        // Re-parse component to inject missing IDs
        let reloadUrl = `/api/parse-component?path=${encodeURIComponent(currentFilePath)}`;
        if (sampleNameRef.current) {
          reloadUrl += `&sampleName=${encodeURIComponent(sampleNameRef.current)}`;
        }
        authFetch(reloadUrl)
          .then((res) => res.json())
          .then((data) => {
            if (data.success) {
              loadComponentStructure(data);
            } else if (data.error) {
              setParseError(data.error);
              console.error('[Canvas Engine] Failed to reload component:', data.error);
            }
          })
          .catch((err) => {
            setParseError(err.message || 'Failed to parse component');
            console.error('[Canvas Engine] Failed to reload component:', err);
          });
      }
    };

    window.addEventListener('components-updated', handleFilesChanged as EventListener);

    // Cleanup not needed because engine is created once via useMemo
    // and lives for the entire application lifecycle

    return eng;
  }, [setMeta, setParseError]);

  // Listen for AI generation complete and reload component definitions
  useEffect(() => {
    const reloadComponents = (notifyListeners = false) => {
      console.log('[Canvas Engine] Reloading component definitions...');

      // Re-fetch and re-register Atom components
      authFetch('/api/get-component-definitions')
        .then((res) => res.json())
        .then((data) => {
          if (data.success && data.definitions && data.definitions.length > 0) {
            data.definitions.forEach((def: ComponentDefinition) => {
              // Unregister old version if exists
              try {
                engine.unregisterComponent(def.type);
              } catch {
                // Ignore if not registered
              }

              const componentDef = {
                ...def,
                render: () => null,
              };
              engine.registerComponent(componentDef);
            });
            console.log(
              // nosemgrep: unsafe-formatstring -- JS template literal, not a format string
              `[Canvas Engine] ✓ Reloaded ${data.definitions.length} Atom components`,
              data.definitions.map((d: ComponentDefinition) => d.type).join(', '),
            );

            // Notify listeners that registry has been updated
            if (notifyListeners) {
              console.log('[Canvas Engine] Dispatching reload-component-definitions event');
              window.dispatchEvent(new Event('reload-component-definitions'));
            }
          }
        })
        .catch((error) => {
          console.error('[Canvas Engine] Failed to reload components:', error);
        });
    };

    const handleAIGenerationComplete = () => {
      console.log('[Canvas Engine] AI generation complete - reloading definitions');
      reloadComponents(true); // Notify listeners after reload
    };

    const handleManualReload = () => {
      reloadComponents(false); // Manual reload, no need to notify
    };

    const handleProjectActivated = () => {
      console.log('[Canvas Engine] Project activated - loading definitions');
      reloadComponents(false);
    };

    window.addEventListener('ai-generation-complete', handleAIGenerationComplete);
    window.addEventListener('manual-reload-components', handleManualReload);
    window.addEventListener('project-activated', handleProjectActivated);

    return () => {
      window.removeEventListener('ai-generation-complete', handleAIGenerationComplete);
      window.removeEventListener('manual-reload-components', handleManualReload);
      window.removeEventListener('project-activated', handleProjectActivated);
    };
  }, [engine]);

  return <CanvasEngineProvider engine={engine}>{children}</CanvasEngineProvider>;
}

// EditorWrapper: wraps Index page with all required providers
export default function EditorWrapper() {
  return (
    <ComponentMetaProvider>
      <CanvasEngineSetup>
        <Index />
      </CanvasEngineSetup>
    </ComponentMetaProvider>
  );
}
