import { useEffect, type RefObject } from 'react';

export const POINTER_ENTRY_RAMP_MS = 450;
export const pointerEntryInfluence = (elapsedMs: number, reducedMotion = false) =>
  reducedMotion ? 1 : Math.max(0, Math.min(1, elapsedMs / POINTER_ENTRY_RAMP_MS));

/** Shared by primary navigation and the narrow-screen TOC. Pointer position is
 * relative to entry (no jump); pointer influence ramps in after entry so a
 * diagonal crossing cannot yank the strip; dwelling at an edge reaches the
 * actual extreme. Wheel/drag always wins. */
export function useDragScroll(ref: RefObject<HTMLElement | null>, resetOnLeave = true, ready: unknown = true) {
  useEffect(() => {
    const el = ref.current;
    if (!el || !matchMedia('(pointer: fine)').matches) return;
    let inside = false, dragging = false, moved = false, manual = false;
    let entry = 0, baseline = 0, x = 0, dragX = 0, dragLeft = 0, enteredAt = 0;
    let edgeTimer = 0, leaveTimer = 0, wheelFrame = 0, animation = 0;
    let edge = 0;
    const max = () => Math.max(0, el.scrollWidth - el.clientWidth);
    const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
    const stop = () => { cancelAnimationFrame(animation); animation = 0; };
    const clearEdge = () => { clearTimeout(edgeTimer); edgeTimer = 0; edge = 0; };
    const smooth = (target: number) => {
      stop();
      target = Math.max(0, Math.min(max(), target));
      if (reduced()) { el.scrollLeft = target; return; }
      const from = el.scrollLeft, started = performance.now();
      const tick = (now: number) => {
        const t = Math.min(1, (now - started) / 360);
        el.scrollLeft = from + (target - from) * (1 - (1 - t) ** 3);
        if (t < 1) animation = requestAnimationFrame(tick);
        else { animation = 0; baseline = el.scrollLeft; entry = x; }
      };
      animation = requestAnimationFrame(tick);
    };
    const rebase = () => { entry = x; baseline = el.scrollLeft; };
    const dwell = () => {
      const r = el.getBoundingClientRect(), band = Math.min(48, r.width * .12);
      const side = x < r.left + band ? -1 : x > r.right - band ? 1 : 0;
      if (side === edge) return;
      clearEdge(); edge = side;
      if (side) edgeTimer = window.setTimeout(() => {
        if (inside && !dragging) smooth(side < 0 ? 0 : max());
      }, 180);
    };
    const enter = (e: MouseEvent) => {
      clearTimeout(leaveTimer); stop(); inside = true; manual = false;
      x = e.clientX; enteredAt = performance.now(); rebase(); dwell(); el.dataset.hovering = 'true';
    };
    const end = () => {
      if (!dragging) return;
      dragging = false; el.classList.remove('dragging'); rebase();
    };
    const move = (e: MouseEvent) => {
      x = e.clientX;
      if (dragging && !e.buttons) end();
      if (dragging) {
        const dx = x - dragX; moved ||= Math.abs(dx) > 4;
        el.scrollLeft = dragLeft - dx; return;
      }
      if (!inside) return;
      dwell();
      if (animation || manual || !max()) return;
      const r = el.getBoundingClientRect(), dx = x - entry;
      const runway = Math.max(r.width * .16, dx > 0 ? r.right - 16 - entry : entry - r.left - 16);
      const spatial = Math.min(1, Math.abs(dx) / runway);
      const influence = pointerEntryInfluence(performance.now() - enteredAt, reduced());
      const t = spatial * influence;
      el.scrollLeft = dx > 0 ? baseline + t * (max() - baseline) : baseline * (1 - t);
    };
    const down = (e: MouseEvent) => {
      if (e.button !== 0 || !max()) return;
      stop(); clearEdge(); dragging = true; manual = true; moved = false;
      dragX = e.clientX; dragLeft = el.scrollLeft; el.classList.add('dragging');
    };
    const leave = () => {
      inside = false; end(); clearEdge(); stop(); delete el.dataset.hovering;
      clearTimeout(leaveTimer);
      if (resetOnLeave && !manual) leaveTimer = window.setTimeout(() => {
        if (!inside && !el.querySelector(':focus-visible')) smooth(0);
      }, 420);
    };
    const wheel = () => {
      stop(); clearEdge(); manual = true; cancelAnimationFrame(wheelFrame);
      wheelFrame = requestAnimationFrame(rebase);
    };
    const click = (e: MouseEvent) => {
      if (moved) { moved = false; e.preventDefault(); e.stopPropagation(); }
    };
    const focus = (e: FocusEvent) => {
      stop(); clearEdge(); manual = true;
      const a = (e.target as HTMLElement).closest<HTMLElement>('a, button');
      if (!a) return;
      const r = el.getBoundingClientRect(), box = a.getBoundingClientRect();
      if (box.left < r.left) el.scrollLeft -= r.left - box.left + 8;
      if (box.right > r.right) el.scrollLeft += box.right - r.right + 8;
      rebase();
    };
    const blur = () => { end(); leave(); stop(); };
    el.addEventListener('mouseenter', enter); el.addEventListener('mousemove', move);
    el.addEventListener('mousedown', down); el.addEventListener('mouseleave', leave);
    el.addEventListener('wheel', wheel, { passive: true }); el.addEventListener('click', click, true);
    el.addEventListener('focusin', focus); window.addEventListener('mouseup', end); window.addEventListener('blur', blur);
    return () => {
      stop(); clearEdge(); clearTimeout(leaveTimer); cancelAnimationFrame(wheelFrame);
      el.removeEventListener('mouseenter', enter); el.removeEventListener('mousemove', move);
      el.removeEventListener('mousedown', down); el.removeEventListener('mouseleave', leave);
      el.removeEventListener('wheel', wheel); el.removeEventListener('click', click, true);
      el.removeEventListener('focusin', focus); window.removeEventListener('mouseup', end); window.removeEventListener('blur', blur);
      delete el.dataset.hovering;
    };
  }, [ref, resetOnLeave, ready]);
}
