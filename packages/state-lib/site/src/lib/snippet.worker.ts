/// <reference lib="webworker" />
import { transform } from 'sucrase';
import _ from 'lodash';
import * as R from 'ramda';
import * as I from 'immutable';
import * as immer from 'immer';
import * as db from '@tanstack/db';
import { view } from './view-plan';
// Sucrase must preserve the callable default while exposing Lodash's named exports.
const lodashModule = Object.assign(Object.create(null), _, { __esModule: true, default: _ });
const modules: Record<string, unknown> = {
  lodash: lodashModule,
  ramda: R,
  immutable: I,
  immer,
  '@tanstack/db': db,
  './view-plan': { view },
};
const log = (...xs: unknown[]) =>
  postMessage({
    type: 'log',
    text: xs
      .map((x) => {
        try {
          return typeof x === 'string' ? x : JSON.stringify(x, null, 2);
        } catch {
          return String(x);
        }
      })
      .join(' '),
  });
self.onmessage = async (event: MessageEvent<unknown>) => {
  // Dedicated workers receive an empty origin over their owned port; a supplied
  // origin must match. This is not a Window listener or a sandbox for hostile code.
  if (event.origin !== '' && event.origin !== self.location.origin) return;
  if (
    !event.data ||
    typeof event.data !== 'object' ||
    !('code' in event.data) ||
    typeof event.data.code !== 'string' ||
    event.data.code.length > 100_000
  ) {
    postMessage({ type: 'error', text: 'Expected a source string of at most 100000 characters.' });
    return;
  }
  try {
    const source = transform(event.data.code, { transforms: ['typescript', 'imports'] }).code;
    const require = (name: string) => {
      if (!Object.hasOwn(modules, name))
        throw new Error(
          `Runtime not loaded: ${name}. This REPL supports lodash, ramda, immutable, immer, @tanstack/db and the local ./view-plan proposal. Framework and database-client examples remain references.`,
        );
      return modules[name];
    };
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    await new AsyncFunction('require', 'exports', 'module', 'log', 'console', source)(
      require,
      {},
      { exports: {} },
      log,
      { log, info: log, warn: log, error: log },
    );
    postMessage({ type: 'done' });
  } catch (e) {
    postMessage({ type: 'error', text: String(e) });
  }
};
