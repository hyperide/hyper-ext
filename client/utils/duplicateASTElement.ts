import { authFetch } from '@/utils/authFetch';

/**
 * Duplicate AST element in the component file
 */
export async function duplicateASTElement(elementId: string, filePath: string): Promise<string | null> {
  try {
    const response = await authFetch('/api/duplicate-element', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ elementId, filePath }),
    });

    const result = await response.json();

    if (!result.success || !result.newId) {
      console.error('[DuplicateAST] Failed:', result.error);
      return null;
    }

    console.log('[DuplicateAST] Successfully duplicated:', elementId, '→', result.newId);
    return result.newId;
  } catch (error) {
    console.error('[DuplicateAST] Error:', error);
    return null;
  }
}
