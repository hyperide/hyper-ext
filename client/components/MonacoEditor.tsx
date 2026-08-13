import Editor, { type OnMount } from '@monaco-editor/react';
import type * as Monaco from 'monaco-editor';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTheme } from '@/components/ThemeProvider';
import { useComponentMeta } from '@/contexts/ComponentMetaContext';
import { toast } from '@/hooks/use-toast';
import { useCanvasEngine } from '@/lib/canvas-engine';
import { authFetch } from '@/utils/authFetch';

interface MonacoEditorProps {
  filepath: string | null;
  value: string;
  onChange: (value: string) => void;
  onSave: () => void;
  onReady?: (ready: boolean) => void;
}

interface GitDiffChange {
  line: number;
  type: 'added' | 'deleted' | 'modified';
  oldLine?: number;
  newLine?: number;
  deletedContent?: string;
}

// Module-level cache to avoid refetching type definitions on every editor mount
let typeDefsCache: Record<string, string> | null = null;
let typeDefsPromise: Promise<Record<string, string>> | null = null;

async function fetchTypeDefinitions(): Promise<Record<string, string>> {
  if (typeDefsCache) return typeDefsCache;
  if (!typeDefsPromise) {
    typeDefsPromise = authFetch('/api/type-definitions?package=react')
      .then((res) => res.json())
      .then((data: { success?: boolean; files?: Record<string, string> }) => {
        if (data.success && data.files) {
          typeDefsCache = data.files;
          return typeDefsCache;
        }
        // Non-success response: reset promise so the next mount can retry
        typeDefsPromise = null;
        return {};
      })
      .catch(() => {
        typeDefsPromise = null; // allow retry on network/parse error
        return {};
      });
  }
  return typeDefsPromise;
}

// Get language from file extension
function getLanguageFromPath(filepath: string): string {
  // Remove anything after ':' (e.g., 'Button.tsx:default' -> 'Button.tsx')
  const cleanPath = filepath.split(':')[0];
  const ext = cleanPath.split('.').pop()?.toLowerCase();

  const languageMap: Record<string, string> = {
    ts: 'typescript',
    tsx: 'typescript', // Use typescript with JSX enabled via compiler options
    js: 'javascript',
    jsx: 'javascript', // Use javascript with JSX enabled via compiler options
    json: 'json',
    css: 'css',
    scss: 'scss',
    html: 'html',
    md: 'markdown',
    py: 'python',
    sh: 'shell',
    yml: 'yaml',
    yaml: 'yaml',
  };

  return languageMap[ext || ''] || 'plaintext';
}

