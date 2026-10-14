import { registerInspection } from './repl-inspection';
import { createShapeLab } from './shape-lab';
import { ShapeLabView } from './ShapeLabView';
import { createElectricReader } from './electric-reader';
import { ElectricReaderView } from './ElectricReaderView';
import * as proto from './proto';
import { reactScope } from './jsx-sandbox';
import * as zustandVanilla from 'zustand/vanilla';
import * as zustandReact from 'zustand/react';
import { useShallow } from 'zustand/react/shallow';
import * as valtioVanilla from 'valtio/vanilla';
import * as valtioReact from 'valtio/react';
import * as immer from 'immer';
import { ScopeWorkbench } from './ScopeWorkbench';

export function replApi(log: (...args: unknown[]) => void, cleanup: (f: () => void) => void): Record<string, unknown> {
  return {
    ...proto,
    ...reactScope(),
    ScopeWorkbench,
    log,
    createShapeLab,
    ShapeLabView,
    ElectricReaderView,
    createStore<T extends object>(initial: T, opts?: Parameters<typeof proto.createStore>[1]) {
      const store = proto.createStore(initial, opts);
      return registerInspection(store, { read: () => store.snapshot(), subscribe: (notify) => store.onCommit(notify) });
    },
    signal<T>(value: T, name?: string) {
      const item = proto.signal(value, name);
      return registerInspection(item, { read: () => item.peek(), subscribe: (notify) => item.subscribe(notify) });
    },
    createElectricReader() {
      const reader = createElectricReader();
      cleanup(reader.stop);
      return reader;
    },
    watch(fn: () => void) {
      const off = proto.watch(fn);
      cleanup(off);
      return off;
    },
    createScope(...args: Parameters<typeof proto.createScope>) {
      const scope = proto.createScope(...args);
      cleanup(() => scope.end());
      return scope;
    },
    sleep(ms: number) {
      return new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, ms);
        cleanup(() => {
          clearTimeout(timer);
          reject(new Error('Session reset'));
        });
      });
    },
    memoryStorage() {
      const m = new Map<string, string>();
      return {
        getItem: (k: string) => m.get(k) ?? null,
        setItem: (k: string, v: string) => {
          m.set(k, v);
        },
      };
    },
    zustand: {
      ...zustandVanilla,
      ...zustandReact,
      useShallow,
      createStore<T>(initializer?: zustandVanilla.StateCreator<T>) {
        const create = (init: zustandVanilla.StateCreator<T>) => {
          const store = zustandVanilla.createStore(init);
          return registerInspection(store, {
            read: () => store.getState(),
            subscribe: (notify) => store.subscribe(notify),
          });
        };
        return initializer ? create(initializer) : create;
      },
    },
    valtio: {
      ...valtioVanilla,
      ...valtioReact,
      proxy<T extends object>(initial: T) {
        const value = valtioVanilla.proxy(initial);
        return registerInspection(value, {
          read: () => valtioVanilla.snapshot(value),
          subscribe: (notify) => valtioVanilla.subscribe(value, notify),
        });
      },
    },
    immer,
  };
}
