import { Runtime } from './core';

const runtime = new Runtime();
const cell = runtime.signal(1);
const result: number = runtime.transaction(() => {
  cell.set(2);
  return cell.get();
});
const projected: number = runtime.derive(() => result + cell.get()).get();
runtime.watch(
  () => projected,
  (value: number, previous: number) => {
    void value;
    void previous;
  },
);

// @ts-expect-error Async callbacks must not type-check as ordinary transactions.
runtime.transaction(async () => {
  cell.set(3);
});
// @ts-expect-error Derived computations must not return a promise.
runtime.derive(() => Promise.resolve(1));
runtime.watch(
  // @ts-expect-error Async readers cannot create tracked observers.
  async () => cell.get(),
  () => {},
);
// @ts-expect-error The signal retains its value type.
cell.set('wrong');
// @ts-expect-error A conditional promise is still an async boundary.
runtime.transaction(() => (cell.get() ? 1 : Promise.resolve(1)));
