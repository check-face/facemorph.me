type Subscribe = (notify: () => void) => () => void;

/** Only React's notifications wait for a frame: controller state, effects and other subscribers stay synchronous.
 * A cold acquisition can publish many progress updates in one microtask chain. Rendering each one can exceed
 * React's nested-update limit; the next paint needs only the latest snapshot.
 */
export function frameSubscription(
  subscribe: Subscribe,
  request: (notify: () => void) => number = requestAnimationFrame,
  cancel: (frame: number) => void = cancelAnimationFrame,
): Subscribe {
  return (notify) => {
    let active = true;
    let frame: number | null = null;
    const off = subscribe(() => {
      if (!active || frame !== null) return;
      frame = request(() => {
        frame = null;
        if (active) notify();
      });
    });
    return () => {
      if (!active) return;
      active = false;
      off();
      if (frame !== null) cancel(frame);
      frame = null;
    };
  };
}
