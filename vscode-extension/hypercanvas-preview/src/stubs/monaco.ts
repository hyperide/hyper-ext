/** Stub: Monaco editor is not needed in VS Code extension */
export default () => null;
export const loader = { config: () => {} };
export class Delayer {
  trigger() {
    return Promise.resolve();
  }
}