export default function MonacoEditor({ filepath, value, onChange, onSave, onReady }: MonacoEditorProps) {
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<typeof Monaco | null>(null);
  const onChangeRef = useRef(onChange);
  const isUserEditRef = useRef(false);
  const valueRef = useRef(value);
  const [isReady, setIsReady] = useState(false);
  const engine = useCanvasEngine();
  const { meta, loadComponent } = useComponentMeta();
  const { resolvedTheme } = useTheme();
  const gitDecorationsRef = useRef<Monaco.editor.IEditorDecorationsCollection | null>(null);
  const pendingNavigationRef = useRef<{
    line: number;
    column: number;
    filePath: string;
    endLine?: number;
    endColumn?: number;
  } | null>(null);

  // Keep refs up to date
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  useEffect(() => {
    onReady?.(isReady);
  }, [isReady, onReady]);

  // Cleanup when editor unmounts to prevent "InstantiationService has been disposed" errors
  useEffect(() => {
    return () => {
      setIsReady(false);
      editorRef.current = null;
      monacoRef.current = null;
    };
  }, []);

  const handleEditorDidMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
    setIsReady(true);

    // Configure TypeScript/JavaScript compiler options for better IntelliSense
    monaco.typescript?.typescriptDefaults.setCompilerOptions({
      target: monaco.typescript.ScriptTarget.ESNext,
      module: monaco.typescript.ModuleKind.ESNext,
      moduleResolution: monaco.typescript.ModuleResolutionKind.NodeJs,
      allowNonTsExtensions: true,
      jsx: monaco.typescript.JsxEmit.ReactJSX, // New JSX transform (React 17+)
      allowSyntheticDefaultImports: true,
      esModuleInterop: true,
    });

    monaco.typescript?.javascriptDefaults.setCompilerOptions({
      target: monaco.typescript.ScriptTarget.ESNext,
      module: monaco.typescript.ModuleKind.ESNext,
      moduleResolution: monaco.typescript.ModuleResolutionKind.NodeJs,
      allowNonTsExtensions: true,
      allowJs: true,
      checkJs: false,
    });

    // Load type definitions for React from server (cached at module level)
    fetchTypeDefinitions()
      .then((files) => {
        Object.entries(files).forEach(([fileName, content]) => {
          const uri = `file:///node_modules/@types/react/${fileName}`;
          monaco.typescript?.typescriptDefaults.addExtraLib(content, uri);
        });
      })
      .catch((error) => {
        console.error('[MonacoEditor] Failed to load type definitions:', error);
      });

    // Add Mod+S keybinding for save
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      onSave();
    });

    // Focus editor
    editor.focus();
  };

  // Create/switch model when filepath changes
  useEffect(() => {
    if (!editorRef.current || !monacoRef.current || !isReady || !filepath) return;

    const monaco = monacoRef.current;
    const editor = editorRef.current;

    // Create URI for the file to enable proper IntelliSense
    const uri = monaco.Uri.parse(`file:///${filepath}`);

    // Check if model already exists
    let model = monaco.editor.getModel(uri);

    if (!model) {
      // Create new model with proper language and URI
      const language = getLanguageFromPath(filepath);
      isUserEditRef.current = false; // Mark as programmatic change
      model = monaco.editor.createModel(valueRef.current, language, uri);

      // For sampleRenderer files (with ':' in path), disable TypeScript diagnostics
      // to avoid false errors since Monaco doesn't have the component context
      if (filepath.includes(':')) {
        monaco.typescript?.typescriptDefaults.setDiagnosticsOptions({
          noSemanticValidation: true, // Disable type checking
          noSyntaxValidation: true, // Disable syntax checking (JSX causes false errors)
        });
        console.log('[MonacoEditor] Disabled TypeScript diagnostics for sampleRenderer');
      } else {
        // Re-enable for normal files
        monaco.typescript?.typescriptDefaults.setDiagnosticsOptions({
          noSemanticValidation: false,
          noSyntaxValidation: false,
        });
      }

      // Listen for model changes (only once per model!)
      model.onDidChangeContent(() => {
        if (isUserEditRef.current) {
          const newValue = model?.getValue() ?? '';
          if (newValue !== valueRef.current) {
            console.log(
              '[MonacoEditor] Content changed, calling onChange. Length:',
              newValue.length,
              'Preview:',
              newValue.substring(0, 50),
            );
            valueRef.current = newValue;
            onChangeRef.current(newValue);
          }
        }
      });
    }

    // Set model to editor (only when filepath changes)
    editor.setModel(model);

    // After model is set, mark future changes as user edits
    isUserEditRef.current = true;
  }, [filepath, isReady]);

  // Update model content when value prop changes (but don't recreate listener!)
  useEffect(() => {
    if (!monacoRef.current || !filepath) return;

    const monaco = monacoRef.current;
    const uri = monaco.Uri.parse(`file:///${filepath}`);
    const model = monaco.editor.getModel(uri);

    if (model && model.getValue() !== value) {
      isUserEditRef.current = false;
      model.pushEditOperations(
        [],
        [
          {
            range: model.getFullModelRange(),
            text: value,
          },
        ],
        () => null,
      );
      setTimeout(() => {
        isUserEditRef.current = true;
      }, 0);
    }
  }, [filepath, value]);

  // Handle monaco-goto-position event (from "Go to Code" in context menu)
  useEffect(() => {
    const handleGotoPosition = (event: Event) => {
      const customEvent = event as CustomEvent<{
        line: number;
        column: number;
        filePath: string;
        endLine?: number;
        endColumn?: number;
      }>;

      const { line, column, filePath: eventFilePath, endLine, endColumn } = customEvent.detail;

      // Store navigation request for later if editor is not ready or file doesn't match
      if (!editorRef.current || eventFilePath !== filepath || !isReady) {
        console.log('[Monaco] Storing pending navigation:', {
          line,
          column,
          endLine,
          endColumn,
          eventFilePath,
          currentFilepath: filepath,
          isReady,
        });
        pendingNavigationRef.current = { line, column, filePath: eventFilePath, endLine, endColumn };
        return;
      }

      // Clear any pending navigation since we're handling it now
      pendingNavigationRef.current = null;

      console.log('[Monaco] Navigating immediately:', { line, column, endLine, endColumn, filepath });

      const editor = editorRef.current;
      const monaco = monacoRef.current;
      if (!monaco) return;

      // Reveal position
      editor.revealLineInCenter(line);

      // If we have end coordinates, select the range
      if (endLine !== undefined && endColumn !== undefined) {
        editor.setSelection(new monaco.Selection(line, column, endLine, endColumn));
      } else {
        editor.setPosition({ lineNumber: line, column });
      }

      const model = editor.getModel();
      if (!model) return;

      // Get line length to highlight the whole line (decoration)
      const lineContent = model.getLineContent(line);
      const range = new monaco.Range(line, 1, line, lineContent.length + 1);

      // Add decoration
      const decorations = editor.deltaDecorations(
        [],
        [
          {
            range,
            options: {
              isWholeLine: true,
              className: 'monaco-highlight-line',
              glyphMarginClassName: 'monaco-highlight-glyph',
            },
          },
        ],
      );

      // Remove decoration after 2 seconds
      setTimeout(() => {
        editor.deltaDecorations(decorations, []);
      }, 2000);

      // Focus editor
      editor.focus();
    };

    window.addEventListener('monaco-goto-position', handleGotoPosition);

    return () => {
      window.removeEventListener('monaco-goto-position', handleGotoPosition);
    };
  }, [filepath, isReady]);

  // Process pending navigation when editor becomes ready
  useEffect(() => {
    if (!isReady || !editorRef.current || !monacoRef.current || !filepath) return;

    const pending = pendingNavigationRef.current;
    if (!pending || pending.filePath !== filepath) return;

    console.log('[Monaco] Processing pending navigation:', pending);

    // Clear pending navigation
    pendingNavigationRef.current = null;

    const editor = editorRef.current;
    const monaco = monacoRef.current;

    // Reveal position
    editor.revealLineInCenter(pending.line);

    // If we have end coordinates, select the range
    if (pending.endLine !== undefined && pending.endColumn !== undefined) {
      editor.setSelection(new monaco.Selection(pending.line, pending.column, pending.endLine, pending.endColumn));
    } else {
      editor.setPosition({ lineNumber: pending.line, column: pending.column });
    }

    // Add line highlight decoration
    const model = editor.getModel();
    if (!model) return;

    const lineContent = model.getLineContent(pending.line);
    const range = new monaco.Range(pending.line, 1, pending.line, lineContent.length + 1);

    const decorations = editor.deltaDecorations(
      [],
      [
        {
          range,
          options: {
            isWholeLine: true,
            className: 'monaco-highlight-line',
            glyphMarginClassName: 'monaco-highlight-glyph',
          },
        },
      ],
    );

    setTimeout(() => {
      editor.deltaDecorations(decorations, []);
    }, 2000);

    editor.focus();
  }, [isReady, filepath]);

  // Handle "Go to Visual" action
  const handleGoToVisual = useCallback(async () => {
    if (!editorRef.current || !filepath || !engine) return;

    const editor = editorRef.current;
    const position = editor.getPosition();
    if (!position) return;

    const { lineNumber, column } = position;

    // Clean filepath from instance suffix (e.g., 'Button.tsx:default' -> 'Button.tsx')
    const cleanFilePath = filepath.split(':')[0];

    try {
      // Find element at cursor position
      const response = await authFetch('/api/find-element-at-position', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filePath: cleanFilePath,
          line: lineNumber,
          column,
        }),
      });

      if (!response.ok) {
        console.error('[Go to Visual] API request failed');
        toast({
          variant: 'destructive',
          title: 'Navigation Error',
          description: 'No JSX element found at cursor position',
        });
        return;
      }

      const data = await response.json();

      if (!data.success || !data.element) {
        console.error('[Go to Visual] No element found');
        toast({
          variant: 'destructive',
          title: 'Navigation Error',
          description: 'No JSX element found at cursor position',
        });
        return;
      }

      const { uniqId } = data.element;

      console.log('[Go to Visual] Found element with uniqId:', uniqId);

      // Check if we need to switch to a different component
      const currentComponentPath = meta?.relativeFilePath;
      const needsComponentSwitch = currentComponentPath !== cleanFilePath;

      if (needsComponentSwitch) {
        console.log('[Go to Visual] Switching component from', currentComponentPath, 'to', cleanFilePath);

        // Wait for component to load before selecting element
        const waitForComponentLoad = new Promise<void>((resolve) => {
          const handler = () => {
            window.removeEventListener('component-loaded', handler);
            resolve();
          };
          window.addEventListener('component-loaded', handler);

          // Timeout after 5 seconds
          setTimeout(() => {
            window.removeEventListener('component-loaded', handler);
            resolve();
          }, 5000);
        });

        // Load the component
        loadComponent(cleanFilePath);

        // Wait for component to load
        await waitForComponentLoad;

        // Small delay to ensure canvas is ready
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      // Switch to design mode
      engine.setMode('design');

      // Select element immediately - useEffect will handle waiting for iframe
      console.log('[Go to Visual] Selecting element:', uniqId);
      engine.select(uniqId);
    } catch (error) {
      console.error('[Go to Visual] Error:', error);
      toast({
        variant: 'destructive',
        title: 'Navigation Error',
        description: 'Failed to navigate to visual element',
      });
    }
  }, [filepath, engine, meta?.relativeFilePath, loadComponent]);

  // Add context menu and keybinding for "Go to Visual"
  useEffect(() => {
    if (!editorRef.current || !monacoRef.current || !isReady) return;

    const editor = editorRef.current;
    const monaco = monacoRef.current;

    // Add keybinding (Cmd+Shift+V)
    const disposable = editor.addAction({
      id: 'go-to-visual',
      label: 'Go to Visual',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyV],
      contextMenuGroupId: 'navigation',
      contextMenuOrder: 1.5,
      run: handleGoToVisual,
    });

    return () => {
      try {
        disposable.dispose();
      } catch {
        // Editor already disposed
      }
    };
  }, [isReady, handleGoToVisual]);

  // Add mode switching commands to command palette (F1)
  useEffect(() => {
    if (!editorRef.current || !monacoRef.current || !isReady || !engine) return;

    console.log('[MonacoEditor] Adding mode switching commands to command palette');

    const editor = editorRef.current;

    // Add actions to command palette
    const interactAction = editor.addAction({
      id: 'hyper-canvas.switchToInteract',
      label: 'Switch to Interact Mode',
      run: () => {
        console.log('[MonacoEditor] Command palette: switch to interact mode');
        engine.setMode('interact');
      },
    });

    const designAction = editor.addAction({
      id: 'hyper-canvas.switchToDesign',
      label: 'Switch to Design Mode',
      run: () => {
        console.log('[MonacoEditor] Command palette: switch to design mode');
        engine.setMode('design');
      },
    });

    return () => {
      console.log('[MonacoEditor] Disposing mode switching commands');
      try {
        interactAction?.dispose();
        designAction?.dispose();
      } catch {
        // Editor already disposed
      }
    };
  }, [isReady, engine]);

  // Load git diff and apply decorations
  useEffect(() => {
    if (!editorRef.current || !monacoRef.current || !isReady || !filepath) return;

    const editor = editorRef.current;
    const monaco = monacoRef.current;

    const loadGitDecorations = () => {
      // Fetch git diff for current file
      authFetch(`/api/git/diff?filepath=${encodeURIComponent(filepath)}`)
        .then((res) => res.json())
        .then((data) => {
          if (!data.success || !data.diff) {
            // Clear decorations if no diff
            if (gitDecorationsRef.current) {
              gitDecorationsRef.current.clear();
            }
            return;
          }

          const { changes } = data.diff;

          // Create decorations for changed lines
          const newDecorations = changes.map((change: GitDiffChange) => {
            const lineNumber = change.line || 1;

            // For deleted lines, show glyph margin (triangle) with hover message
            if (change.type === 'deleted') {
              const hoverMessage = change.deletedContent
                ? { value: `**Deleted:**\n\`\`\`\n${change.deletedContent}\n\`\`\`` }
                : { value: '**Deleted line**' };

              return {
                range: new monaco.Range(lineNumber, 1, lineNumber, 1),
                options: {
                  isWholeLine: true,
                  linesDecorationsClassName: 'git-line-deleted',
                  glyphMarginClassName: 'git-gutter-deleted',
                  glyphMarginHoverMessage: hoverMessage,
                  hoverMessage,
                },
              };
            }

            // For modified lines, show old content on hover
            if (change.type === 'modified' && change.deletedContent) {
              return {
                range: new monaco.Range(lineNumber, 1, lineNumber, 1),
                options: {
                  isWholeLine: true,
                  linesDecorationsClassName: 'git-line-modified',
                  glyphMarginClassName: 'git-gutter-modified',
                  hoverMessage: { value: `**Original:**\n\`\`\`\n${change.deletedContent}\n\`\`\`` },
                },
              };
            }

            // For added/modified lines, show both line highlight and glyph
            return {
              range: new monaco.Range(lineNumber, 1, lineNumber, 1),
              options: {
                isWholeLine: true,
                linesDecorationsClassName: change.type === 'added' ? 'git-line-added' : 'git-line-modified',
                glyphMarginClassName: `git-gutter-${change.type}`,
              },
            };
          });

          // Apply decorations
          if (gitDecorationsRef.current) {
            gitDecorationsRef.current.clear();
          }
          gitDecorationsRef.current = editor.createDecorationsCollection(newDecorations);
        })
        .catch((error) => {
          console.log('[MonacoEditor] Git diff not available:', error.message);
        });
    };

    // Load decorations initially
    loadGitDecorations();

    // Listen to content changes and reload decorations
    const model = editor.getModel();
    if (!model) return;

    const disposable = model.onDidChangeContent(() => {
      // Debounce to avoid too many requests
      const timeout = setTimeout(() => {
        loadGitDecorations();
      }, 500);

      return () => clearTimeout(timeout);
    });

    // Cleanup decorations when file changes
    return () => {
      try {
        disposable.dispose();
        if (gitDecorationsRef.current) {
          gitDecorationsRef.current.clear();
          gitDecorationsRef.current = null;
        }
      } catch {
        // Editor already disposed
      }
    };
  }, [filepath, isReady]);

  // Register git blame hover provider
  useEffect(() => {
    if (!monacoRef.current || !isReady || !filepath) return;

    const monaco = monacoRef.current;

    const hoverProvider = monaco.languages.registerHoverProvider(
      ['typescript', 'javascript', 'typescriptreact', 'javascriptreact'],
      {
        provideHover: async (model, position) => {
          // Only provide hover info for current file
          if (!filepath || !model.uri.path.endsWith(filepath)) {
            return null;
          }

          const lineNumber = position.lineNumber;

          // Show blame info
          try {
            const response = await authFetch(`/api/git/blame?filepath=${encodeURIComponent(filepath)}`);
            const data = await response.json();

            if (!data.success || !data.blame || !data.blame.lines[lineNumber]) {
              return null;
            }

            const lineBlame = data.blame.lines[lineNumber];
            const date = new Date(lineBlame.date).toLocaleDateString();

            return {
              range: new monaco.Range(lineNumber, 1, lineNumber, model.getLineMaxColumn(lineNumber)),
              contents: [
                { value: `**${lineBlame.author}** <${lineBlame.authorEmail}>` },
                { value: `${date} • ${lineBlame.hash.substring(0, 7)}` },
                { value: lineBlame.message },
              ],
            };
          } catch {
            // Silently fail if git blame is not available
            return null;
          }
        },
      },
    );

    return () => {
      try {
        hoverProvider.dispose();
      } catch {
        // Editor already disposed
      }
    };
  }, [filepath, isReady]);

  return (
    <div className="flex-1 bg-background relative">
      {!filepath && (
        <div className="absolute inset-0 flex items-center justify-center bg-background z-10">
          <div className="text-sm text-muted-foreground">No file selected</div>
        </div>
      )}
      {!isReady && filepath && (
        <div className="absolute inset-0 z-10">
          <textarea
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="w-full h-full resize-none bg-background font-mono text-sm text-foreground p-4 border-0 outline-none"
          />
        </div>
      )}
      <Editor
        height="100%"
        loading={null}
        onMount={handleEditorDidMount}
        theme={resolvedTheme === 'dark' ? 'vs-dark' : 'light'}
        options={{
          minimap: { enabled: false },
          fontSize: 13,
          lineNumbers: 'on',
          rulers: [],
          scrollBeyondLastLine: false,
          automaticLayout: true,
          tabSize: 2,
          insertSpaces: false,
          wordWrap: 'off',
          glyphMargin: true,
          // Enable IntelliSense
          quickSuggestions: {
            other: true,
            comments: false,
            strings: false,
          },
          suggestOnTriggerCharacters: true,
          acceptSuggestionOnEnter: 'on',
          tabCompletion: 'on',
          wordBasedSuggestions: 'currentDocument',
          suggest: {
            showWords: true,
            showKeywords: true,
            showSnippets: true,
            showFunctions: true,
            showConstructors: true,
            showFields: true,
            showVariables: true,
            showClasses: true,
            showStructs: true,
            showInterfaces: true,
            showModules: true,
            showProperties: true,
            showEvents: true,
            showOperators: true,
            showUnits: true,
            showValues: true,
            showConstants: true,
            showEnums: true,
            showEnumMembers: true,
          },
          // Hover info
          hover: {
            enabled: true,
          },
          // Parameter hints
          parameterHints: {
            enabled: true,
          },
        }}
      />
    </div>
  );
}
