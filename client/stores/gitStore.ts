import { create } from 'zustand';
import { toast } from 'sonner';
import { authFetch } from '@/utils/authFetch';

export interface GitFileStatus {
	path: string;
	status: 'M' | 'A' | 'D' | 'R' | '?' | '!'; // Modified, Added, Deleted, Renamed, Untracked, Ignored
	staged: boolean;
}

export type FlowState = 'idle' | 'generating' | 'editing' | 'pushing';

interface GitState {
	// Push popover state
	isPushPopoverOpen: boolean;
	setIsPushPopoverOpen: (open: boolean) => void;

	// SSE git status (lightweight, updated via SSE)
	hasUnpushedChanges: boolean;
	unpushedFileCount: number;
	updateFromSSE: (git: { hasChanges: boolean; fileCount: number }) => void;

	// Changed files (detailed, loaded on demand)
	changedFiles: GitFileStatus[];
	isLoadingChanges: boolean;
	setChangedFiles: (files: GitFileStatus[]) => void;
	setIsLoadingChanges: (loading: boolean) => void;

	// Commit state
	commitMessage: string;
	flowState: FlowState;
	commitError: string | null;
	setCommitMessage: (message: string) => void;
	setFlowState: (state: FlowState) => void;
	setCommitError: (error: string | null) => void;

	// Abort controller for streaming
	abortController: AbortController | null;
	setAbortController: (controller: AbortController | null) => void;

	// Actions
	fetchChangedFiles: () => Promise<void>;
	generateCommitMessage: () => Promise<void>;
	stopGeneration: () => void;
	pushChanges: () => Promise<boolean>;
	resetCommitState: () => void;

	// Git status listener (listens to window events from consolidated SSE)
	setupGitStatusListener: () => () => void;
}

export const useGitStore = create<GitState>((set, get) => ({
	isPushPopoverOpen: false,
	setIsPushPopoverOpen: (open: boolean) => {
		if (!open) {
			// Reset commit state when closing
			get().resetCommitState();
		}
		set({ isPushPopoverOpen: open });
	},

	// SSE git status
	hasUnpushedChanges: false,
	unpushedFileCount: 0,
	updateFromSSE: (git: { hasChanges: boolean; fileCount: number }) => {
		set({ hasUnpushedChanges: git.hasChanges, unpushedFileCount: git.fileCount });
	},

	changedFiles: [],
	isLoadingChanges: false,
	setChangedFiles: (files: GitFileStatus[]) => set({ changedFiles: files }),
	setIsLoadingChanges: (loading: boolean) => set({ isLoadingChanges: loading }),

	// Commit state
	commitMessage: '',
	flowState: 'idle',
	commitError: null,
	setCommitMessage: (message: string) => set({ commitMessage: message }),
	setFlowState: (state: FlowState) => set({ flowState: state }),
	setCommitError: (error: string | null) => set({ commitError: error }),

	abortController: null,
	setAbortController: (controller: AbortController | null) => set({ abortController: controller }),

	fetchChangedFiles: async () => {
		set({ isLoadingChanges: true });
		try {
			const response = await authFetch('/api/git/status');
			if (response.ok) {
				const data = await response.json();
				if (data.success && data.status?.files) {
					const files: GitFileStatus[] = data.status.files.map((f: { path: string; index: string; working_dir: string }) => ({
						path: f.path,
						status: f.index !== ' ' ? f.index : f.working_dir,
						staged: f.index !== ' ' && f.index !== '?',
					}));
					set({ changedFiles: files });
				}
			}
		} catch (error) {
			console.error('[gitStore] Failed to fetch changed files:', error);
		} finally {
			set({ isLoadingChanges: false });
		}
	},

	generateCommitMessage: async () => {
		set({ flowState: 'generating', commitMessage: '', commitError: null });

		const controller = new AbortController();
		set({ abortController: controller });

		try {
			const response = await authFetch('/api/git/generate-commit-message', {
				method: 'POST',
				signal: controller.signal,
			});

			if (!response.ok) {
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

					const jsonStr = trimmedLine.startsWith('data: ')
						? trimmedLine.slice(6)
						: trimmedLine.slice(5);

					if (jsonStr === '[DONE]') continue;
					if (!jsonStr) continue;

					try {
						const event = JSON.parse(jsonStr);
						if (event.type === 'delta') {
							set((state) => ({ commitMessage: state.commitMessage + event.content }));
						} else if (event.type === 'error') {
							throw new Error(event.content);
						}
					} catch (parseErr) {
						console.warn('[gitStore] SSE parse error:', parseErr, 'line:', trimmedLine);
					}
				}
			}

			set({ flowState: 'editing' });
		} catch (err) {
			if (err instanceof Error && err.name === 'AbortError') {
				set({ flowState: 'editing' });
				return;
			}
			set({ commitError: err instanceof Error ? err.message : 'Unknown error', flowState: 'editing' });
		} finally {
			set({ abortController: null });
		}
	},

	stopGeneration: () => {
		const { abortController } = get();
		if (abortController) {
			abortController.abort();
		}
		set({ flowState: 'editing' });
	},

	pushChanges: async () => {
		const { commitMessage } = get();

		if (!commitMessage.trim()) {
			set({ commitError: 'Commit message is required' });
			return false;
		}

		set({ flowState: 'pushing', commitError: null });

		try {
			const response = await authFetch('/api/git/push', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ message: commitMessage.trim() }),
			});

			const data = await response.json();

			if (!data.success) {
				throw new Error(data.error || 'Push failed');
			}

			// Success - reset state and close
			set({
				isPushPopoverOpen: false,
				flowState: 'idle',
				commitMessage: '',
				changedFiles: [],
				hasUnpushedChanges: false,
				unpushedFileCount: 0,
			});

			toast.success('Pushed successfully!', {
				description: data.commitUrl ? `View commit: ${data.commitUrl}` : undefined,
			});

			return true;
		} catch (err) {
			set({ commitError: err instanceof Error ? err.message : 'Push failed', flowState: 'editing' });
			return false;
		}
	},

	resetCommitState: () => {
		const { abortController } = get();
		if (abortController) {
			abortController.abort();
		}
		set({
			commitMessage: '',
			flowState: 'idle',
			commitError: null,
			abortController: null,
		});
	},

	// Git status listener - listens to window events from consolidated SSE in useProjectSSE
	// Git status is sent with both 'git_status_changed' and 'components_updated' events
	setupGitStatusListener: () => {
		const handler = (event: Event) => {
			const customEvent = event as CustomEvent<{ hasChanges: boolean; fileCount: number }>;
			if (customEvent.detail) {
				set({
					hasUnpushedChanges: customEvent.detail.hasChanges,
					unpushedFileCount: customEvent.detail.fileCount,
				});
			}
		};

		window.addEventListener('git_status_changed', handler);
		window.addEventListener('components_updated', handler);
		return () => {
			window.removeEventListener('git_status_changed', handler);
			window.removeEventListener('components_updated', handler);
		};
	},
}));
