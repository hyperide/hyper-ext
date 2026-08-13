import { afterEach, describe, expect, it, mock } from 'bun:test';
import { getActiveTracer, setActiveTracer, subscribeToTracer } from './active-tracer';
import type { ElementTracer } from './element-tracer';

const mockTracer = {} as ElementTracer;

afterEach(() => {
  setActiveTracer(null);
});

describe('subscribeToTracer', () => {
  it('calls subscriber when tracer is set', () => {
    const cb = mock(() => {});
    const unsub = subscribeToTracer(cb);
    setActiveTracer(mockTracer);
    expect(cb).toHaveBeenCalledTimes(1);
    unsub();
  });

  it('calls subscriber when tracer is cleared', () => {
    const cb = mock(() => {});
    setActiveTracer(mockTracer);
    const unsub = subscribeToTracer(cb);
    setActiveTracer(null);
    expect(cb).toHaveBeenCalledTimes(1);
    unsub();
  });

  it('does not call subscriber after unsubscribe', () => {
    const cb = mock(() => {});
    const unsub = subscribeToTracer(cb);
    unsub();
    setActiveTracer(mockTracer);
    expect(cb).toHaveBeenCalledTimes(0);
  });

  it('getActiveTracer returns current tracer after set', () => {
    setActiveTracer(mockTracer);
    expect(getActiveTracer()).toBe(mockTracer);
  });
});
