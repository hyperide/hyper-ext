import { useEffect, useRef, useState, useCallback, useMemo } from 'react';

import { AnsiUp } from 'ansi_up';
import cn from 'clsx';
import { authFetch } from '@/utils/authFetch';

import type { TestRunnerEvent } from '../../server/routes/runTests';

interface TestRunnerModalProps {
	isOpen: boolean;
	onClose: () => void;
	projectId: string;
	testPaths: string[];
}

type RunnerStatus = 'idle' | 'running' | 'success' | 'error' | 'installing';

interface TestResult {
	name: string;
	status: 'pass' | 'fail';
	error?: string;
}

export function TestRunnerModal({
	isOpen,
	onClose,
	projectId,
	testPaths,
}: TestRunnerModalProps) {
	const [status, setStatus] = useState<RunnerStatus>('idle');
	const [runner, setRunner] = useState<string>('');
	const [testResults, setTestResults] = useState<TestResult[]>([]);
	const [logs, setLogs] = useState<string[]>([]);
	const [error, setError] = useState<string | null>(null);
	const [missingPackages, setMissingPackages] = useState<string[]>([]);
	const [configErrors, setConfigErrors] = useState<{ errorType: string; message: string }[]>([]);
	const [summary, setSummary] = useState<{
		passed: number;
		failed: number;
		total: number;
	} | null>(null);

	const logsRef = useRef<HTMLDivElement>(null);
	const abortControllerRef = useRef<AbortController | null>(null);
	const hasStarted = useRef(false);

	// ANSI to HTML converter
	const ansiUp = useMemo(() => {
		const converter = new AnsiUp();
		converter.use_classes = true;
		return converter;
	}, []);

	const addLog = useCallback((message: string) => {
		setLogs((prev) => [...prev, message]);
	}, []);

	const handleEvent = useCallback(
		(event: TestRunnerEvent) => {
			switch (event.type) {
				case 'start':
					setRunner(event.runner);
					setStatus('running');
					addLog(`Running tests with ${event.runner}...`);
					addLog(`Test files: ${event.testPaths.length}`);
					break;

				case 'output':
					addLog(event.line);
					break;

				case 'test_pass':
					setTestResults((prev) => [
						...prev,
						{ name: event.name, status: 'pass' },
					]);
					break;

				case 'test_fail':
					setTestResults((prev) => [
						...prev,
						{ name: event.name, status: 'fail', error: event.error },
					]);
					break;

				case 'file_fail':
					setTestResults((prev) => [
						...prev,
						{ name: `[FILE] ${event.name}`, status: 'fail', error: event.error },
					]);
					break;

				case 'missing_packages':
					setMissingPackages(event.packages);
					addLog(`\nMissing packages: ${event.packages.join(', ')}`);
					break;

				case 'config_error':
					setConfigErrors((prev) => [
						...prev,
						{ errorType: event.errorType, message: event.message },
					]);
					break;

				case 'installing_deps':
					setStatus('installing');
					addLog(`\n${event.message}`);
					break;

				case 'complete':
					setSummary({
						passed: event.passed,
						failed: event.failed,
						total: event.total,
					});
					setStatus(event.failed > 0 ? 'error' : 'success');
					addLog(
						`\nCompleted: ${event.passed} passed, ${event.failed} failed, ${event.total} total`,
					);
					break;

				case 'error':
					setError(event.message);
					addLog(`Error: ${event.message}`);
					setStatus('error');
					break;
			}
		},
		[addLog],
	);

	const runTests = useCallback(
		async (installDeps = false) => {
			setStatus(installDeps ? 'installing' : 'running');
			setError(null);
			setTestResults([]);
			setLogs([]);
			setSummary(null);
			setMissingPackages([]);
			setConfigErrors([]);
			addLog(installDeps ? 'Installing dependencies and running tests...' : 'Starting test runner...');

			abortControllerRef.current = new AbortController();

			try {
				const response = await authFetch('/api/run-tests/stream', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						projectId,
						testPaths,
						installDeps,
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
								const event: TestRunnerEvent = JSON.parse(line.slice(6));
								handleEvent(event);
							} catch {
								// Skip malformed events
							}
						}
					}
				}
			} catch (err) {
				if ((err as Error).name === 'AbortError') {
					addLog('Test run cancelled');
					setStatus('idle');
				} else {
					const message = err instanceof Error ? err.message : 'Unknown error';
					setError(message);
					addLog(`Error: ${message}`);
					setStatus('error');
				}
			}
		},
		[projectId, testPaths, addLog, handleEvent],
	);

	// Auto-start when modal opens
	useEffect(() => {
		if (isOpen && !hasStarted.current && status === 'idle') {
			hasStarted.current = true;
			runTests(false);
		}
	}, [isOpen, status, runTests]);

	// Reset when modal closes
	useEffect(() => {
		if (!isOpen) {
			hasStarted.current = false;
			abortControllerRef.current?.abort();
			setStatus('idle');
			setRunner('');
			setTestResults([]);
			setLogs([]);
			setError(null);
			setSummary(null);
			setMissingPackages([]);
			setConfigErrors([]);
		}
	}, [isOpen]);

	// Auto-scroll logs
	// biome-ignore lint/correctness/useExhaustiveDependencies: logs change triggers scroll
	useEffect(() => {
		if (logsRef.current) {
			logsRef.current.scrollTop = logsRef.current.scrollHeight;
		}
	}, [logs]);

	const handleCancel = () => {
		abortControllerRef.current?.abort();
	};

	const handleInstallAndRetry = () => {
		// Don't reset hasStarted - we're manually triggering, not auto-starting
		runTests(true);
	};

	const handleRerun = () => {
		// Don't reset hasStarted - we're manually triggering, not auto-starting
		runTests(false);
	};

	const handleAutoFix = () => {
		// Build context for AI agent
		const configErrorsSummary = configErrors
			.map((e) => `- ${e.errorType}: ${e.message}`)
			.join('\n');

		const failedTests = testResults
			.filter((t) => t.status === 'fail')
			.map((t) => `- ${t.name}${t.error ? `: ${t.error}` : ''}`)
			.join('\n');

		const missingPkgs = missingPackages.length > 0
			? `\n**Missing Packages:** ${missingPackages.join(', ')}`
			: '';

		// Get last 30 lines of logs for context
		const recentLogs = logs.slice(-30).join('\n');

		const prompt = `Fix the test issues in this project.

**Test Runner:** ${runner}
**Test Paths:** ${testPaths.join(', ')}
${missingPkgs}

**Configuration Errors:**
${configErrorsSummary || 'None'}

**Failed Tests:**
${failedTests || 'None'}

**Recent Output (last 30 lines):**
\`\`\`
${recentLogs}
\`\`\`

Please analyze the errors and fix the issues. Common fixes:
- For missing packages: Install them using the project's package manager
- For jest-dom: Create vitest.setup.ts with \`import '@testing-library/jest-dom'\` and add it to vitest.config.ts setupFiles
- For playwright-vitest: Exclude e2e tests from vitest config or run them separately with \`npx playwright test\`

After fixing, use the run_tests tool to verify the tests pass.`;

		// Open AI chat with the prompt
		window.dispatchEvent(
			new CustomEvent('openAIChat', {
				detail: {
					prompt,
					forceNewChat: true,
				},
			}),
		);

		// Close the modal
		onClose();
	};

	if (!isOpen) return null;

	const getStatusColor = () => {
		switch (status) {
			case 'success':
				return 'text-green-600';
			case 'error':
				return 'text-red-600';
			case 'installing':
				return 'text-yellow-600';
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
			case 'installing':
				return '◌';
			default:
				return '○';
		}
	};

	const getStatusText = () => {
		switch (status) {
			case 'running':
				return 'Running tests...';
			case 'installing':
				return 'Installing dependencies...';
			case 'success':
				return 'All tests passed';
			case 'error':
				if (configErrors.length > 0) {
					return 'Configuration issues detected';
				}
				if (missingPackages.length > 0) {
					return 'Missing dependencies';
				}
				return 'Tests completed with failures';
			default:
				return 'Ready';
		}
	};

	const passedCount = testResults.filter((t) => t.status === 'pass').length;
	const failedCount = testResults.filter((t) => t.status === 'fail').length;
	const isRunning = status === 'running' || status === 'installing';

	return (
		<div className="fixed inset-0 z-[1100] flex items-center justify-center bg-black/50">
			<div className="bg-background rounded-lg shadow-xl w-full max-w-2xl max-h-[80vh] flex flex-col border border-border">
				{/* Header */}
				<div className="flex items-center justify-between px-6 py-4 border-b border-border">
					<div className="flex items-center gap-3">
						<h2 className="text-lg font-semibold text-foreground">Run Tests</h2>
						{runner && (
							<span className="text-xs px-2 py-0.5 bg-muted rounded">
								{runner}
							</span>
						)}
					</div>
					<button
						type="button"
						onClick={onClose}
						className="text-muted-foreground hover:text-foreground"
						aria-label="Close"
					>
						<svg
							className="w-5 h-5"
							fill="none"
							stroke="currentColor"
							viewBox="0 0 24 24"
							aria-hidden="true"
						>
							<path
								strokeLinecap="round"
								strokeLinejoin="round"
								strokeWidth={2}
								d="M6 18L18 6M6 6l12 12"
							/>
						</svg>
					</button>
				</div>

				{/* Content */}
				<div className="flex-1 overflow-y-auto p-6 space-y-4">
					{/* Status */}
					<div className="flex items-center justify-between">
						<div className="flex items-center gap-2">
							{isRunning && (
								<svg
									className="w-4 h-4 animate-spin text-blue-500"
									fill="none"
									viewBox="0 0 24 24"
									aria-hidden="true"
								>
									<circle
										className="opacity-25"
										cx="12"
										cy="12"
										r="10"
										stroke="currentColor"
										strokeWidth="4"
									/>
									<path
										className="opacity-75"
										fill="currentColor"
										d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
									/>
								</svg>
							)}
							<span className="text-sm text-muted-foreground">
								{getStatusText()}
							</span>
						</div>
						<span className={cn('text-sm font-medium', getStatusColor())}>
							{getStatusIcon()}{' '}
							{status.charAt(0).toUpperCase() + status.slice(1)}
						</span>
					</div>

					{/* Missing Packages Warning */}
					{missingPackages.length > 0 && status !== 'installing' && (
						<div className="p-3 bg-yellow-500/10 border border-yellow-500/20 rounded-lg">
							<p className="text-sm text-yellow-600 font-medium mb-1">
								Missing packages detected:
							</p>
							<p className="text-xs text-yellow-600/80 font-mono">
								{missingPackages.join(', ')}
							</p>
						</div>
					)}

					{/* Configuration Errors */}
					{configErrors.length > 0 && !isRunning && (
						<div className="p-3 bg-orange-500/10 border border-orange-500/20 rounded-lg space-y-2">
							<p className="text-sm text-orange-600 font-medium">
								Configuration issues detected:
							</p>
							{configErrors.map((err) => (
								<div key={err.errorType} className="text-xs text-orange-600/80">
									<span className="font-mono bg-orange-500/10 px-1 rounded">
										{err.errorType}
									</span>
									<span className="ml-2">{err.message}</span>
								</div>
							))}
						</div>
					)}

					{/* Summary */}
					{summary && (
						<div className="flex items-center gap-4 p-3 bg-muted rounded-lg">
							<div className="flex items-center gap-2">
								<span className="text-green-600 font-medium">
									{summary.passed}
								</span>
								<span className="text-xs text-muted-foreground">passed</span>
							</div>
							<div className="flex items-center gap-2">
								<span className="text-red-600 font-medium">
									{summary.failed}
								</span>
								<span className="text-xs text-muted-foreground">failed</span>
							</div>
							<div className="flex items-center gap-2">
								<span className="font-medium">{summary.total}</span>
								<span className="text-xs text-muted-foreground">total</span>
							</div>
						</div>
					)}

					{/* Error */}
					{error && (
						<div className="p-3 bg-destructive/10 border border-destructive/20 rounded-lg">
							<p className="text-sm text-destructive">{error}</p>
						</div>
					)}

					{/* Test Results */}
					{testResults.length > 0 && (
						<div>
							<h3 className="text-sm font-medium text-foreground mb-2">
								Test Results ({passedCount} passed, {failedCount} failed)
							</h3>
							<div className="bg-muted rounded-lg p-3 space-y-1 max-h-40 overflow-y-auto">
								{testResults.map((test) => (
									<div
										key={test.name}
										className={cn('text-xs flex items-center gap-2', {
											'text-green-600': test.status === 'pass',
											'text-red-600': test.status === 'fail',
										})}
									>
										<span>{test.status === 'pass' ? '✓' : '✕'}</span>
										<span className="truncate">{test.name}</span>
									</div>
								))}
							</div>
						</div>
					)}

					{/* Logs with ANSI color support */}
					<div>
						<h3 className="text-sm font-medium text-foreground mb-2">Output</h3>
						<div
							ref={logsRef}
							className="text-xs font-mono bg-slate-900 text-slate-300 rounded-lg p-3 h-48 overflow-y-auto whitespace-pre-wrap ansi-output"
						>
							{logs.map((log, idx) => (
								<div
									// biome-ignore lint/suspicious/noArrayIndexKey: logs are append-only
									key={idx}
									// biome-ignore lint/security/noDangerouslySetInnerHtml: ANSI to HTML conversion
									dangerouslySetInnerHTML={{ __html: ansiUp.ansi_to_html(log) }}
								/>
							))}
						</div>
					</div>
				</div>

				{/* Footer */}
				<div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-border">
					{isRunning ? (
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
									onClick={handleAutoFix}
									className="px-4 py-2 text-sm font-medium text-white bg-orange-500 hover:bg-orange-600 rounded-md"
								>
									AutoFix with AI
								</button>
							)}
							{missingPackages.length > 0 && (
								<button
									type="button"
									onClick={handleInstallAndRetry}
									className="px-4 py-2 text-sm font-medium text-white bg-yellow-500 hover:bg-yellow-600 rounded-md"
								>
									Install & Retry
								</button>
							)}
							{(status === 'error' || status === 'success') && (
								<button
									type="button"
									onClick={handleRerun}
									className="px-4 py-2 text-sm font-medium text-white bg-blue-500 hover:bg-blue-600 rounded-md"
								>
									Re-run
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

			{/* ANSI color styles */}
			<style>{`
				.ansi-output .ansi-black-fg { color: #4e4e4e; }
				.ansi-output .ansi-red-fg { color: #ff6b6b; }
				.ansi-output .ansi-green-fg { color: #69db7c; }
				.ansi-output .ansi-yellow-fg { color: #ffd43b; }
				.ansi-output .ansi-blue-fg { color: #74c0fc; }
				.ansi-output .ansi-magenta-fg { color: #da77f2; }
				.ansi-output .ansi-cyan-fg { color: #66d9e8; }
				.ansi-output .ansi-white-fg { color: #f8f9fa; }
				.ansi-output .ansi-bright-black-fg { color: #7f7f7f; }
				.ansi-output .ansi-bright-red-fg { color: #ff8787; }
				.ansi-output .ansi-bright-green-fg { color: #8ce99a; }
				.ansi-output .ansi-bright-yellow-fg { color: #ffe066; }
				.ansi-output .ansi-bright-blue-fg { color: #91d5ff; }
				.ansi-output .ansi-bright-magenta-fg { color: #e599f7; }
				.ansi-output .ansi-bright-cyan-fg { color: #99e9f2; }
				.ansi-output .ansi-bright-white-fg { color: #ffffff; }
				.ansi-output .ansi-black-bg { background-color: #4e4e4e; }
				.ansi-output .ansi-red-bg { background-color: #ff6b6b; }
				.ansi-output .ansi-green-bg { background-color: #69db7c; }
				.ansi-output .ansi-yellow-bg { background-color: #ffd43b; }
				.ansi-output .ansi-blue-bg { background-color: #74c0fc; }
				.ansi-output .ansi-magenta-bg { background-color: #da77f2; }
				.ansi-output .ansi-cyan-bg { background-color: #66d9e8; }
				.ansi-output .ansi-white-bg { background-color: #f8f9fa; }
				.ansi-output .ansi-bold { font-weight: bold; }
				.ansi-output .ansi-italic { font-style: italic; }
				.ansi-output .ansi-underline { text-decoration: underline; }
			`}</style>
		</div>
	);
}
