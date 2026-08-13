import { getFiberFromDOM, type Fiber, FiberTag } from '@shared/element-tracing/fiber-internals';

/**
 * Find the React root element in the DOM.
 * Tries common selectors first, then falls back to a tree walk.
 */
function findReactRootElement(): HTMLElement | null {
  const selectors = ['#root', '#__next', '#app', '[data-reactroot]'];
  for (const selector of selectors) {
    const el = document.querySelector(selector);
    if (!el || el.nodeType !== 1) continue;

    const candidates = [el, el.firstElementChild];
    for (const candidate of candidates) {
      if (!candidate || candidate.nodeType !== 1) continue;
      if (getFiberFromDOM(candidate as HTMLElement)) return candidate as HTMLElement;
    }

    return el as HTMLElement;
  }

  if (document.body) {
    const walker = document.createTreeWalker(document.body, 1 /* NodeFilter.SHOW_ELEMENT */);
    let node: Node | null = walker.currentNode;
    while (node) {
      if (node instanceof HTMLElement && getFiberFromDOM(node)) {
        return node;
      }
      node = walker.nextNode();
    }
  }

  return null;
}

/**
 * Find the host root fiber from the React root element.
 */
export function findHostRootFiber(): Fiber | null {
  const rootElement = findReactRootElement();
  if (!rootElement) return null;

  let fiber = getFiberFromDOM(rootElement);
  if (!fiber && rootElement.firstElementChild instanceof HTMLElement) {
    fiber = getFiberFromDOM(rootElement.firstElementChild);
  }
  if (!fiber) return null;

  let current: Fiber | null = fiber;
  while (current !== null) {
    if (current.tag === FiberTag.HostRoot) {
      return current;
    }
    current = current.return;
  }

  return fiber;
}
