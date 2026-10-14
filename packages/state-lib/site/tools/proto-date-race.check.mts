/** Regression coverage for timezone date commits and race cleanup through real fields/tasks. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DateType,
  field,
  createScope,
  delay,
  CancelError,
  derive,
  watch,
  type Task,
  type TaskContext,
} from '../src/lib/proto';

for (const constructor of [false, true]) {
  test(`observed idle child registration uses linear pending reads, constructor=${constructor}`, () => {
    const parent = createScope('parent');
    let reads = 0;
    const stop = watch(() => {
      parent.pending();
    });
    const count = 2000;
    try {
      for (let i = 0; i < count; i++) {
        const child = constructor ? createScope(String(i), parent) : parent.child(String(i));
        const pending = child.pending;
        child.pending = () => {
          reads++;
          return pending();
        };
      }
      assert.equal(parent.pending(), false);
      assert.ok(reads <= count * 2, `child pending reads: ${reads}; linear budget: ${count * 2}`);
    } finally {
      stop();
      parent.end();
    }
  });

  test(`pending observers discover dynamic descendants, constructor=${constructor}`, async () => {
    const parent = createScope('parent');
    const pending = derive(() => parent.pending());
    const seen: boolean[] = [];
    const direct: boolean[] = [];
    const unsubscribe = pending.subscribe(() => seen.push(pending()));
    const stop = watch(() => {
      direct.push(parent.pending());
    });
    assert.equal(pending(), false);
    const child = constructor ? createScope('child', parent) : parent.child('child');
    const nested = constructor ? createScope('nested', child) : child.child('nested');
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const task = nested.run('work', () => gate);
    try {
      assert.equal(parent.pending(), true);
      assert.equal(pending(), true);
      assert.equal(seen.at(-1), true);
      assert.equal(direct.at(-1), true);
      release();
      await task.settled;
      assert.equal(pending(), false);
      assert.equal(seen.at(-1), false);
      assert.equal(direct.at(-1), false);
      const cancelled = child.run('cancelled', () => gate);
      assert.equal(pending(), true);
      parent.end('timeout');
      await cancelled.settled;
      assert.equal(pending(), false);
      assert.equal(seen.at(-1), false);
    } finally {
      release();
      parent.end();
      await task.settled;
      unsubscribe();
      stop();
    }
  });
}

test('pending tracks a new sibling after the first active branch settles', async () => {
  const parent = createScope('parent');
  const seen: boolean[] = [];
  const stop = watch(() => {
    seen.push(parent.pending());
  });
  let releaseFirst!: () => void;
  let releaseSecond!: () => void;
  const firstGate = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  const secondGate = new Promise<void>((resolve) => {
    releaseSecond = resolve;
  });
  const first = parent.child('first').run('first', () => firstGate);
  const second = createScope('second', parent)
    .child('nested')
    .run('second', () => secondGate);
  try {
    assert.equal(seen.at(-1), true);
    releaseFirst();
    await first.settled;
    assert.equal(parent.pending(), true);
    assert.equal(seen.at(-1), true);
    second.cancel('timeout');
    assert.equal(seen.at(-1), false);
    assert.equal((second.error() as CancelError).reason, 'timeout');
  } finally {
    stop();
    parent.end();
    releaseFirst();
    releaseSecond();
    await Promise.all([first.settled, second.settled]);
  }
});

test('scope registration remains owned when an observer ends the parent synchronously', async () => {
  const parent = createScope('parent');
  let endOnNotification = false;
  const stop = watch(() => {
    parent.pending();
    if (endOnNotification) parent.end('timeout');
  });
  endOnNotification = true;
  const child = createScope('child', parent);
  let entered = false;
  const task = child.run('late', async () => {
    entered = true;
  });
  await task.settled;
  assert.equal(entered, false);
  assert.equal(task.status(), 'cancelled');
  assert.equal(parent.pending(), false);
  stop();
});

test('timestamp civil dates reject rollover without changing a field value', () => {
  const initial = new Date('2026-09-04T00:00:00Z');
  const f = field(initial, DateType, () => ({ locale: 'en-US', timeZone: 'UTC' }));
  for (const text of [
    '2026-02-30T11:22:33Z',
    '2025-02-29T23:00:00-05:00',
    '1900-02-29T01:00:00+05:45',
    '2026-04-31 11:22:33Z',
    '2026-13-01T11:22:33Z',
    '2026-00-10T11:22:33Z',
    '2026-01-00T11:22:33Z',
  ]) {
    f.input(text);
    assert.notEqual(f.error(), null, text);
    assert.equal(f.commit(), false, text);
    assert.equal(f.text(), text);
    assert.equal(f.value().getTime(), initial.getTime());
  }
  for (const text of ['2024-02-29T23:22:33.444-05:00', '2000-02-29T00:22:33+05:45', '0096-02-29T11:22:33Z']) {
    const parsed = DateType.present!.parse(text, { locale: 'en-US', timeZone: 'Pacific/Apia' });
    assert.ok(parsed.ok, text);
    assert.equal(parsed.value.getTime(), Date.parse(text));
  }
});

for (const abortAware of [false, true]) {
  test(`parent constructor owns descendant cancellation, abort-aware=${abortAware}`, async () => {
    const parent = createScope('parent');
    const child = createScope('child', parent);
    const nested = createScope('nested', child);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const task = nested.run('work', async (ctx) => {
      if (abortAware) await delay(100, ctx.signal);
      else await gate;
    });
    const pendingBeforeEnd = parent.pending();
    parent.end('timeout');
    release();
    await task.settled;
    assert.equal(task.status(), 'cancelled');
    const error = task.error();
    assert.ok(error instanceof CancelError);
    assert.equal(error.reason, 'timeout');
    assert.equal(pendingBeforeEnd, true);
    assert.equal(child.pending(), false);
    assert.equal(parent.pending(), false);
  });
}

test('malformed date input with long whitespace does not block field updates', () => {
  const initial = new Date('2026-09-04T00:00:00Z');
  const f = field(initial, DateType, () => ({ locale: 'en-US', timeZone: 'UTC' }));
  f.input('Sep 4, 2026');
  const malformed = `Sep${' '.repeat(80_000)}x`;
  const start = performance.now();
  f.input(malformed);
  const elapsed = performance.now() - start;
  assert.ok(elapsed < 1000, `field.input took ${elapsed.toFixed(1)}ms`);
  assert.notEqual(f.error(), null);
  assert.equal(f.text(), malformed);
  assert.equal(f.value().getTime(), initial.getTime());
});

test('formatted date months accept names, optional dots and bounded numbers', () => {
  const ctx = { locale: 'en-US', timeZone: 'UTC' };
  for (const month of ['Sep', 'SEP', 'September', 'Sep.', 'September.', '9', '09']) {
    const result = DateType.present!.parse(`${month} 4, 2026`, ctx);
    assert.ok(result.ok, month);
    assert.equal(result.value.toISOString(), '2026-09-04T00:00:00.000Z');
  }
  for (const month of ['009', '0', '13', 'Septembxr', 'SepX']) {
    assert.equal(DateType.present!.parse(`${month} 4, 2026`, ctx).ok, false, month);
  }
});

for (const cancelledSlots of [1, 3]) {
  for (const cancelBeforeEnqueue of [false, true]) {
    test(`queue retains predecessors across ${cancelledSlots} cancelled slots, cancel first=${cancelBeforeEnqueue}`, async () => {
      const scope = createScope('queue');
      const order: string[] = [];
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const a = scope.run(
        'same',
        async () => {
          order.push('a:start');
          await gate;
          order.push('a:end');
        },
        { policy: 'queue' },
      );
      const cancelled = Array.from({ length: cancelledSlots }, () =>
        scope.run(
          'same',
          async () => {
            assert.fail('cancelled body ran');
          },
          { policy: 'queue' },
        ),
      );
      if (cancelBeforeEnqueue) cancelled.forEach((task) => task.cancel());
      const c = scope.run(
        'same',
        async () => {
          order.push('c');
        },
        { policy: 'queue' },
      );
      if (!cancelBeforeEnqueue) cancelled.forEach((task) => task.cancel());
      await Promise.all(cancelled.map((task) => task.settled));
      await new Promise<void>((resolve) => setImmediate(resolve));
      try {
        assert.equal(a.status(), 'loading');
        assert.equal(c.status(), 'pending');
        assert.deepEqual(order, ['a:start']);
      } finally {
        release();
        await Promise.all([a.settled, c.settled]);
        scope.end();
      }
      assert.deepEqual(order, ['a:start', 'a:end', 'c']);
      assert.equal(scope.pending(), false);
    });
  }
}

test('parent scope cleanup cancels queued slots and waits for active shield cleanup', async () => {
  const parent = createScope('parent');
  const scope = parent.child('queue');
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let cleaned = false;
  const a = scope.run(
    'same',
    async (ctx) => {
      ctx.onCancel(() => {
        cleaned = true;
      });
      await ctx.shield(() => gate);
    },
    { policy: 'queue' },
  );
  const b = scope.run(
    'same',
    async () => {
      assert.fail('B ran');
    },
    { policy: 'queue' },
  );
  b.cancel();
  const c = scope.run(
    'same',
    async () => {
      assert.fail('C ran');
    },
    { policy: 'queue' },
  );
  parent.end();
  let settled = false;
  void a.settled.then(() => {
    settled = true;
  });
  await Promise.all([b.settled, c.settled]);
  await new Promise<void>((resolve) => setImmediate(resolve));
  try {
    assert.equal(settled, false);
    assert.equal(cleaned, false);
    assert.ok([a, b, c].every((task) => task.status() === 'cancelled'));
  } finally {
    release();
    await a.settled;
  }
  assert.equal(cleaned, true);
  assert.equal(parent.pending(), false);
  const late = scope.run(
    'same',
    async () => {
      assert.fail('ended scope ran');
    },
    { policy: 'queue' },
  );
  await late.settled;
  assert.equal(late.status(), 'cancelled');
});

for (const locale of ['ru-RU', 'pt-BR', 'zh-CN', 'en-US', 'de-DE']) {
  test(`${locale}: formatter literals survive edited months and years with strict date validation`, () => {
    const ctx = { locale, timeZone: 'America/Los_Angeles' };
    const formatter = new Intl.DateTimeFormat(locale, {
      calendar: 'gregory',
      dateStyle: 'medium',
      timeZone: ctx.timeZone,
    });
    const f = field(new Date('2026-09-04T07:00:00Z'), DateType, () => ctx);
    assert.equal(f.commit(), true, f.text());
    for (let month = 0; month < 12; month++) {
      const date = new Date(Date.UTC(2027, month, 15, 12));
      f.input(formatter.format(date));
      assert.equal(f.commit(), true, f.text());
      const expected = DateType.present!.parse(`2027-${String(month + 1).padStart(2, '0')}-15`, ctx);
      assert.ok(expected.ok);
      assert.equal(f.value().getTime(), expected.value.getTime());
    }
    const february = new Date('2026-02-15T12:00:00Z');
    const invalidDay = formatter
      .formatToParts(february)
      .map((part) => (part.type === 'day' ? '31' : part.value))
      .join('');
    for (const invalid of [invalidDay, `${formatter.format(february)} extra`, `${formatter.format(february)} 5`]) {
      f.input(invalid);
      assert.equal(f.commit(), false, invalid);
    }
    for (const partType of ['month', 'year', 'literal']) {
      const invalid = formatter
        .formatToParts(february)
        .map((part) => (part.type === partType ? `${part.value}junk` : part.value))
        .join('');
      assert.equal(DateType.present!.parse(invalid, ctx).ok, false, invalid);
    }
    for (const [timeZone, date] of [
      ['Pacific/Apia', '2011-12-30T12:00:00Z'],
      ['America/Sao_Paulo', '2018-11-04T12:00:00Z'],
    ] as const) {
      const text = formatter.format(new Date(date));
      assert.equal(DateType.present!.parse(text, { locale, timeZone }).ok, false, text);
    }
  });
}

for (const fails of [false, true]) {
  for (const shielded of [false, true]) {
    test(
      `throwing finalizers preserve ${fails ? 'failure' : 'success'} race outcome, shield=${shielded}`,
      { timeout: 1000 },
      async (t) => {
        const diagnostics: unknown[][] = [];
        t.mock.method(console, 'error', (...args: unknown[]) => diagnostics.push(args));
        const primary = new Error('primary');
        const first = new Error('first cleanup');
        const second = new Error('second cleanup');
        const winnerCleanup = new Error('winner cleanup');
        const order: number[] = [];
        let release!: () => void;
        const gate = new Promise<void>((resolve) => {
          release = resolve;
        });
        let loser!: Task<void>;
        const parent = createScope('throwing-cleanup').run('parent', async (ctx) => {
          const winner = ctx.spawn('winner', async (child) => {
            child.onCancel(() => {
              throw winnerCleanup;
            });
            if (fails) throw primary;
            return 42;
          });
          loser = ctx.spawn('loser', async (child) => {
            child.onCancel(() => {
              order.push(1);
            });
            child.onCancel(() => {
              order.push(2);
              throw first;
            });
            child.onCancel(() => {
              order.push(3);
              throw second;
            });
            if (shielded) await child.shield(() => gate);
            await delay(100, child.signal);
          });
          return ctx.race<unknown>([winner, loser]);
        });
        let settled = false;
        void parent.settled.then(() => {
          settled = true;
        });
        await new Promise<void>((resolve) => setImmediate(resolve));
        if (shielded) {
          assert.equal(settled, false);
          assert.deepEqual(order, []);
        }
        release();
        await parent.settled;
        await loser.settled;
        assert.deepEqual(order, [3, 2, 1]);
        assert.equal(parent.status(), fails ? 'error' : 'success');
        if (fails) assert.equal(parent.error(), primary);
        else assert.equal(parent.result(), 42);
        assert.ok(loser.error() instanceof CancelError);
        assert.equal(diagnostics.length, 2);
        const winnerDiagnostic = diagnostics[0]![0];
        assert.ok(winnerDiagnostic instanceof AggregateError);
        assert.deepEqual(winnerDiagnostic.errors, [winnerCleanup]);
        assert.equal(winnerDiagnostic.cause, fails ? primary : null);
        const diagnostic = diagnostics[1]![0];
        assert.ok(diagnostic instanceof AggregateError);
        assert.deepEqual(diagnostic.errors, [second, first]);
        assert.equal(diagnostic.cause, loser.error());
        // node:test treats any unhandled rejection as a test failure.
        await new Promise<void>((resolve) => setImmediate(resolve));
      },
    );
  }
}

test('pending cancellation reaches children spawned inside nested shields before their bodies start', async () => {
  let context!: TaskContext;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let ran = false;
  let late!: Task<void>;
  const scope = createScope('late-child');
  const parent = scope.run('parent', async (ctx) => {
    context = ctx;
    await ctx.shield(() =>
      ctx.shield(async () => {
        await gate;
        late = ctx.spawn('late', async (child) => {
          ran = true;
          await child.spawn('grandchild', async () => {
            ran = true;
          }).settled;
        });
        await late.settled;
      }),
    );
  });
  parent.cancel();
  release();
  await parent.settled;
  assert.equal(ran, false);
  assert.equal(late.status(), 'cancelled');
  assert.equal((late.error() as CancelError).reason, 'scope-ended');
  assert.deepEqual(parent.children(), [late]);
  assert.ok(scope.tasks().includes(late));
  assert.equal(scope.pending(), false);
  const after = context.spawn('after', async () => {
    ran = true;
  });
  await after.settled;
  assert.equal(after.status(), 'cancelled');
  assert.equal(ran, false);
});

test('closed and ancestor-closed scopes settle new tasks without entering their bodies', async () => {
  const scope = createScope('closed');
  scope.end();
  let ran = false;
  const direct = scope.run('direct', async () => {
    ran = true;
  });
  const childScope = scope.child('created-after-close');
  const child = childScope.run('child', async () => {
    ran = true;
  });
  const nested = childScope.child('nested').run('nested', async () => {
    ran = true;
  });
  await Promise.all([direct.settled, child.settled, nested.settled]);
  assert.equal(ran, false);
  for (const task of [direct, child, nested]) {
    assert.equal(task.status(), 'cancelled');
    assert.equal((task.error() as CancelError).reason, 'scope-ended');
  }
  assert.equal(scope.pending(), false);
});

test('a cancelled nested child cannot spawn work from its shield', async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let grandchild!: Task<void>;
  let child!: Task<void>;
  let ran = false;
  const parent = createScope('nested-cancel').run('parent', async (ctx) => {
    child = ctx.spawn('child', async (c) => {
      await c.shield(async () => {
        await gate;
        grandchild = c.spawn('grandchild', async () => {
          ran = true;
        });
        await grandchild.settled;
      });
    });
    await child.settled;
  });
  parent.cancel('timeout');
  release();
  await parent.settled;
  assert.equal(ran, false);
  assert.deepEqual(child.children(), [grandchild]);
  assert.equal(grandchild.status(), 'cancelled');
  assert.equal((grandchild.error() as CancelError).reason, 'timeout');
});

test('timestamp input retains its full instant rather than being parsed as a date prefix', () => {
  for (const text of ['2026-09-04T11:22:33.444Z', '2026-09-04T11:22:33.444+05:45']) {
    const parsed = DateType.present!.parse(text, { locale: 'ar-EG', timeZone: 'UTC' });
    assert.ok(parsed.ok, text);
    assert.equal(parsed.value.getTime(), new Date(text).getTime());
  }
});

for (const locale of ['ar-EG', 'th-TH', 'th-TH-u-nu-thai', 'ar-EG-u-ca-islamic']) {
  test(`${locale}: all months and localized invalid or skipped dates`, () => {
    for (let month = 0; month < 12; month++) {
      const date = new Date(Date.UTC(2026, month, 15));
      const ctx = { locale, timeZone: 'UTC' };
      const f = field(date, DateType, () => ctx);
      assert.equal(f.commit(), true, f.text());
      assert.equal(f.value().getTime(), date.getTime());
    }
    const digits = new Intl.NumberFormat(locale, { useGrouping: false });
    for (const [timeZone, day, month, year] of [
      ['Pacific/Apia', 30, 12, 2011],
      ['America/Sao_Paulo', 4, 11, 2018],
      ['UTC', 29, 2, 2026],
    ] as const) {
      const text = [day, month, year].map((n) => digits.format(n)).join('\u00a0/');
      assert.equal(DateType.present!.parse(text, { locale, timeZone }).ok, false, text);
    }
    for (const [timeZone, midnight] of [
      ['Asia/Kathmandu', '2026-09-03T18:15:00Z'],
      ['Pacific/Kiritimati', '2026-09-03T10:00:00Z'],
      ['Europe/Berlin', '2026-10-24T22:00:00Z'],
      ['America/Los_Angeles', '2026-11-02T08:00:00Z'],
    ]) {
      const date = new Date(midnight);
      const f = field(date, DateType, () => ({ locale, timeZone }));
      assert.equal(f.commit(), true, f.text());
      assert.equal(f.value().getTime(), date.getTime());
    }
  });
  test(`${locale}: localized Gregorian fields commit unchanged and edited`, () => {
    const ctx = { locale, timeZone: 'America/Los_Angeles' };
    const initial = new Date('2026-03-08T08:00:00Z');
    const f = field(initial, DateType, () => ctx);
    const shown = f.text();
    assert.equal(f.commit(), true, shown);
    assert.equal(f.value().getTime(), initial.getTime());
    assert.equal(f.text(), shown);
    const edited = new Date('2026-03-09T07:00:00Z');
    const formatted = new Intl.DateTimeFormat(locale, {
      calendar: 'gregory',
      dateStyle: 'medium',
      timeZone: ctx.timeZone,
    }).format(edited);
    f.input(formatted);
    assert.equal(f.commit(), true, formatted);
    assert.equal(f.value().getTime(), edited.getTime());
    const digits = new Intl.NumberFormat(locale, { useGrouping: false });
    const numeric = [10, 3, 2026].map((n) => digits.format(n)).join('\u202f/\u200f');
    f.input(`\u2067${numeric}\u2069`);
    assert.equal(f.commit(), true, numeric);
    assert.equal(f.value().toISOString(), '2026-03-10T07:00:00.000Z');
    for (const invalid of ['٣١/٠٢/٢٠٢٦', `${formatted} extra`, `${formatted} 5`]) {
      f.input(invalid);
      assert.equal(f.commit(), false, invalid);
    }
  });
}

for (const [timeZone, day, midnight] of [
  ['UTC', '2026-09-04', '2026-09-04T00:00:00Z'],
  ['America/Los_Angeles', '2026-09-04', '2026-09-04T07:00:00Z'],
  ['Asia/Kathmandu', '2026-09-04', '2026-09-03T18:15:00Z'],
  ['Pacific/Kiritimati', '2026-09-04', '2026-09-03T10:00:00Z'],
  ['America/Los_Angeles', '2026-03-08', '2026-03-08T08:00:00Z'],
  ['America/Los_Angeles', '2026-03-09', '2026-03-09T07:00:00Z'],
  ['America/Los_Angeles', '2026-11-01', '2026-11-01T07:00:00Z'],
  ['America/Los_Angeles', '2026-11-02', '2026-11-02T08:00:00Z'],
  ['Europe/Berlin', '2026-03-29', '2026-03-28T23:00:00Z'],
  ['Europe/Berlin', '2026-10-25', '2026-10-24T22:00:00Z'],
] as const) {
  test(`date commits retain ${day} in ${timeZone}, dropping time of day`, () => {
    const expected = new Date(midnight).getTime();
    const ctx = () => ({ locale: 'en-US', timeZone });
    const f = field(new Date(expected + 12 * 3600000 + 1234), DateType, ctx);
    const shown = f.text();
    for (let i = 0; i < 3; i++) {
      assert.equal(f.commit(), true);
      assert.equal(f.text(), shown);
      assert.equal(f.value().getTime(), expected);
    }
    f.input('2024-02-29');
    assert.equal(f.error(), null);
    assert.equal(f.commit(), true);
    assert.equal(f.text(), 'Feb 29, 2024');
    f.input(day);
    assert.equal(f.error(), null);
    assert.equal(f.value().getTime(), expected);
    assert.equal(f.commit(), true);
    assert.equal(f.text(), shown);
    for (const invalid of ['2026-02-30', 'Feb 31, 2026', '2026-13-01', '2026-09-0', '', 'nonsense']) {
      f.input(invalid);
      assert.equal(f.commit(), false, invalid);
      assert.equal(f.text(), invalid);
      assert.equal(f.value().getTime(), expected);
      assert.notEqual(f.error(), null);
    }
  });
}

for (const fails of [false, true]) {
  for (const shielded of [false, true]) {
    test(`race ${fails ? 'failure' : 'success'} waits for ${shielded ? 'shielded' : 'ordinary'} loser cleanup`, async () => {
      const scope = createScope('race-regression');
      const failure = new Error('winner failed');
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      let cleaned = false;
      let completedWork = false;
      let winner!: Task<string>;
      let loser!: Task<string>;
      const parent = scope.run('parent', async (ctx) => {
        winner = ctx.spawn('winner', async () => {
          if (fails) throw failure;
          return 'winner';
        });
        loser = ctx.spawn('loser', async (child) => {
          child.onCancel(() => {
            cleaned = true;
          });
          if (shielded) await child.shield(() => gate);
          await delay(30, child.signal);
          completedWork = true;
          return 'loser';
        });
        return ctx.race([winner, loser]);
      });
      let parentSettled = false;
      void parent.settled.then(() => {
        parentSettled = true;
      });
      await new Promise<void>((resolve) => setImmediate(resolve));
      try {
        assert.equal(loser.status(), 'cancelled');
        if (shielded) {
          assert.equal(parentSettled, false);
          assert.equal(cleaned, false);
        }
      } finally {
        release();
        await parent.settled;
        await loser.settled;
      }
      assert.equal(cleaned, true);
      assert.equal(completedWork, false);
      assert.equal(loser.status(), 'cancelled');
      assert.ok(loser.error() instanceof CancelError);
      assert.equal(winner.status(), fails ? 'error' : 'success');
      assert.equal(parent.status(), fails ? 'error' : 'success');
      if (fails) assert.equal(parent.error(), failure);
      else assert.equal(parent.result(), 'winner');
    });
  }
}

test('dates without a local midnight are rejected without moving to another day', () => {
  for (const [timeZone, text] of [
    ['Pacific/Apia', '2011-12-30'],
    ['America/Sao_Paulo', '2018-11-04'],
  ]) {
    assert.equal(DateType.present!.parse(text, { locale: 'en-US', timeZone }).ok, false);
  }
});

test('omitted timezone uses the formatter default for midnight', () => {
  const ctx = { locale: 'en-US' };
  const parsed = DateType.present!.parse('2026-09-04', ctx);
  assert.ok(parsed.ok);
  assert.equal(parsed.value.getFullYear(), 2026);
  assert.equal(parsed.value.getMonth(), 8);
  assert.equal(parsed.value.getDate(), 4);
  assert.equal(parsed.value.getHours(), 0);
  assert.equal(DateType.present!.format(parsed.value, ctx), 'Sep 4, 2026');
});

test('parent cancellation waits for a race child shield and finaliser', async () => {
  const scope = createScope('cancelled-race');
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let cleaned = false;
  const parent = scope.run('parent', async (ctx) => {
    const child = ctx.spawn('shielded', async (c) => {
      c.onCancel(() => {
        cleaned = true;
      });
      await c.shield(() => gate);
    });
    const other = ctx.spawn('other', (c) => delay(100, c.signal));
    await ctx.race([child, other]);
  });
  let settled = false;
  void parent.settled.then(() => {
    settled = true;
  });
  parent.cancel('user');
  await new Promise<void>((resolve) => setImmediate(resolve));
  try {
    assert.equal(parent.status(), 'cancelled');
    assert.equal(settled, false);
    assert.equal(cleaned, false);
  } finally {
    release();
    await parent.settled;
  }
  assert.equal(cleaned, true);
  assert.ok(parent.children().every((child) => child.status() === 'cancelled'));
});
