import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal, flushSync } from 'react-dom';
import { useRoute } from './router';
import type { PointerEvent as ReactPointerEvent } from 'react';
type LockableOrientation = ScreenOrientation & { lock?: (orientation: 'landscape') => Promise<void> };
type Figure = { svg: string; title: string; description: string; width: number; height: number };
type Opened = { figures: Figure[]; index: number; host: HTMLElement; popup: Window | null; trigger: HTMLElement };
function figures(): { node: SVGSVGElement; value: Figure }[] {
  return Array.from(document.querySelectorAll<SVGSVGElement>('#page-content svg'))
    .filter((svg) => svg.viewBox.baseVal.width > 150 || svg.getBoundingClientRect().width > 220)
    .map((svg, i) => {
      const node = svg.cloneNode(true) as SVGSVGElement;
      const prefix = `diagram-${i}-`;
      const ids = Array.from(node.querySelectorAll('[id]')).map((el) => el.id);
      for (const el of [node, ...Array.from(node.querySelectorAll('*'))])
        for (const attr of Array.from(el.attributes)) {
          let value = attr.value;
          for (const id of ids) {
            value = value.replaceAll(`url(#${id})`, `url(#${prefix}${id})`);
            if ((attr.name === 'href' || attr.name === 'xlink:href') && value === `#${id}`) value = `#${prefix}${id}`;
            if (attr.name === 'id' && value === id) value = prefix + id;
          }
          if (value !== attr.value) el.setAttribute(attr.name, value);
        }
      const box = svg.viewBox.baseVal,
        width = box.width || 660,
        height = box.height || 300;
      node.setAttribute('width', String(width));
      node.setAttribute('height', String(height));
      node.style.maxWidth = 'none';
      const region = svg.closest('figure,.fig') ?? svg.parentElement;
      return {
        node: svg,
        value: {
          svg: node.outerHTML,
          width,
          height,
          title: svg.closest('section')?.querySelector('h2,h3')?.textContent?.trim() || `Diagram ${i + 1}`,
          description:
            region?.querySelector('figcaption')?.textContent?.trim() ||
            svg.getAttribute('aria-label') ||
            'Diagram from this page.',
        },
      };
    });
}
export function DiagramViewer() {
  const route = useRoute();
  const [opened, setOpened] = useState<Opened | null>(null);
  const currentOpened = useRef(opened);
  currentOpened.current = opened;
  const close = useCallback(() => setOpened(null), []);
  useEffect(() => {
    const buttons = new Map<SVGSVGElement, HTMLButtonElement>();
    const scan = () => {
      for (const [node, button] of buttons) {
        if (!node.isConnected) {
          button.remove();
          buttons.delete(node);
        }
      }
      for (const { node } of figures())
        if (!buttons.has(node)) {
          // A previous prerender includes the semantic button; replace it with a live handler.
          const parent = node.closest('figure,.fig') ?? node.parentElement!;
          parent.querySelectorAll(':scope > .diagram-expand').forEach((b) => b.remove());
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'diagram-expand';
          button.dataset.noExport = '';
          button.textContent = '⛶ Expand diagram';
          button.title = 'Open zoomable gallery; on a smaller desktop window this may open a separate window';
          button.onclick = () => {
            const list = figures();
            const index = list.findIndex((f) => f.node === node);
            if (index < 0) return;
            const selection = {
              figures: list.map((f) => f.value),
              index,
              trigger: button,
            };
            const current = currentOpened.current;
            if (current && (!current.popup || !current.popup.closed)) {
              flushSync(() => setOpened({ ...current, ...selection }));
              current.popup?.focus();
              return;
            }
            // Release a closed window's portal before creating its replacement.
            if (current) flushSync(close);
            let popup: Window | null = null;
            let host = document.body;
            const mobile = matchMedia('(pointer: coarse)').matches;
            const smaller = window.outerWidth < screen.availWidth - 80 || window.outerHeight < screen.availHeight - 120;
            if (!mobile && smaller) {
              popup = window.open(
                '',
                'state-diagram-viewer',
                `popup=yes,width=${screen.availWidth},height=${screen.availHeight},left=0,top=0,resizable=yes,scrollbars=yes`,
              );
              if (popup && !popup.closed) {
                popup.opener = null;
                popup.document.title = 'state · diagram gallery';
                popup.document.head.innerHTML = '';
                popup.document.body.innerHTML = '';
                for (const style of document.querySelectorAll('style,link[rel="stylesheet"]')) {
                  const clone = style.cloneNode(true) as HTMLElement;
                  if (style instanceof HTMLLinkElement) clone.setAttribute('href', style.href);
                  popup.document.head.append(clone);
                }
                popup.document.documentElement.dataset.theme = document.documentElement.dataset.theme ?? '';
                host = popup.document.body;
              } else popup = null;
            }
            flushSync(() =>
              setOpened({
                ...selection,
                host,
                popup,
              }),
            );
            if (mobile) {
              const view = document.querySelector<HTMLElement>('.diagram-viewer');
              view
                ?.requestFullscreen?.()
                .then(() => {
                  const lock = (screen.orientation as LockableOrientation)?.lock;
                  return lock?.call(screen.orientation, 'landscape');
                })
                .catch(() => {
                  /* The rotate control and manual device rotation remain available. */
                });
            }
          };
          parent.append(button);
          buttons.set(node, button);
        }
    };
    scan();
    const observer = new MutationObserver(scan);
    const root = document.getElementById('page-content');
    if (root) observer.observe(root, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      for (const button of buttons.values()) button.remove();
      buttons.clear();
      setOpened(null);
    };
  }, [route, close]);
  return opened ? createPortal(<Gallery key={route} opened={opened} close={close} />, opened.host) : null;
}
function Gallery({ opened, close }: { opened: Opened; close: () => void }) {
  const [selection, setSelection] = useState({ opened, index: opened.index }),
    [scale, setScale] = useState(1),
    [xy, setXY] = useState({ x: 0, y: 0 }),
    [angle, setAngle] = useState(0),
    [hint, setHint] = useState('');
  const stage = useRef<HTMLDivElement>(null),
    root = useRef<HTMLDivElement>(null);
  const points = useRef(new Map<number, { x: number; y: number }>());
  const trigger = useRef(opened.trigger);
  trigger.current = opened.trigger;
  // A reused popup can receive a shorter list before effects have run.
  const index = selection.opened === opened ? selection.index : opened.index;
  if (selection.opened !== opened) setSelection({ opened, index });
  const transform = useRef({ scale, xy });
  transform.current = { scale, xy };
  const fig = opened.figures[index];
  const fitToViewport = useCallback(() => {
    const box = stage.current?.getBoundingClientRect();
    if (!box) return;
    const swapped = angle % 180 !== 0;
    setScale(
      Math.min(
        (box.width - 32) / (swapped ? fig.height : fig.width),
        (box.height - 32) / (swapped ? fig.width : fig.height),
      ),
    );
    setXY({ x: 0, y: 0 });
  }, [angle, fig.width, fig.height]);
  const zoom = (factor: number, anchor = { x: 0, y: 0 }) => {
    const old = transform.current;
    const next = Math.max(0.08, Math.min(12, old.scale * factor));
    const ratio = next / old.scale;
    setScale(next);
    setXY({ x: anchor.x - (anchor.x - old.xy.x) * ratio, y: anchor.y - (anchor.y - old.xy.y) * ratio });
  };
  const next = (delta: number) =>
    setSelection((current) => ({
      opened,
      index: (current.index + delta + opened.figures.length) % opened.figures.length,
    }));
  useLayoutEffect(() => {
    fitToViewport();
    const el = stage.current;
    if (!el) return;
    const ro = new ResizeObserver(fitToViewport);
    ro.observe(el);
    return () => ro.disconnect();
  }, [fitToViewport, index]);
  const handlers = useRef({ fitToViewport, zoom, next });
  handlers.current = { fitToViewport, zoom, next };
  useEffect(() => {
    const viewer = root.current;
    const doc = opened.host.ownerDocument,
      win = doc.defaultView!;
    root.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const bodyOverflow = document.body.style.overflow,
      app = document.getElementById('root'),
      wasInert = app?.inert;
    if (!opened.popup) {
      document.body.style.overflow = 'hidden';
      if (app) app.inert = true;
    }
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
      } else if (e.key === '+' || e.key === '=') {
        e.preventDefault();
        handlers.current.zoom(1.2);
      } else if (e.key === '-') {
        e.preventDefault();
        handlers.current.zoom(1 / 1.2);
      } else if (e.key === '0') {
        e.preventDefault();
        handlers.current.fitToViewport();
      } else if (e.key === 'ArrowRight' || e.key === 'PageDown') {
        e.preventDefault();
        handlers.current.next(1);
      } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        e.preventDefault();
        handlers.current.next(-1);
      } else if (e.key === 'Tab') {
        const all = Array.from(root.current?.querySelectorAll<HTMLElement>('button,a,[tabindex="0"]') ?? []);
        const first = all[0],
          last = all.at(-1);
        if (e.shiftKey && doc.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && doc.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    const unload = () => close();
    doc.addEventListener('keydown', key);
    win.addEventListener('beforeunload', unload);
    return () => {
      doc.removeEventListener('keydown', key);
      win.removeEventListener('beforeunload', unload);
      if (!opened.popup) {
        document.body.style.overflow = bodyOverflow;
        if (app) app.inert = !!wasInert;
      }
      if (doc.fullscreenElement === viewer) void doc.exitFullscreen?.().catch(() => {});
      try {
        win.screen.orientation?.unlock();
      } catch {}
      opened.popup?.close();
      trigger.current.focus({ preventScroll: true });
    };
  }, [opened.host, opened.popup, close]);
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      zoom(Math.exp(-e.deltaY * 0.002), { x: e.clientX - r.left - r.width / 2, y: e.clientY - r.top - r.height / 2 });
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  }, []);
  const move = (e: ReactPointerEvent) => {
    const map = points.current;
    if (!map.has(e.pointerId)) return;
    const old = [...map.values()];
    const previous = map.get(e.pointerId)!;
    map.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const updated = [...map.values()];
    if (updated.length === 1) setXY((v) => ({ x: v.x + e.clientX - previous.x, y: v.y + e.clientY - previous.y }));
    else if (updated.length === 2) {
      const distance = (a: typeof old) => Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y);
      const r = stage.current!.getBoundingClientRect();
      const center = {
        x: (updated[0].x + updated[1].x) / 2 - r.left - r.width / 2,
        y: (updated[0].y + updated[1].y) / 2 - r.top - r.height / 2,
      };
      if (distance(old) > 0) zoom(distance(updated) / distance(old), center);
    }
  };
  return (
    <div className="diagram-viewer" role="dialog" aria-modal="true" aria-label="Diagram gallery" ref={root}>
      <div className="diagram-toolbar">
        <button className="tab" onClick={close}>
          Close ✕
        </button>
        <button className="tab" onClick={() => next(-1)} aria-label="Previous diagram">
          ←
        </button>
        <span>
          {index + 1}/{opened.figures.length} · {fig.title}
        </span>
        <button className="tab" onClick={() => next(1)} aria-label="Next diagram">
          →
        </button>
        <button className="tab" onClick={() => zoom(1 / 1.2)} aria-label="Zoom out">
          −
        </button>
        <output aria-label="Zoom level">{Math.round(scale * 100)}%</output>
        <button className="tab" onClick={() => zoom(1.2)} aria-label="Zoom in">
          +
        </button>
        <button className="tab" onClick={fitToViewport}>
          Fit · 0
        </button>
        <button className="tab" onClick={() => setAngle((a) => (a + 90) % 360)}>
          Rotate 90°
        </button>
        <button
          className="tab"
          onClick={() => {
            root.current
              ?.requestFullscreen?.()
              .then(() => {
                const win = opened.host.ownerDocument.defaultView!;
                return (win.screen.orientation as LockableOrientation)?.lock?.('landscape');
              })
              .catch(() =>
                setHint('Fullscreen or orientation lock is unavailable here. Rotate your device or use Rotate 90°.'),
              );
          }}
        >
          Fullscreen
        </button>
      </div>
      <div
        className="diagram-stage"
        ref={stage}
        tabIndex={0}
        aria-label="Zoom and pan diagram"
        onDoubleClick={fitToViewport}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          points.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        }}
        onPointerMove={move}
        onPointerUp={(e) => points.current.delete(e.pointerId)}
        onPointerCancel={(e) => points.current.delete(e.pointerId)}
      >
        <div
          className="diagram-transform"
          style={{
            width: fig.width,
            height: fig.height,
            transform: `translate(-50%,-50%) translate(${xy.x}px,${xy.y}px) scale(${scale}) rotate(${angle}deg)`,
          }}
          dangerouslySetInnerHTML={{ __html: fig.svg }}
        />
      </div>
      <div className="diagram-caption">
        <p>{fig.description}</p>
        <small>
          {hint ||
            'Wheel / trackpad or pinch to zoom · drag to pan · double-click or 0 to fit · arrows change diagram. Browser permissions decide fullscreen, window size and orientation lock.'}
        </small>
      </div>
    </div>
  );
}
