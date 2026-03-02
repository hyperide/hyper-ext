/** Stub: Monaco editor is not needed in VS Code extension */
export default () => null;
export const loader = { config: () => {} };
/** Stub for Monaco's Delayer debounce utility — trigger() resolves immediately */
export class Delayer {
  trigger<T>(task?: () => T | Promise<T>): Promise<T | undefined> {
    if (typeof task === 'function') {
      return Promise.resolve(task());
    }
    return Promise.resolve(undefined);
  }
}
