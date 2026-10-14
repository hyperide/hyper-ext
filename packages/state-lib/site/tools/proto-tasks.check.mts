/**
 * Tasks, scopes and cancellation (§4.15, R71–R74) against the prototype.
 *
 * Every claim the site makes about cancellation is checked here. The ones that
 * matter most are the ones that are easy to get subtly wrong: that cancelling a
 * scope actually stops the work rather than discarding its result, that
 * finalisers run last-in-first-out, that an abort is not an error, and that
 * `shield` really does hold a cancel off until its region returns.
 */
import { createScope, CancelError, delay, watch, type Task } from '../src/lib/proto';

let failures = 0;
const t0 = Date.now();
function check(name: string, cond: boolean, detail = '') {
  if (cond) console.log(`  ok   ${name}`);
  else {
    failures++;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}
const settleAll = (...ts: Task<unknown>[]) => Promise.all(ts.map((t) => t.settled));

console.log('\nlifecycle');
{
  const scope = createScope('test');
  const seen: string[] = [];
  const task = scope.run('ok', async (ctx) => {
    ctx.progress(0.5);
    await delay(5, ctx.signal);
    return 42;
  });
  watch(() => seen.push(task.status()));
  check('starts loading', task.status() === 'loading', task.status());
  await task.settled;
  check('reaches success', task.status() === 'success', task.status());
  check('carries the value', task.result() === 42, String(task.result()));
  check('progress is readable', task.progress() === 0.5, String(task.progress()));
  check('status is reactive', seen.includes('success'), seen.join('→'));
}

console.log('\nan abort is not an error');
{
  const scope = createScope('test');
  const task = scope.run('slow', async (ctx) => {
    await delay(500, ctx.signal);
    return 1;
  });
  task.cancel('user');
  await task.settled;
  check('status is cancelled, not error', task.status() === 'cancelled', task.status());
  check('the error slot holds a CancelError', task.error() instanceof CancelError);
  check('settled resolves rather than rejecting', true);
}

console.log('\ncancelling stops real work');
{
  const scope = createScope('test');
  let ranPast = false;
  const task = scope.run('slow', async (ctx) => {
    await delay(50, ctx.signal);
    ranPast = true;
  });
  task.cancel('user');
  await delay(80);
  check('the body never resumed past its await', !ranPast);
}

console.log('\nscope end cascades to children');
{
  const route = createScope('route');
  const widget = route.child('widget');
  const a = route.run('a', async (ctx) => {
    await delay(500, ctx.signal);
  });
  const b = widget.run('b', async (ctx) => {
    await delay(500, ctx.signal);
  });
  check('scope reports pending', route.pending());
  route.end();
  await settleAll(a, b);
  check('the direct task cancelled', a.status() === 'cancelled', a.status());
  check('the nested-scope task cancelled too', b.status() === 'cancelled', b.status());
  check('the reason is scope-ended', (a.error() as CancelError).reason === 'scope-ended');
  check('scope no longer pending', !route.pending());
}

console.log('\na spawned child dies with its parent');
{
  const scope = createScope('test');
  let child!: Task<void>;
  const parent = scope.run('parent', async (ctx) => {
    child = ctx.spawn('child', async (c) => {
      await delay(500, c.signal);
    });
    await delay(500, ctx.signal);
  });
  await delay(5);
  parent.cancel('user');
  await settleAll(parent, child);
  check('parent cancelled', parent.status() === 'cancelled');
  check('child cancelled with it', child.status() === 'cancelled', child.status());
  check('parent lists the child', parent.children().length === 1);
}

console.log('\nsiblings fail independently by default (supervisor, not fail-fast)');
{
  const scope = createScope('test');
  const bad = scope.run('bad', async () => {
    throw new Error('boom');
  });
  const good = scope.run('good', async (ctx) => {
    await delay(20, ctx.signal);
    return 'fine';
  });
  await settleAll(bad, good);
  check('one task errored', bad.status() === 'error', bad.status());
  check('its sibling completed anyway', good.status() === 'success', good.status());
}

console.log('\nfinalisers run last-in-first-out');
{
  const scope = createScope('test');
  const order: number[] = [];
  const task = scope.run('t', async (ctx) => {
    ctx.onCancel(() => order.push(1));
    ctx.onCancel(() => order.push(2));
    ctx.onCancel(() => order.push(3));
    await delay(500, ctx.signal);
  });
  await delay(5);
  task.cancel('user');
  await task.settled;
  check('reverse registration order', order.join(',') === '3,2,1', order.join(','));
}

console.log('\nshield holds the cancel off until its region returns');
{
  const scope = createScope('test');
  let finished = false;
  const task = scope.run('t', async (ctx) => {
    await ctx.shield(async () => {
      await delay(40);
      finished = true;
    });
    await delay(500, ctx.signal);
  });
  await delay(5);
  task.cancel('user');
  await task.settled;
  check('the shielded region completed', finished);
  check('the task still ends cancelled', task.status() === 'cancelled', task.status());
}

console.log('\nshield preserves entry timing and cancellation precedence over body failure');
{
  const scope = createScope('shield-failure');
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const order: string[] = [];
  const task = scope.run('shielded-error', async (ctx) => {
    const shielded = ctx.shield(async () => {
      order.push('body');
      await held;
      throw new Error('body failed');
    });
    order.push('caller');
    await shielded;
  });
  check('shield enters the body before returning to its caller', order.join(',') === 'body,caller', order.join(','));
  task.cancel('user');
  release();
  await task.settled;
  check('cancel takes precedence over a shielded body failure', task.error() instanceof CancelError);
  check('a failing shield still settles as cancelled', task.status() === 'cancelled', task.status());
}

console.log('\npolicy: latest supersedes, leading drops, every runs, queue serialises');
{
  const scope = createScope('test');
  const a = scope.run(
    'search',
    async (ctx) => {
      await delay(200, ctx.signal);
      return 'a';
    },
    { policy: 'latest' },
  );
  await delay(5);
  const b = scope.run(
    'search',
    async (ctx) => {
      await delay(20, ctx.signal);
      return 'b';
    },
    { policy: 'latest' },
  );
  await settleAll(a, b);
  check(
    'latest: the earlier run was superseded',
    a.status() === 'cancelled' && (a.error() as CancelError).reason === 'superseded',
    a.status(),
  );
  check('latest: the later run won', b.status() === 'success' && b.result() === 'b');

  const c = scope.run(
    'lead',
    async (ctx) => {
      await delay(50, ctx.signal);
      return 'c';
    },
    { policy: 'leading' },
  );
  await delay(5);
  const d = scope.run(
    'lead',
    async (ctx) => {
      await delay(5, ctx.signal);
      return 'd';
    },
    { policy: 'leading' },
  );
  await settleAll(c, d);
  check('leading: the first run wins', c.status() === 'success', c.status());
  check('leading: the second call was dropped', d.status() === 'cancelled', d.status());

  const order: string[] = [];
  const e = scope.run(
    'q',
    async (ctx) => {
      await delay(40, ctx.signal);
      order.push('e');
    },
    { policy: 'queue' },
  );
  await delay(5);
  const f = scope.run(
    'q',
    async (ctx) => {
      await delay(5, ctx.signal);
      order.push('f');
    },
    { policy: 'queue' },
  );
  await settleAll(e, f);
  check('queue: runs in call order, not completion order', order.join(',') === 'e,f', order.join(','));
}

console.log('\ntimeout is a cancel scope over the body');
{
  const scope = createScope('test');
  const task = scope.run(
    'slow',
    async (ctx) => {
      await delay(500, ctx.signal);
    },
    { timeout: 20 },
  );
  await task.settled;
  check('cancelled by timeout', task.status() === 'cancelled', task.status());
  check(
    'the reason says so',
    (task.error() as CancelError).reason === 'timeout',
    String((task.error() as CancelError).reason),
  );
}

console.log('\nall() is fail-fast, race() cancels the losers');
{
  const scope = createScope('test');
  let groupErr: unknown;
  const outer = scope.run('group', async (ctx) => {
    const one = ctx.spawn('one', async (c) => {
      await delay(200, c.signal);
      return 1;
    });
    const two = ctx.spawn('two', async () => {
      await delay(10);
      throw new Error('nope');
    });
    try {
      await ctx.all([one, two]);
    } catch (e) {
      groupErr = e;
    }
    check('all(): the slow sibling was cancelled', one.status() === 'cancelled', one.status());
  });
  await outer.settled;
  check('all(): the failure propagated to the caller', groupErr instanceof Error);

  const racer = scope.run('race', async (ctx) => {
    const fast = ctx.spawn('fast', async (c) => {
      await delay(10, c.signal);
      return 'fast';
    });
    const slow = ctx.spawn('slow', async (c) => {
      await delay(300, c.signal);
      return 'slow';
    });
    const won = await ctx.race([fast, slow]);
    check('race(): the first to settle wins', won === 'fast', String(won));
    check('race(): the loser was cancelled', slow.status() === 'cancelled', slow.status());
  });
  await racer.settled;
}

console.log('\nobserved scope shutdown scans descendants once');
{
  const parent = createScope('observed-shutdown');
  let reads = 0;
  let runs = 0;
  const stop = watch(() => {
    runs++;
    parent.pending();
  });
  const count = 2000;
  for (let i = 0; i < count; i++) {
    const child = parent.child(`child-${i}`);
    const pending = child.pending;
    child.pending = () => {
      reads++;
      return pending();
    };
  }
  reads = 0;
  runs = 0;
  parent.end();
  check('shutdown reads each idle child once', reads === count, String(reads));
  check('shutdown publishes once', runs === 1, String(runs));
  parent.end();
  check('repeated shutdown is inert', runs === 1, String(runs));
  stop();
}

console.log('\nobserved shutdown preserves shield completion and finalisers');
{
  const parent = createScope('shielded-shutdown');
  const child = parent.child('child');
  const seen: boolean[] = [];
  const stop = watch(() => {
    seen.push(parent.pending());
  });
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const order: string[] = [];
  const task = child.run('shielded', async (ctx) => {
    ctx.onCancel(() => {
      order.push('first');
    });
    ctx.onCancel(() => {
      order.push('second');
    });
    await ctx.shield(async () => {
      await held;
      order.push('shield');
    });
  });
  let settled = false;
  void task.settled.then(() => {
    settled = true;
  });
  parent.end();
  await Promise.resolve();
  check('cancellation is visible while shield delays settlement', task.status() === 'cancelled' && !settled);
  check('shield postpones finalisers', order.length === 0);
  release();
  await task.settled;
  check('shield completes before LIFO finalisers', order.join(',') === 'shield,second,first', order.join(','));
  check(
    'scope cancellation reason survives shielding',
    task.error() instanceof CancelError && (task.error() as CancelError).reason === 'scope-ended',
  );
  check('observer sees cancellation reach parent scope', seen[seen.length - 1] === false && seen.includes(true));
  stop();
}

console.log(
  failures ? `\n${failures} check(s) failed (${Date.now() - t0} ms)` : `\nall checks passed (${Date.now() - t0} ms)`,
);
process.exit(failures ? 1 : 0);
