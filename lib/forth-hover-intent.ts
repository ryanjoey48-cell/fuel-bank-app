/** One hover preview for the map, with a short dwell and a forgiving exit. */
export function createForthHoverIntent(
  open: (key: string) => void,
  close: () => void,
  clock: {
    schedule: (callback: () => void, delayMs: number) => number;
    cancel: (timer: number) => void;
  } = {
    schedule: (callback, delayMs) => globalThis.setTimeout(callback, delayMs) as unknown as number,
    cancel: (timer) => globalThis.clearTimeout(timer)
  }
) {
  let activeKey: string | null = null;
  let pendingKey: string | null = null;
  let openTimer: number | null = null;
  let closeTimer: number | null = null;
  const cancelOpen = () => {
    if (openTimer !== null) clock.cancel(openTimer);
    openTimer = null;
    pendingKey = null;
  };
  const cancelClose = () => {
    if (closeTimer !== null) clock.cancel(closeTimer);
    closeTimer = null;
  };
  const dismiss = () => {
    cancelOpen();
    cancelClose();
    if (activeKey !== null) close();
    activeKey = null;
  };
  return {
    enter(key: string) {
      cancelClose();
      if (activeKey === key || pendingKey === key) return;
      cancelOpen();
      pendingKey = key;
      openTimer = clock.schedule(() => {
        openTimer = null;
        pendingKey = null;
        activeKey = key;
        open(key);
      }, 180);
    },
    leave(key: string) {
      if (pendingKey === key) cancelOpen();
      if (activeKey !== key) return;
      cancelClose();
      closeTimer = clock.schedule(() => {
        closeTimer = null;
        if (activeKey === key) {
          activeKey = null;
          close();
        }
      }, 160);
    },
    focus(key: string) {
      cancelOpen();
      cancelClose();
      if (activeKey === key) return;
      activeKey = key;
      open(key);
    },
    dismiss
  };
}
