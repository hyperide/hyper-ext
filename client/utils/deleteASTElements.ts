import { authFetch } from '@/utils/authFetch';

/**
 * Delete multiple AST elements in the component file in a single operation
 * More efficient than multiple individual deleteASTElement calls
 */
export async function deleteASTElements(
  elementIds: string[],
  filePath: string,
): Promise<boolean> {
  try {
    const response = await authFetch('/api/delete-elements', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ elementIds, filePath }),
    });

    const result = await response.json();

    if (!result.success) {
      console.error('[DeleteASTElements] Failed:', result.error);
      return false;
    }

    console.log('[DeleteASTElements] Successfully deleted', result.deletedCount, 'elements');
    return true;
  } catch (error) {
    console.error('[DeleteASTElements] Error:', error);
    return false;
  }
}
