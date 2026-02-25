import { useEffect, useRef, useState, useCallback } from 'react';
import cn from 'clsx';
import { LazyEditor, type OnMount } from './LazyMonaco';
import { useTheme } from '@/components/ThemeProvider';
import type { TestGenerationEvent, InteractiveElementInfo } from '../../server/routes/generateTests';
import { authFetch } from '@/utils/authFetch';

// Get language from file extension
function getLanguageFromPath(filepath: string): string {
  const ext = filepath.split('.').pop()?.toLowerCase();

  const languageMap: Record<string, string> = {
    ts: 'typescript',
    tsx: 'typescript',
    js: 'javascript',
    jsx: 'javascript',
    json: 'json',
    css: 'css',
    scss: 'scss',
    html: 'html',
    md: 'markdown',
  };

  return languageMap[ext || ''] || 'plaintext';
}

interface TestGenerationModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectId?: string;
  componentPath: string;
  types?: ('unit' | 'e2e' | 'variants' | 'demo')[];
  force?: boolean;
}

type GenerationStatus = 'idle' | 'running' | 'success' | 'error';

interface GeneratedFile {
  type: string;
  path: string;
  relativePath: string;
  status: 'created' | 'skipped';
  reason?: string;
  enhanced?: boolean;
}

export function TestGenerationModal({
  isOpen,
  onClose,
  projectId,
  componentPath,
  types = ['unit', 'e2e', 'variants'],
  force = false,
}: TestGenerationModalProps) {
  const [status, setStatus] = useState<GenerationStatus>('idle');
  const [currentStep, setCurrentStep] = useState('');
  const [componentName, setComponentName] = useState('');
  const [interactiveElements, setInteractiveElements] = useState<InteractiveElementInfo[]>([]);
  const [cvaVariants, setCvaVariants] = useState<string[]>([]);
  const [generatedFiles, setGeneratedFiles] = useState<GeneratedFile[]>([]);
  const [logs, setLogs] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<GeneratedFile | null>(null);
  const [fileContent, setFileContent] = useState<string>('');
  const [loadingFile, setLoadingFile] = useState(false);

  const logsRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const hasStarted = useRef(false);
  const { resolvedTheme } = useTheme();

  const handleEditorMount: OnMount = useCallback((_editor, monaco) => {
    // Disable all diagnostics for readonly preview
    monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions({
      noSemanticValidation: true,
      noSyntaxValidation: true,
    });
    monaco.languages.typescript.javascriptDefaults.setDiagnosticsOptions({
      noSemanticValidation: true,
      noSyntaxValidation: true,
    });
  }, []);

  const addLog = useCallback((message: string) => {
    setLogs((prev) => [...prev, `[${new Date().toLocaleTimeString()}] ${message}`]);
  }, []);

  const loadFileContent = useCallback(async (file: GeneratedFile) => {
    setSelectedFile(file);
    setLoadingFile(true);
    try {
      // Use relativePath for the API (it joins with project path)
      const params = new URLSearchParams({ path: file.relativePath });
      if (projectId) {
        params.set('projectId', projectId);
      }
      const res = await authFetch(`/api/read-file?${params.toString()}`);
      const data = await res.json();
      if (data.success) {
        setFileContent(data.content);
      } else {
        setFileContent(`// Error loading file: ${data.error}`);
      }
    } catch (err) {
      setFileContent(`// Error loading file: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setLoadingFile(false);
    }
  }, [projectId]);

  const startGeneration = useCallback(async () => {
    setStatus('running');
    setError(null);
    setGeneratedFiles([]);
    setLogs([]);
    setInteractiveElements([]);
    setCurrentStep('Starting...');
    addLog('Starting test generation...');

    abortControllerRef.current = new AbortController();

    try {
      const response = await authFetch('/api/generate-tests/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          componentPath,
          types,
          force,
        }),
        signal: abortControllerRef.current.signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP error: ${response.status}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('No response body');
      }

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const event: TestGenerationEvent = JSON.parse(line.slice(6));
              handleEvent(event);
            } catch {
              // Skip malformed events
            }
          }
        }
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        addLog('Generation cancelled');
        setStatus('idle');
      } else {
        const message = err instanceof Error ? err.message : 'Unknown error';
        setError(message);
        addLog(`Error: ${message}`);
        setStatus('error');
      }
    }
  }, [projectId, componentPath, types, force, addLog]);

  const handleEvent = useCallback(
    (event: TestGenerationEvent) => {
      switch (event.type) {
        case 'start':
          addLog(`Generating tests for: ${event.componentPath}`);
          addLog(`Types: ${event.types.join(', ')}`);
          break;

        case 'analyzing':
          setCurrentStep(event.message);
          addLog(event.message);
          break;

        case 'analysis_complete':
          setComponentName(event.componentName);
          setInteractiveElements(event.interactiveElements);
          setCvaVariants(event.cvaVariants);
          addLog(`Component: ${event.componentName}`);
          addLog(`Found ${event.interactiveElements.length} interactive elements:`);
          for (const el of event.interactiveElements) {
            addLog(`  • ${el.type} → data-test-id="${el.suggestedTestId}" (line ${el.line})`);
          }
          if (event.cvaVariants.length > 0) {
            addLog(`CVA variants: ${event.cvaVariants.join(', ')}`);
          }
          break;

        case 'generating':
          setCurrentStep(event.message);
          addLog(event.message);
          break;

        case 'template_created':
          addLog(`📄 Template: ${event.relativePath}`);
          break;

        case 'enhancing':
          setCurrentStep(event.message);
          addLog(`🤖 ${event.message}`);
          break;

        case 'file_created': {
          const newFile: GeneratedFile = {
            type: event.testType,
            path: event.path,
            relativePath: event.relativePath,
            status: 'created',
            enhanced: event.enhanced,
          };
          setGeneratedFiles((prev) => [...prev, newFile]);
          // Clear "AI is improving..." status and show file was created
          setCurrentStep(`Created: ${event.relativePath}`);
          addLog(`✓ Created: ${event.relativePath}${event.enhanced ? ' (AI enhanced)' : ''}`);
          // Auto-show first created unit test
          if (event.testType === 'unit') {
            loadFileContent(newFile);
          }
          break;
        }

        case 'file_skipped':
          setGeneratedFiles((prev) => [
            ...prev,
            {
              type: event.testType,
              path: event.path,
              relativePath: event.relativePath,
              status: 'skipped',
              reason: event.reason,
            },
          ]);
          addLog(`⊘ Skipped: ${event.relativePath} (${event.reason})`);
          break;

        case 'warning':
          addLog(`⚠ ${event.message}`);
          break;

        case 'error':
          setError(event.message);
          addLog(`✕ Error: ${event.message}`);
          setStatus('error');
          break;

        case 'complete':
          setCurrentStep('Complete');
          addLog(`Generation complete! Created ${event.result.generatedFiles.length} files.`);
          setStatus('success');
          break;
      }
    },
    [addLog, loadFileContent],
  );

  // Auto-start when modal opens
  useEffect(() => {
    if (isOpen && !hasStarted.current && status === 'idle') {
      hasStarted.current = true;
      startGeneration();
    }
  }, [isOpen, status, startGeneration]);

  // Reset when modal closes
  useEffect(() => {
    if (!isOpen) {
      hasStarted.current = false;
      abortControllerRef.current?.abort();
      setStatus('idle');
      setCurrentStep('');
      setComponentName('');
      setInteractiveElements([]);
      setCvaVariants([]);
      setGeneratedFiles([]);
      setLogs([]);
      setError(null);
      setSelectedFile(null);
      setFileContent('');
    }
  }, [isOpen]);

  // Auto-scroll logs
  useEffect(() => {
    if (logsRef.current) {
      logsRef.current.scrollTop = logsRef.current.scrollHeight;
    }
  }, [logs]);

  const handleCancel = () => {
    abortControllerRef.current?.abort();
  };

  if (!isOpen) return null;

  const getStatusColor = () => {
    switch (status) {
      case 'success':
        return 'text-green-600';
      case 'error':
        return 'text-red-600';
      default:
        return 'text-blue-600';
    }
  };

  const getStatusIcon = () => {
    switch (status) {
      case 'success':
        return '✓';
      case 'error':
        return '✕';
      case 'running':
        return '◌';
      default:
        return '○';
    }
  };

  const createdCount = generatedFiles.filter((f) => f.status === 'created').length;
  const skippedCount = generatedFiles.filter((f) => f.status === 'skipped').length;

  // File viewer popup
  if (selectedFile) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
        <div className="bg-background rounded-lg shadow-xl w-full max-w-4xl max-h-[90vh] flex flex-col border border-border">
          <div className="flex items-center justify-between px-6 py-4 border-b border-border">
            <div>
              <h2 className="text-lg font-semibold text-foreground">{selectedFile.relativePath}</h2>
              <span className="text-xs text-muted-foreground">[{selectedFile.type}]</span>
            </div>
            <button
              type="button"
              onClick={() => setSelectedFile(null)}
              className="text-muted-foreground hover:text-foreground"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div className="flex-1 overflow-auto p-4">
            {loadingFile ? (
              <div className="flex items-center justify-center h-32">
                <svg className="w-6 h-6 animate-spin text-blue-500" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  />
                </svg>
              </div>
            ) : (
              <LazyEditor
                height="70vh"
                language={getLanguageFromPath(selectedFile.relativePath)}
                value={fileContent}
                theme={resolvedTheme === 'dark' ? 'vs-dark' : 'light'}
                onMount={handleEditorMount}
                options={{
                  readOnly: true,
                  minimap: { enabled: false },
                  fontSize: 12,
                  lineNumbers: 'on',
                  scrollBeyondLastLine: false,
                  wordWrap: 'on',
                  domReadOnly: true,
                }}
              />
            )}
          </div>
          <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-border">
            <button
              type="button"
              onClick={() => setSelectedFile(null)}
              className="px-4 py-2 text-sm font-medium text-foreground bg-muted hover:bg-accent rounded-md"
            >
              Back
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-background rounded-lg shadow-xl w-full max-w-2xl max-h-[80vh] flex flex-col border border-border">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="text-lg font-semibold text-foreground">Generate Tests</h2>
          <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {/* Status */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {status === 'running' && (
                <svg className="w-4 h-4 animate-spin text-blue-500" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  />
                </svg>
              )}
              <span className="text-sm text-muted-foreground">{currentStep}</span>
            </div>
            <span className={cn('text-sm font-medium', getStatusColor())}>
              {getStatusIcon()} {status.charAt(0).toUpperCase() + status.slice(1)}
            </span>
          </div>

          {/* Component Info */}
          {componentName && (
            <div className="p-3 bg-muted rounded-lg space-y-1">
              <div className="text-sm">
                <span className="font-medium">Component:</span> {componentName}
              </div>
              {cvaVariants.length > 0 && (
                <div className="text-sm text-muted-foreground">CVA variants: {cvaVariants.join(', ')}</div>
              )}
            </div>
          )}

          {/* Interactive Elements - data-test-id report */}
          {interactiveElements.length > 0 && (
            <div>
              <h3 className="text-sm font-medium text-foreground mb-2">
                Interactive Elements ({interactiveElements.length}) - suggested data-test-id
              </h3>
              <div className="bg-muted rounded-lg p-3 space-y-1.5 max-h-40 overflow-y-auto">
                {interactiveElements.map((el, index) => (
                  <div key={index} className="text-xs font-mono flex items-center gap-2">
                    <span className="text-purple-500 w-24 flex-shrink-0">{el.type}</span>
                    <span className="text-green-600">data-test-id="{el.suggestedTestId}"</span>
                    <span className="text-muted-foreground">:L{el.line}</span>
                    {el.text && <span className="text-muted-foreground truncate">"{el.text}"</span>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-lg">
              <p className="text-sm text-destructive">{error}</p>
            </div>
          )}

          {/* Generated Files */}
          {generatedFiles.length > 0 && (
            <div>
              <h3 className="text-sm font-medium text-foreground mb-2">
                Files ({createdCount} created, {skippedCount} skipped) - click to view
              </h3>
              <ul className="text-xs font-mono bg-muted rounded-lg p-3 space-y-1.5">
                {generatedFiles.map((file, index) => (
                  <li
                    key={index}
                    className={cn('flex items-start gap-2 rounded px-1 -mx-1', {
                      'text-green-600 cursor-pointer hover:bg-accent/50': file.status === 'created',
                      'text-muted-foreground': file.status === 'skipped' && file.reason !== 'File already exists',
                      'text-amber-600 cursor-pointer hover:bg-accent/50': file.status === 'skipped' && file.reason === 'File already exists',
                    })}
                    onClick={() => (file.status === 'created' || file.reason === 'File already exists') && loadFileContent(file)}
                  >
                    <span className="flex-shrink-0">{file.status === 'created' ? '✓' : '⊘'}</span>
                    <span className="break-all">
                      <span className="text-blue-500">[{file.type}]</span> {file.relativePath}
                      {file.enhanced && <span className="text-purple-500"> 🤖</span>}
                      {file.reason && <span className="text-muted-foreground"> ({file.reason})</span>}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Logs */}
          <div>
            <h3 className="text-sm font-medium text-foreground mb-2">Output</h3>
            <div
              ref={logsRef}
              className="text-xs font-mono bg-slate-900 text-slate-300 rounded-lg p-3 h-36 overflow-y-auto whitespace-pre-wrap"
            >
              {logs.map((log, index) => (
                <div key={index}>{log}</div>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-border">
          {status === 'running' ? (
            <button
              type="button"
              onClick={handleCancel}
              className="px-4 py-2 text-sm font-medium text-white bg-red-500 hover:bg-red-600 rounded-md"
            >
              Cancel
            </button>
          ) : (
            <>
              {status === 'error' && (
                <button
                  type="button"
                  onClick={() => {
                    hasStarted.current = false;
                    setStatus('idle');
                    setTimeout(() => startGeneration(), 0);
                  }}
                  className="px-4 py-2 text-sm font-medium text-white bg-blue-500 hover:bg-blue-600 rounded-md"
                >
                  Retry
                </button>
              )}
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-sm font-medium text-foreground bg-muted hover:bg-accent rounded-md"
              >
                Close
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
