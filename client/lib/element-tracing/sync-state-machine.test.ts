import { beforeEach, describe, expect, it, mock } from 'bun:test';
import type { SyncState } from '../../../shared/element-tracing/types';
import { TracingSyncStateMachine } from './sync-state-machine';

describe('TracingSyncStateMachine', () => {
  let machine: TracingSyncStateMachine;
  let stateChanges: SyncState[];

  beforeEach(() => {
    stateChanges = [];
    machine = new TracingSyncStateMachine({
      onStateChange: (state) => stateChanges.push(state),
      timeoutMs: 100,
    });
  });

  it('should start in synced state', () => {
    expect(machine.state).toBe('synced');
  });

  it('should transition to awaiting-both on fileChanged', () => {
    machine.fileChanged();
    expect(machine.state).toBe('awaiting-both');
  });

  it('should transition through awaiting-hmr when map arrives first', () => {
    machine.fileChanged();
    machine.mapReceived();
    expect(machine.state).toBe('awaiting-hmr');
  });

  it('should transition through awaiting-map when HMR arrives first', () => {
    machine.fileChanged();
    machine.hmrCompleted();
    expect(machine.state).toBe('awaiting-map');
  });

  it('should return to synced when both arrive (map first)', () => {
    machine.fileChanged();
    machine.mapReceived();
    machine.hmrCompleted();
    expect(machine.state).toBe('synced');
  });

  it('should return to synced when both arrive (HMR first)', () => {
    machine.fileChanged();
    machine.hmrCompleted();
    machine.mapReceived();
    expect(machine.state).toBe('synced');
  });

  it('should queue clicks while not synced', () => {
    const clickHandler = mock(() => {});
    machine.fileChanged();

    machine.queueClick({ handler: clickHandler, args: ['arg1'] });
    expect(clickHandler).not.toHaveBeenCalled();

    machine.mapReceived();
    machine.hmrCompleted();

    expect(clickHandler).toHaveBeenCalledTimes(1);
    expect(clickHandler).toHaveBeenCalledWith('arg1');
  });

  it('should not queue clicks when synced', () => {
    const clickHandler = mock(() => {});
    const queued = machine.queueClick({ handler: clickHandler, args: ['arg1'] });
    expect(queued).toBe(false);
  });

  it('should notify on state changes', () => {
    machine.fileChanged();
    machine.mapReceived();
    machine.hmrCompleted();
    expect(stateChanges).toEqual(['awaiting-both', 'awaiting-hmr', 'synced']);
  });

  it('should force-sync after timeout', async () => {
    machine.fileChanged();
    expect(machine.state).toBe('awaiting-both');
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(machine.state).toBe('synced');
  });

  it('should handle rapid fileChanged calls (reset to awaiting-both)', () => {
    machine.fileChanged();
    machine.mapReceived();
    expect(machine.state).toBe('awaiting-hmr');
    machine.fileChanged();
    expect(machine.state).toBe('awaiting-both');
  });

  it('should clear queue on dispose', () => {
    const clickHandler = mock(() => {});
    machine.fileChanged();
    machine.queueClick({ handler: clickHandler, args: [] });
    machine.dispose();
    expect(clickHandler).not.toHaveBeenCalled();
  });
});
