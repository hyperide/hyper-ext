/** Stub: Monaco editor is not needed in VS Code extension */
export default () => null;
export const loader = { config: () => {} };
/** Stub for Monaco's Delayer debounce utility — trigger() resolves immediately */
export class Delayer {
  trigger(): Promise<void> {
    return Promise.resolve();
  }
}
