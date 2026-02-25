import { authFetch } from '@/utils/authFetch';

/**
 * Wrap element in another element (e.g., div)
 */
export async function wrapElement(
  elementId: string,
  filePath: string,
  wrapperTag: string = 'div',
): Promise<string | null> {
  try {
    const response = await authFetch('/api/wrap-element', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ elementId, filePath, wrapperTag }),
    });

    const result = await response.json();

    if (!result.success || !result.wrapperId) {
      console.error('[WrapElement] Failed:', result.error);
      return null;
    }

    console.log('[WrapElement] Successfully wrapped:', elementId, '→', result.wrapperId);
    return result.wrapperId;
  } catch (error) {
    console.error('[WrapElement] Error:', error);
    return null;
  }
}
