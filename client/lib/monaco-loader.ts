/**
 * Configure @monaco-editor/react to load Monaco from node_modules
 * instead of CDN (cdn.jsdelivr.net). This ensures the bundled version
 * matches the installed monaco-editor package (v0.55+).
 *
 * This file uses a synchronous import of monaco-editor, so it MUST only
 * be imported from lazy-loaded chunks (React.lazy factories) to avoid
 * pulling ~4-6 MB into the main bundle.
 */
import { loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';
// eslint-disable-next-line -- internal Monaco module, needed to patch Delayer bug
import { Delayer } from 'monaco-editor/esm/vs/base/common/async.js';

// Monaco v0.55 bug: Delayer.cancel() rejects completionPromise with CancellationError
// but nobody catches it → unhandled promise rejection → Bun HMR error overlay.
// Patch: mark the promise as handled before rejecting.
const originalCancel = Delayer.prototype.cancel;
Delayer.prototype.cancel = function (this: InstanceType<typeof Delayer>) {
  if (this.completionPromise) {
    this.completionPromise.catch(() => {});
  }
  originalCancel.call(this);
};

// Tell Monaco where to find pre-built web workers (built by scripts/build-monaco-workers.ts)
self.MonacoEnvironment = {
  getWorkerUrl(_moduleId: string, label: string) {
    if (label === 'typescript' || label === 'javascript') return '/monaco-workers/language/typescript/ts.worker.js';
    if (label === 'json') return '/monaco-workers/language/json/json.worker.js';
    if (label === 'css' || label === 'scss' || label === 'less') return '/monaco-workers/language/css/css.worker.js';
    if (label === 'html' || label === 'handlebars' || label === 'razor')
      return '/monaco-workers/language/html/html.worker.js';
    return '/monaco-workers/editor/editor.worker.js';
  },
};

loader.config({ monaco });
