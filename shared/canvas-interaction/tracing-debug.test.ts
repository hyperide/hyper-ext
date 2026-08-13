import { afterEach, describe, expect, it, spyOn } from 'bun:test';
import { clearTracingDebugOnce, tracingDebugOnce } from './tracing-debug';

describe('tracingDebugOnce', () => {
  afterEach(() => {
    clearTracingDebugOnce('test-key');
    clearTracingDebugOnce('other-key');
  });

  it('logs with the [tracing] prefix once per key', () => {
    const debugSpy = spyOn(console, 'debug').mockImplementation(() => {});
    try {
      tracingDebugOnce('test-key', 'overlay miss', 'id-1');
      tracingDebugOnce('test-key', 'overlay miss', 'id-1');
      tracingDebugOnce('test-key', 'overlay miss', 'id-1');

      expect(debugSpy).toHaveBeenCalledTimes(1);
      expect(debugSpy).toHaveBeenCalledWith('[tracing]', 'overlay miss', 'id-1');
    } finally {
      debugSpy.mockRestore();
    }
  });

  it('logs separately for distinct keys', () => {
    const debugSpy = spyOn(console, 'debug').mockImplementation(() => {});
    try {
      tracingDebugOnce('test-key', 'miss A');
      tracingDebugOnce('other-key', 'miss B');
      expect(debugSpy).toHaveBeenCalledTimes(2);
    } finally {
      debugSpy.mockRestore();
    }
  });

  it('clearTracingDebugOnce re-arms the key', () => {
    const debugSpy = spyOn(console, 'debug').mockImplementation(() => {});
    try {
      tracingDebugOnce('test-key', 'miss');
      clearTracingDebugOnce('test-key');
      tracingDebugOnce('test-key', 'miss');
      expect(debugSpy).toHaveBeenCalledTimes(2);
    } finally {
      debugSpy.mockRestore();
    }
  });
});
