/** Stub: Monaco editor is not needed in VS Code extension */
export default () => null;
export const loader = { config: () => {} };
export const Delayer = class {
  trigger() {
    return Promise.resolve();
  }
};
