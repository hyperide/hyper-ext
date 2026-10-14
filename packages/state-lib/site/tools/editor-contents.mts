import type { Locator } from 'playwright';

/** Read through the editor's real copy handler, including virtualized offscreen lines.
 * A synthetic clipboard event never writes the host machine's clipboard. */
export async function readEditorContents(content: Locator): Promise<string> {
  await content.focus();
  await content.press('ControlOrMeta+A');
  return content.evaluate((element) => {
    const clipboardData = new DataTransfer();
    const event = new ClipboardEvent('copy', { clipboardData, bubbles: true, cancelable: true });
    element.dispatchEvent(event);
    if (!event.defaultPrevented) throw new Error('The editor did not handle the copy event');
    return clipboardData.getData('text/plain');
  });
}
