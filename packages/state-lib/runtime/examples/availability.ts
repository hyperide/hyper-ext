import assert from 'node:assert/strict';
import { Runtime } from '../src/core';
import { latestTask } from '../src/latest-task';

// Original runnable reduction of a booking availability interaction, not Cal.com's app.
// Network timing is controlled so that the stale-response race is reproducible.
const runtime = new Runtime();
const selectedDate = runtime.signal('');
const status = runtime.signal<'idle' | 'loading' | 'ready' | 'cancelled'>('idle');
const availability = runtime.signal<{ forDate: string; slots: string[] }>({ forDate: '', slots: [] });
const screen = runtime.derive(() => {
  const date = selectedDate.get(),
    response = availability.get();
  if (status.get() === 'cancelled') return `${date} | cancelled`;
  if (status.get() === 'loading') return `${date} | loading…`;
  return response.forDate === date
    ? `${date || 'Choose a date'} | ${response.slots.join(', ') || 'no slots'}`
    : `${date} | loading…`;
});
const stop = screen.subscribe((value) => console.info(`UI: ${value}`));
const network = new Map<string, (slots: string[]) => void>();
const load = latestTask(
  runtime,
  (date: string) =>
    new Promise<string[]>((resolve) => {
      network.set(date, resolve); // Deliberately ignores AbortSignal: identity must still protect the UI.
    }),
  (slots, forDate) => {
    availability.set({ forDate, slots });
    status.set('ready');
  },
);

function choose(date: string) {
  runtime.transaction(() => {
    selectedDate.set(date);
    status.set('loading');
  });
  return load.run(date); // Async work starts outside synchronous transactions.
}
const monday = choose('2026-09-21');
const tuesday = choose('2026-09-22');
network.get('2026-09-22')!(['10:00', '11:30']);
assert.equal(await tuesday, 'committed');
network.get('2026-09-21')!(['09:00']); // The old response arrives last.
assert.equal(await monday, 'superseded');
assert.equal(screen.get(), '2026-09-22 | 10:00, 11:30');
console.info('PASS: the old response did not change Tuesday availability.');

const abandoned = choose('2026-09-23');
load.cancel();
status.set('cancelled');
assert.equal(await abandoned, 'cancelled'); // Does not wait for the non-cooperative network.
network.get('2026-09-23')!(['08:00']);
await Promise.resolve();
assert.equal(availability.get().forDate, '2026-09-22');
assert.equal(screen.get(), '2026-09-23 | cancelled');
console.info('PASS: cancellation settled immediately and late output was ignored.');
console.info('Availability is advisory: final booking must still be validated by the server.');
stop();
load.dispose();
runtime.dispose();
network.clear();
