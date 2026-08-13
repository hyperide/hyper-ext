import { afterEach, describe, expect, test } from 'bun:test';
import { act, cleanup, render } from '@testing-library/react';
import { createElement, useCallback, useState } from 'react';
import { useAutoScroll } from './useAutoScroll';

afterEach(cleanup);

// happy-dom doesn't simulate real layout; we stub scrollHeight/clientHeight on
// the viewport so the hook's `scrollTop = scrollHeight` line is observable.
function makeViewport(scrollHeight = 1000, clientHeight = 200) {
  const viewport = document.createElement('div');
  viewport.setAttribute('data-radix-scroll-area-viewport', '');
  Object.defineProperty(viewport, 'scrollHeight', { value: scrollHeight, configurable: true });
  Object.defineProperty(viewport, 'clientHeight', { value: clientHeight, configurable: true });
  viewport.scrollTop = 0;
  return viewport;
}

interface Controls {
  setTriggers: (next: [unknown, unknown, unknown]) => void;
  forceRerender: () => void;
  getApi: () => ReturnType<typeof useAutoScroll>;
  getRenderCount: () => number;
}

function setup(initial: [unknown, unknown, unknown]) {
  const viewport = makeViewport();
  let api: ReturnType<typeof useAutoScroll> | null = null;
  let renders = 0;
  let setTriggersExternal: ((next: [unknown, unknown, unknown]) => void) | null = null;
  let forceRerenderExternal: (() => void) | null = null;

  function Harness() {
    const [triggers, setTriggers] = useState<[unknown, unknown, unknown]>(initial);
    const [, setForce] = useState(0);
    setTriggersExternal = setTriggers;
    forceRerenderExternal = () => setForce((n) => n + 1);

    const result = useAutoScroll(triggers[0], triggers[1], triggers[2]);
    api = result;
    renders += 1;

    // Ref callback runs during commit, BEFORE useEffect — so the viewport is
    // attached by the time the hook's auto-scroll effect fires.
    const attach = useCallback(
      (host: HTMLDivElement | null) => {
        (result.scrollAreaRef as { current: HTMLDivElement | null }).current = host;
        if (host && !host.contains(viewport)) {
          host.appendChild(viewport);
        }
      },
      [result.scrollAreaRef],
    );

    return createElement('div', { ref: attach });
  }

  const utils = render(createElement(Harness));

  const controls: Controls = {
    setTriggers: (next) => {
      act(() => setTriggersExternal?.(next));
    },
    forceRerender: () => {
      act(() => forceRerenderExternal?.());
    },
    getApi: () => {
      if (!api) throw new Error('Harness has not rendered');
      return api;
    },
    getRenderCount: () => renders,
  };

  return { ...utils, viewport, controls };
}

describe('useAutoScroll', () => {
  test('returns ref + handleScroll + resetScrollFlag', () => {
    const { controls } = setup([1, 2, 3]);
    const api = controls.getApi();
    expect(api.scrollAreaRef).toBeDefined();
    expect(typeof api.handleScroll).toBe('function');
    expect(typeof api.resetScrollFlag).toBe('function');
  });

  test('auto-scrolls viewport to bottom on mount', () => {
    const { viewport } = setup([1, 2, 3]);
    expect(viewport.scrollTop).toBe(1000);
  });

  test('does NOT fire effect when triggers are unchanged across renders', () => {
    const { viewport, controls } = setup([1, 'msg', 'tools']);
    expect(viewport.scrollTop).toBe(1000);

    viewport.scrollTop = 0;
    const rendersBefore = controls.getRenderCount();

    controls.forceRerender();
    controls.forceRerender();
    controls.forceRerender();

    expect(controls.getRenderCount()).toBeGreaterThan(rendersBefore);
    expect(viewport.scrollTop).toBe(0);
  });

  test('fires effect when a trigger value changes', () => {
    const { viewport, controls } = setup([1, 'msg', 'tools']);
    viewport.scrollTop = 0;

    controls.setTriggers([2, 'msg', 'tools']);

    expect(viewport.scrollTop).toBe(1000);
  });

  test('skips auto-scroll when user has scrolled up', () => {
    const { viewport, controls } = setup([1, 'msg', 'tools']);
    expect(viewport.scrollTop).toBe(1000);

    viewport.scrollTop = 100; // 1000 - 100 - 200 = 700 > 50
    act(() => controls.getApi().handleScroll());

    controls.setTriggers([2, 'msg2', 'tools']);

    expect(viewport.scrollTop).toBe(100);
  });

  test('resetScrollFlag re-enables auto-scroll after user scrolled up', () => {
    const { viewport, controls } = setup([1, 'msg', 'tools']);
    viewport.scrollTop = 100;
    act(() => controls.getApi().handleScroll());
    act(() => controls.getApi().resetScrollFlag());

    controls.setTriggers([2, 'msg2', 'tools']);

    expect(viewport.scrollTop).toBe(1000);
  });
});
