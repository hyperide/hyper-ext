import { useEffect, useRef } from 'react';
import { mountUi } from '../lib/jsx-sandbox';

/**
 * Where an example's component is mounted (R38).
 *
 * A separate React root inside this page's tree: the example's element was
 * created by the sandbox against the sandbox's React scope, and a fresh root
 * per run guarantees that a previous run's component — still subscribed to a
 * previous run's store — is gone before the next one mounts.
 */
export function UiSlot({ element, placeholder }: { element: unknown; placeholder: string }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!host.current || !element) return;
    // A checkpoint can replace the component while React is committing the outer
    // page. Give each nested root its own node so a deferred unmount cannot remove
    // children belonging to the next root (NotFoundError on example navigation).
    const container = document.createElement('div');
    host.current.append(container);
    const dispose = mountUi(container, element);
    return () => { queueMicrotask(dispose); container.remove(); };
  }, [element]);
  return (
    <div className="ui-slot">
      {!element && <span className="lnote">{placeholder}</span>}
      <div ref={host} />
    </div>
  );
}
