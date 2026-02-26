import { describe, expect, it, mock } from 'bun:test';
import { createMockWebview } from './mocks';

// StateHub uses `import type` for vscode and @lib/types.
// bun strips type-only imports at compile time, but the path alias @lib/types
// needs to resolve. Mock the module so bun doesn't choke on the alias.
mock.module('@lib/types', () => ({}));

const { StateHub } = await import('../StateHub');

describe('StateHub', () => {
  function createHub() {
    return new StateHub();
  }

  describe('register', () => {
    it('sends state:init with current state', () => {
      const hub = createHub();
      const wv = createMockWebview();
      hub.register('panel-a', wv as never);

      expect(wv.messages).toHaveLength(1);
      expect((wv.messages[0] as { type: string }).type).toBe('state:init');
    });

    it('registered panel receives broadcasts', () => {
      const hub = createHub();
      const wv = createMockWebview();
      hub.register('panel-a', wv as never);
      wv.messages.length = 0; // clear init message

      hub.applyUpdate('panel-a', { hoveredId: 'x' });
      expect(wv.messages).toHaveLength(1);
      expect((wv.messages[0] as { type: string }).type).toBe('state:update');
    });
  });

  describe('unregister', () => {
    it('removed panel does not receive broadcasts', () => {
      const hub = createHub();
      const wv = createMockWebview();
      hub.register('p1', wv as never);
      wv.messages.length = 0;

      hub.unregister('p1');
      hub.applyUpdate('other', { hoveredId: 'y' });
      expect(wv.messages).toHaveLength(0);
    });
  });

  describe('applyUpdate', () => {
    it('merges patch into state', () => {
      const hub = createHub();
      hub.applyUpdate('src', { hoveredId: 'abc' });
      expect(hub.state.hoveredId).toBe('abc');
    });

    it('broadcasts state:update to all panels', () => {
      const hub = createHub();
      const wv1 = createMockWebview();
      const wv2 = createMockWebview();
      hub.register('p1', wv1 as never);
      hub.register('p2', wv2 as never);
      wv1.messages.length = 0;
      wv2.messages.length = 0;

      hub.applyUpdate('p1', { selectedIds: ['x'] });
      expect(wv1.messages).toHaveLength(1);
      expect(wv2.messages).toHaveLength(1);
    });

    it('echoes to sender (preview needs this)', () => {
      const hub = createHub();
      const sender = createMockWebview();
      hub.register('sender', sender as never);
      sender.messages.length = 0;

      hub.applyUpdate('sender', { hoveredId: 'z' });
      expect(sender.messages).toHaveLength(1);
    });

    it('notifies external listeners with state and patch', () => {
      const hub = createHub();
      const patches: unknown[] = [];
      hub.onChange((_state, patch) => patches.push(patch));

      hub.applyUpdate('src', { hoveredId: 'test' });
      expect(patches).toHaveLength(1);
      expect(patches[0]).toEqual({ hoveredId: 'test' });
    });

    it('handles multiple sequential updates', () => {
      const hub = createHub();
      hub.applyUpdate('a', { hoveredId: '1' });
      hub.applyUpdate('a', { selectedIds: ['x'] });
      hub.applyUpdate('a', { hoveredId: '2' });

      expect(hub.state.hoveredId).toBe('2');
      expect(hub.state.selectedIds).toEqual(['x']);
    });
  });

  describe('onChange', () => {
    it('listener called on each applyUpdate', () => {
      const hub = createHub();
      let count = 0;
      hub.onChange(() => count++);

      hub.applyUpdate('a', { hoveredId: '1' });
      hub.applyUpdate('a', { hoveredId: '2' });
      expect(count).toBe(2);
    });

    it('unsubscribe removes listener', () => {
      const hub = createHub();
      let count = 0;
      const unsub = hub.onChange(() => count++);

      hub.applyUpdate('a', { hoveredId: '1' });
      unsub();
      hub.applyUpdate('a', { hoveredId: '2' });
      expect(count).toBe(1);
    });

    it('multiple listeners all called independently', () => {
      const hub = createHub();
      let a = 0;
      let b = 0;
      hub.onChange(() => a++);
      hub.onChange(() => b++);

      hub.applyUpdate('x', { hoveredId: 'z' });
      expect(a).toBe(1);
      expect(b).toBe(1);
    });
  });

  describe('sendInit', () => {
    it('re-sends state:init to specific panel', () => {
      const hub = createHub();
      const wv = createMockWebview();
      hub.register('p1', wv as never);
      wv.messages.length = 0;

      hub.applyUpdate('ext', { hoveredId: 'changed' });
      wv.messages.length = 0;

      hub.sendInit('p1');
      expect(wv.messages).toHaveLength(1);
      expect((wv.messages[0] as { type: string }).type).toBe('state:init');
      expect((wv.messages[0] as { state: { hoveredId: string } }).state.hoveredId).toBe('changed');
    });

    it('no-op if panel not registered', () => {
      const hub = createHub();
      // should not throw
      hub.sendInit('nonexistent');
    });
  });

  describe('dispose', () => {
    it('clears panels and listeners', () => {
      const hub = createHub();
      const wv = createMockWebview();
      hub.register('p1', wv as never);
      let called = false;
      hub.onChange(() => {
        called = true;
      });

      hub.dispose();
      hub.applyUpdate('x', { hoveredId: 'y' });
      expect(wv.messages.length).toBe(1); // only the init message
      expect(called).toBe(false);
    });
  });
});
