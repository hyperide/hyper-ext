/**
 * Client-side helpers for file snapshot undo/redo.
 * Communicates with server-side snapshot store (PostgreSQL) to restore file content.
 *
 * Note: snapshot SAVING is handled by server middleware (fileSnapshotMiddleware)
 * which automatically saves file content before any mutating AST endpoint.
 * The snapshotId is returned in the endpoint's JSON response.
 */
import { authFetch } from '@/utils/authFetch';

/**
 * Restore a file from a previously saved snapshot.
 * Also triggers component reparse to update the AST tree and iframe.
 */
export async function restoreFileSnapshot(
	snapshotId: number,
	filePath: string,
): Promise<void> {
	const response = await authFetch('/api/file-snapshot/restore', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ snapshotId }),
	});

	const data = await response.json();
	if (!data.success) {
		throw new Error(data.error || 'Failed to restore file snapshot');
	}

	// Trigger component reload so the iframe and AST tree update
	const parseResponse = await authFetch(
		`/api/parse-component?path=${encodeURIComponent(filePath)}&skipSampleDefault=true`,
	);
	if (parseResponse.ok) {
		const parseData = await parseResponse.json();
		window.dispatchEvent(
			new CustomEvent('component-loaded', { detail: parseData }),
		);
	}
}

/**
 * Clear all snapshots on the server (e.g., when switching components).
 */
export async function clearFileSnapshots(): Promise<void> {
	await authFetch('/api/file-snapshot/clear', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
	});
}
