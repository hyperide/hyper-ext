import { useState, useRef, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { IconGitBranch, IconLoader2, IconRefresh, IconPlayerStop, IconCheck, IconSettings } from '@tabler/icons-react';
import { toast } from 'sonner';
import { authFetch } from '@/utils/authFetch';
import { useGitStore } from '@/stores/gitStore';
import { useAuthStore } from '@/stores/authStore';

type FlowState = 'idle' | 'generating' | 'editing' | 'pushing';

interface PushPopoverProps {
	disabled?: boolean;
	fileCount?: number;
}

export function PushPopover({ disabled, fileCount }: PushPopoverProps) {
	const navigate = useNavigate();
	const { currentWorkspace } = useAuthStore();
	const [isOpen, setIsOpen] = useState(false);
	const [state, setState] = useState<FlowState>('idle');
	const setIsPushPopoverOpen = useGitStore((s) => s.setIsPushPopoverOpen);
	const [commitMessage, setCommitMessage] = useState('');
	const [error, setError] = useState<string | null>(null);
	const abortControllerRef = useRef<AbortController | null>(null);
	const textareaRef = useRef<HTMLTextAreaElement>(null);

	const generateCommitMessage = useCallback(async () => {
		setState('generating');
		setCommitMessage('');
		setError(null);

		abortControllerRef.current = new AbortController();

		try {
			const response = await authFetch('/api/git/generate-commit-message', {
				method: 'POST',
				signal: abortControllerRef.current.signal,
			});

			if (!response.ok) {
				// Try to parse error as JSON, fallback to text
				const text = await response.text();
				let errorMessage = 'Failed to generate commit message';
				try {
					const data = JSON.parse(text);
					errorMessage = data.error || errorMessage;
				} catch {
					errorMessage = text || errorMessage;
				}
				throw new Error(errorMessage);
			}

			const reader = response.body?.getReader();
			if (!reader) throw new Error('No response body');

			const decoder = new TextDecoder();
			let buffer = '';

			while (true) {
				const { done, value } = await reader.read();
				if (done) break;

				buffer += decoder.decode(value, { stream: true });
				const lines = buffer.split('\n');
				buffer = lines.pop() || '';

				for (const line of lines) {
					const trimmedLine = line.trim();
					if (!trimmedLine || !trimmedLine.startsWith('data:')) continue;

					// Handle both 'data: ' and 'data:' formats
					const jsonStr = trimmedLine.startsWith('data: ')
						? trimmedLine.slice(6)
						: trimmedLine.slice(5);

					if (jsonStr === '[DONE]') continue;
					if (!jsonStr) continue;

					try {
						const data = JSON.parse(jsonStr);
						if (data.delta) {
							setCommitMessage((prev) => prev + data.delta);
						}
					} catch (parseErr) {
						console.warn('[PushPopover] SSE parse error:', parseErr, 'line:', trimmedLine);
					}
				}
			}

			setState('editing');
		} catch (err) {
			if (err instanceof Error && err.name === 'AbortError') {
				setState('editing');
				return;
			}
			console.error('Generate commit message error:', err);
			setError(err instanceof Error ? err.message : 'Failed to generate');
			setState('idle');
		}
	}, []);

	const handleStop = useCallback(() => {
		abortControllerRef.current?.abort();
		setState('editing');
	}, []);

	const handlePush = useCallback(async () => {
		if (!commitMessage.trim()) return;

		setState('pushing');
		setError(null);

		try {
			const response = await authFetch('/api/git/push', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ message: commitMessage.trim() }),
			});

			if (!response.ok) {
				const data = await response.json();
				throw new Error(data.error || 'Failed to push');
			}

			toast.success('Changes pushed successfully');
			setIsOpen(false);
			setCommitMessage('');
			setState('idle');
		} catch (err) {
			console.error('Push error:', err);
			setError(err instanceof Error ? err.message : 'Failed to push');
			setState('editing');
		}
	}, [commitMessage]);

	const handleRegenerate = useCallback(() => {
		generateCommitMessage();
	}, [generateCommitMessage]);

	// Auto-generate on open
	useEffect(() => {
		if (isOpen && state === 'idle' && !commitMessage) {
			generateCommitMessage();
		}
	}, [isOpen, state, commitMessage, generateCommitMessage]);

	// Focus textarea when entering editing state
	useEffect(() => {
		if (state === 'editing') {
			setTimeout(() => textareaRef.current?.focus(), 0);
		}
	}, [state]);

	// Keyboard shortcut: Cmd/Ctrl+Enter to push
	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			if (!isOpen) return;
			if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && state === 'editing' && commitMessage.trim()) {
				e.preventDefault();
				handlePush();
			}
		};
		window.addEventListener('keydown', handleKeyDown);
		return () => window.removeEventListener('keydown', handleKeyDown);
	}, [isOpen, state, commitMessage, handlePush]);

	// Update parent state when popover opens/closes
	const handleOpenChange = useCallback((open: boolean) => {
		setIsOpen(open);
		setIsPushPopoverOpen(open);
	}, [setIsPushPopoverOpen]);

	const handleOpenWorkspaceSettings = useCallback(() => {
		if (!currentWorkspace) return;
		setIsOpen(false);
		navigate(`/workspaces/${currentWorkspace.slug}/settings`);
	}, [currentWorkspace, navigate]);

	return (
		<Popover open={isOpen} onOpenChange={handleOpenChange}>
			<PopoverTrigger asChild>
				<Button variant="default" size="sm" disabled={disabled} className="gap-1">
					<IconGitBranch className="w-4 h-4" />
					Push
					{fileCount !== undefined && fileCount > 0 && (
						<span className="ml-1 px-1.5 py-0.5 text-xs rounded-full bg-primary-foreground/20">
							{fileCount}
						</span>
					)}
				</Button>
			</PopoverTrigger>
			<PopoverContent className="w-96 p-4" align="end">
				<div className="space-y-3">
					<div className="flex items-center justify-between">
						<h4 className="font-medium">Commit Message</h4>
						{state === 'generating' && (
							<Button variant="ghost" size="sm" onClick={handleStop} className="h-7 px-2">
								<IconPlayerStop className="w-3 h-3 mr-1" />
								Stop
							</Button>
						)}
					</div>

					<div className="relative">
						<Textarea
							ref={textareaRef}
							value={commitMessage}
							onChange={(e) => setCommitMessage(e.target.value)}
							placeholder={state === 'generating' ? 'Generating...' : 'Enter commit message...'}
							className="min-h-[100px] resize-none pr-8"
							disabled={state === 'generating' || state === 'pushing'}
						/>
						{state === 'generating' && (
							<div className="absolute right-2 top-2">
								<IconLoader2 className="w-4 h-4 animate-spin text-muted-foreground" />
							</div>
						)}
					</div>

					{error && <p className="text-sm text-destructive">{error}</p>}

					<div className="flex items-center justify-between">
						<div className="flex items-center gap-1">
							<Button
								variant="ghost"
								size="sm"
								onClick={handleRegenerate}
								disabled={state === 'generating' || state === 'pushing'}
								className="h-8"
							>
								<IconRefresh className="w-4 h-4 mr-1" />
								Regenerate
							</Button>
							{currentWorkspace && (
								<button
									type="button"
									onClick={handleOpenWorkspaceSettings}
									className="h-8 w-8 flex items-center justify-center rounded-md hover:bg-muted text-muted-foreground hover:text-foreground"
									title="Edit commit prompt in workspace settings"
								>
									<IconSettings className="w-4 h-4" />
								</button>
							)}
						</div>

						<Button
							size="sm"
							onClick={handlePush}
							disabled={state === 'generating' || state === 'pushing' || !commitMessage.trim()}
							className="h-8"
						>
							{state === 'pushing' ? (
								<>
									<IconLoader2 className="w-4 h-4 mr-1 animate-spin" />
									Pushing...
								</>
							) : (
								<>
									<IconGitBranch className="w-4 h-4 mr-1" />
									Push
								</>
							)}
						</Button>
					</div>

					<p className="text-xs text-muted-foreground">
						<kbd className="px-1 py-0.5 rounded bg-muted text-muted-foreground">⌘</kbd>
						<kbd className="px-1 py-0.5 rounded bg-muted text-muted-foreground ml-0.5">↵</kbd>
						<span className="ml-1">to push</span>
					</p>
				</div>
			</PopoverContent>
		</Popover>
	);
}
