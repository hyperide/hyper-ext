/**
 * TSX clipboard utilities for copy/paste operations
 */

import { toast } from '@/hooks/use-toast';
import { authFetch } from '@/utils/authFetch';
import { getPreviewIframe } from '@/lib/dom-utils';

/**
 * Copy element as TSX code to system clipboard
 */
export async function copyElementAsTSX(
  elementId: string,
  filePath: string,
): Promise<boolean> {
  try {
    const response = await authFetch('/api/copy-element-tsx', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ elementId, filePath }),
    });

    const result = await response.json();

    if (!result.success || !result.tsx) {
      console.error('[TSX Clipboard] Copy failed:', result.error);
      toast({
        title: 'Copy failed',
        description: result.error || 'Could not copy element',
        variant: 'destructive',
      });
      return false;
    }

    // Copy TSX code to system clipboard
    await navigator.clipboard.writeText(result.tsx);
    console.log(`[TSX Clipboard] Copied to clipboard: ${result.tsx.substring(0, 100)}...`);
    toast({
      title: 'Copied',
      description: 'Element copied to clipboard',
    });
    return true;
  } catch (error) {
    console.error('[TSX Clipboard] Copy error:', error);
    toast({
      title: 'Copy failed',
      description: error instanceof Error ? error.message : 'Unknown error',
      variant: 'destructive',
    });
    return false;
  }
}

/**
 * Build CSS selector for element with optional instance scope
 */
function buildElementSelector(
  elementId: string,
  instanceId?: string | null,
): string {
  if (instanceId) {
    return `[data-canvas-instance-id="${instanceId}"] [data-uniq-id="${elementId}"]`;
  }
  return `[data-uniq-id="${elementId}"]`;
}

/**
 * Copy multiple elements as TSX code to system clipboard
 * If multiple elements, wraps them in React Fragment <>...</>
 */
export async function copyMultipleElementsAsTSX(
  elementIds: string[],
  filePath: string,
  instanceId?: string | null,
): Promise<boolean> {
  try {
    if (elementIds.length === 0) {
      console.warn('[TSX Clipboard] No elements to copy');
      return false;
    }

    // For single element, use the regular function
    if (elementIds.length === 1) {
      return copyElementAsTSX(elementIds[0], filePath);
    }

    // Sort elements by DOM order (not selection order)
    const iframe = getPreviewIframe();
    let sortedIds = elementIds;

    if (iframe?.contentDocument) {
      const doc = iframe.contentDocument;
      sortedIds = elementIds.slice().sort((a, b) => {
        const selectorA = buildElementSelector(a, instanceId);
        const selectorB = buildElementSelector(b, instanceId);
        const elA = doc.querySelector(selectorA);
        const elB = doc.querySelector(selectorB);
        if (!elA || !elB) return 0;

        const position = elA.compareDocumentPosition(elB);
        if (position & Node.DOCUMENT_POSITION_FOLLOWING) {
          return -1; // elA comes before elB
        }
        if (position & Node.DOCUMENT_POSITION_PRECEDING) {
          return 1; // elA comes after elB
        }
        return 0;
      });
      console.log('[TSX Clipboard] Sorted elements by DOM order:', sortedIds.map(id => id.substring(0, 8)));
    }

    // Fetch TSX for each element
    const tsxCodes: string[] = [];
    for (const elementId of sortedIds) {
      const response = await authFetch('/api/copy-element-tsx', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ elementId, filePath }),
      });

      const result = await response.json();

      if (!result.success || !result.tsx) {
        console.error('[TSX Clipboard] Copy failed for element:', elementId, result.error);
        toast({
          title: 'Copy failed',
          description: result.error || `Could not copy element ${elementId.substring(0, 8)}`,
          variant: 'destructive',
        });
        return false;
      }

      tsxCodes.push(result.tsx);
    }

    // Wrap multiple elements in React Fragment
    const combinedTsx = `<>\n${tsxCodes.join('\n')}\n</>`;

    // Copy to system clipboard
    await navigator.clipboard.writeText(combinedTsx);
    console.log(`[TSX Clipboard] Copied ${elementIds.length} elements to clipboard: ${combinedTsx.substring(0, 100)}...`);
    toast({
      title: 'Copied',
      description: `${elementIds.length} elements copied to clipboard`,
    });
    return true;
  } catch (error) {
    console.error('[TSX Clipboard] Copy error:', error);
    toast({
      title: 'Copy failed',
      description: error instanceof Error ? error.message : 'Unknown error',
      variant: 'destructive',
    });
    return false;
  }
}

/**
 * Paste TSX code from system clipboard and insert into parent
 */
export async function pasteElementFromTSX(
  parentId: string | null,
  filePath: string,
): Promise<string | null> {
  try {
    // Read TSX code from clipboard
    const tsxCode = await navigator.clipboard.readText();

    if (!tsxCode || tsxCode.trim().length === 0) {
      console.warn('[TSX Clipboard] Clipboard is empty');
      return null;
    }

    // Check if clipboard contains JSX-like code
    if (!tsxCode.includes('<') || !tsxCode.includes('>')) {
      console.warn('[TSX Clipboard] Clipboard does not contain valid TSX code');
      return null;
    }

    console.log('[TSX Clipboard] Pasting TSX from clipboard:', tsxCode.substring(0, 100) + '...');

    // Call API to paste element
    const response = await authFetch('/api/paste-element', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ parentId, filePath, tsxCode }),
    });

    const result = await response.json();

    if (!result.success || !result.newId) {
      console.error('[TSX Clipboard] Paste failed:', result.error);
      toast({
        title: 'Paste failed',
        description: result.error || 'Could not paste element',
        variant: 'destructive',
      });
      return null;
    }

    console.log('[TSX Clipboard] Successfully pasted, new ID:', result.newId);
    toast({
      title: 'Pasted',
      description: 'Element pasted successfully',
    });
    return result.newId;
  } catch (error) {
    console.error('[TSX Clipboard] Paste error:', error);
    toast({
      title: 'Paste failed',
      description: error instanceof Error ? error.message : 'Unknown error',
      variant: 'destructive',
    });
    return null;
  }
}

/**
 * Check if clipboard contains valid TSX code
 */
export async function hasValidTSXInClipboard(): Promise<boolean> {
  try {
    const text = await navigator.clipboard.readText();
    // Basic check: contains JSX-like syntax
    return text.includes('<') && text.includes('>');
  } catch (error) {
    console.error('[TSX Clipboard] Failed to read clipboard:', error);
    return false;
  }
}
