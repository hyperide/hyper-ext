import type { Page } from 'playwright';
/** Follow the actual mode selector before a scripted run; never force-click hidden controls. */
export async function chooseScriptedDemo(page: Page): Promise<void> {
  const pane = page.locator('.pane-primary');
  const button = pane.getByRole('button', { name: 'Scripted demo', exact: true });
  await button.click();
  if ((await button.getAttribute('aria-pressed')) !== 'true') throw Error('Demo mode was not selected');
  if (!(await pane.locator('.runall').isVisible())) throw Error('Selected demo action is not visible');
}
/** Source is now required visible, not an accordion that the test opens on behalf of the reader. */
export async function expectVisibleExampleSource(page: Page): Promise<void> {
  const source = page.locator('.pane-primary .guide-source');
  await source.locator('.cm-content:visible, .editor-static:visible').first().waitFor();
  if (!(await source.isVisible()) || (await source.evaluate((node) => !!node.closest('details:not([open])')))) {
    throw Error('Editable example source must not be hidden');
  }
}
