export const EES_NAV_SCROLL_TOP_THRESHOLD = 72;
export const EES_NAV_SCROLL_DELTA_MIN = 10;

export type NavScrollDecisionInput = {
  currentY: number;
  lastY: number;
  currentlyHidden: boolean;
  busy: boolean;
  focusInsideNav: boolean;
  topThreshold?: number;
  deltaMin?: number;
};

/** Pure hide/reveal decision for the floating EES navbar. */
export function decideNavHidden({
  currentY,
  lastY,
  currentlyHidden,
  busy,
  focusInsideNav,
  topThreshold = EES_NAV_SCROLL_TOP_THRESHOLD,
  deltaMin = EES_NAV_SCROLL_DELTA_MIN
}: NavScrollDecisionInput): boolean {
  if (busy || focusInsideNav) return false;
  if (currentY <= topThreshold) return false;

  const delta = currentY - lastY;
  if (delta > deltaMin) return true;
  if (delta < -deltaMin) return false;
  return currentlyHidden;
}

export function readViewportScrollY(): number {
  if (typeof window === "undefined") return 0;
  const scrolling = document.scrollingElement;
  if (scrolling && typeof scrolling.scrollTop === "number") {
    return scrolling.scrollTop;
  }
  return window.scrollY || document.documentElement.scrollTop || document.body.scrollTop || 0;
}

function canScrollElement(element: Element): boolean {
  if (!(element instanceof HTMLElement)) return false;
  const style = window.getComputedStyle(element);
  const overflowY = style.overflowY;
  if (overflowY !== "auto" && overflowY !== "scroll" && overflowY !== "overlay") {
    return false;
  }
  return element.scrollHeight > element.clientHeight + 1;
}

/** Collect document + nested scroll roots that may drive page motion. */
export function collectNavScrollRoots(root?: Element | null): Array<Window | Element> {
  const targets: Array<Window | Element> = [window];
  if (typeof document !== "undefined" && document.scrollingElement) {
    targets.push(document.scrollingElement);
  }

  const seed =
    root ??
    document.querySelector(".ees-shell-main") ??
    document.querySelector(".dashboard-content-frame") ??
    document.body;

  if (!seed) return targets;

  const seen = new Set<Element>();
  let node: Element | null = seed instanceof Element ? seed : null;

  while (node && node !== document.documentElement) {
    if (canScrollElement(node) && !seen.has(node)) {
      seen.add(node);
      targets.push(node);
    }
    node = node.parentElement;
  }

  for (const selector of [
    ".dashboard-content-frame",
    ".dashboard-mobile-shell",
    ".ees-shell-main",
    ".finance-centre-workspace",
    ".booking-diary-page"
  ]) {
    const match = document.querySelector(selector);
    if (match && canScrollElement(match) && !seen.has(match)) {
      seen.add(match);
      targets.push(match);
    }
  }

  return targets;
}

export function readScrollTop(target: Window | Element): number {
  if (target === window) return readViewportScrollY();
  if (target instanceof Element) return target.scrollTop || 0;
  return 0;
}
