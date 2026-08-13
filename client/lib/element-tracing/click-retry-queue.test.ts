/**
 * @file ClickRetryQueue — retry-on-resolve for clicks racing source-map warmup (HYP-635)
 *
 * Accessed via: useElementTracer wires the queue between ModuleSourceMapResolver.onResolved
 *   and ElementTracer.resolveClickLocal; useIframeEventHandlers enqueues missed clicks.
 * Assumptions: the FIRST click during async source-map warmup resolves fibers to raw
 *   transformed coords, misses the node map, and self-heals only on the NEXT click (the
 *   deferred codex P2 from #395). The queue must re-run resolution when the involved
 *   module's map lands — WITHOUT gating tracer readiness on warmup (a hung map fetch
 *   must never block selection entirely).
 */

import { describe, expect, it, mock } from 'bun:test';
import type { LocalResolveResult } from '../../../shared/canvas-interaction/types';
import { ClickRetryQueue } from './click-retry-queue';

function makeResult(nodeRef: string): LocalResolveResult {
  const loc = { fileName: 'src/components/Hero.tsx', line: 4, column: 6 };
  return {
    nodeRef,
    entry: {
      nodeRef,
      tag: 'h1',
      loc,
      endLoc: { ...loc, line: 6 },
      parentRef: null,
      children: [],
      isComponent: false,
      fingerprint: 'fp-h1',
    },
    source: loc,
    itemIndex: 0,
  };
}

interface Harness {
  queue: ClickRetryQueue;
  /** Flip per-element warming state. */
  setWarming: (element: HTMLElement, warming: boolean) => void;
  /** Set per-element resolution outcome. */
  setResult: (element: HTMLElement, result: LocalResolveResult | null) => void;
  resolve: ReturnType<typeof mock>;
}

function makeHarness(timeoutMs?: number): Harness {
  const warming = new Map<HTMLElement, boolean>();
  const results = new Map<HTMLElement, LocalResolveResult | null>();
  const resolve = mock((element: HTMLElement) => results.get(element) ?? null);
  const queue = new ClickRetryQueue({
    resolve: resolve as unknown as (element: HTMLElement) => LocalResolveResult | null,
    isWarming: (element) => warming.get(element) ?? false,
    timeoutMs,
  });
  return {
    queue,
    setWarming: (element, w) => warming.set(element, w),
    setResult: (element, r) => results.set(element, r),
    resolve,
  };
}

describe('ClickRetryQueue', () => {
  it('click before warm → queued, no selection delivered yet', () => {
    const h = makeHarness();
    const el = document.createElement('div');
    h.setWarming(el, true);
    const deliver = mock(() => {});

    expect(h.queue.enqueue(el, deliver)).toBe(true);
    expect(deliver).not.toHaveBeenCalled();
  });

  it('onResolved fires for the module → resolution re-runs and selection lands', () => {
    const h = makeHarness();
    const el = document.createElement('div');
    h.setWarming(el, true);
    const deliver = mock(() => {});
    h.queue.enqueue(el, deliver);

    // Map landed: module no longer warming, resolution now hits the node map.
    h.setWarming(el, false);
    h.setResult(el, makeResult('node-1'));
    h.queue.notifyResolved();

    expect(deliver).toHaveBeenCalledTimes(1);
    expect((deliver.mock.calls[0] as unknown[])[0]).toMatchObject({ nodeRef: 'node-1' });
  });

  it('second click before warm replaces the first queued one', () => {
    const h = makeHarness();
    const first = document.createElement('div');
    const second = document.createElement('span');
    h.setWarming(first, true);
    h.setWarming(second, true);
    const deliverFirst = mock(() => {});
    const deliverSecond = mock(() => {});

    h.queue.enqueue(first, deliverFirst);
    h.queue.enqueue(second, deliverSecond);

    h.setWarming(first, false);
    h.setWarming(second, false);
    h.setResult(first, makeResult('node-first'));
    h.setResult(second, makeResult('node-second'));
    h.queue.notifyResolved();

    expect(deliverFirst).not.toHaveBeenCalled();
    expect(deliverSecond).toHaveBeenCalledTimes(1);
    expect((deliverSecond.mock.calls[0] as unknown[])[0]).toMatchObject({ nodeRef: 'node-second' });
  });

  it('onResolved for an UNRELATED module (element still warming) keeps waiting', () => {
    const h = makeHarness();
    const el = document.createElement('div');
    h.setWarming(el, true);
    const deliver = mock(() => {});
    h.queue.enqueue(el, deliver);

    // Some other module's map landed — ours is still in flight. No premature
    // resolution attempt (it would spam server resolve-element fallbacks).
    h.queue.notifyResolved();
    expect(h.resolve).not.toHaveBeenCalled();
    expect(deliver).not.toHaveBeenCalled();

    // Now ours lands.
    h.setWarming(el, false);
    h.setResult(el, makeResult('node-1'));
    h.queue.notifyResolved();
    expect(deliver).toHaveBeenCalledTimes(1);
  });

  it('module warmed but resolution still misses → queue drops without delivering', () => {
    const h = makeHarness();
    const el = document.createElement('div');
    h.setWarming(el, true);
    const deliver = mock(() => {});
    h.queue.enqueue(el, deliver);

    h.setWarming(el, false);
    h.setResult(el, null);
    h.queue.notifyResolved();
    expect(deliver).not.toHaveBeenCalled();

    // A later (unrelated) resolution must not resurrect the dropped click.
    h.setResult(el, makeResult('node-late'));
    h.queue.notifyResolved();
    expect(deliver).not.toHaveBeenCalled();
  });

  it('does not queue when the element module is not warming (miss has another cause)', () => {
    const h = makeHarness();
    const el = document.createElement('div');
    h.setWarming(el, false);
    const deliver = mock(() => {});

    expect(h.queue.enqueue(el, deliver)).toBe(false);

    h.setResult(el, makeResult('node-1'));
    h.queue.notifyResolved();
    expect(deliver).not.toHaveBeenCalled();
  });

  it('cancel drops the queued click', () => {
    const h = makeHarness();
    const el = document.createElement('div');
    h.setWarming(el, true);
    const deliver = mock(() => {});
    h.queue.enqueue(el, deliver);

    h.queue.cancel();

    h.setWarming(el, false);
    h.setResult(el, makeResult('node-1'));
    h.queue.notifyResolved();
    expect(deliver).not.toHaveBeenCalled();
  });

  it('queued click expires after timeoutMs', async () => {
    const h = makeHarness(20);
    const el = document.createElement('div');
    h.setWarming(el, true);
    const deliver = mock(() => {});
    h.queue.enqueue(el, deliver);

    await new Promise((r) => setTimeout(r, 40));

    h.setWarming(el, false);
    h.setResult(el, makeResult('node-1'));
    h.queue.notifyResolved();
    expect(deliver).not.toHaveBeenCalled();
  });

  it('delivery clears the entry — a second onResolved does not double-deliver', () => {
    const h = makeHarness();
    const el = document.createElement('div');
    h.setWarming(el, true);
    const deliver = mock(() => {});
    h.queue.enqueue(el, deliver);

    h.setWarming(el, false);
    h.setResult(el, makeResult('node-1'));
    h.queue.notifyResolved();
    h.queue.notifyResolved();
    expect(deliver).toHaveBeenCalledTimes(1);
  });
});
