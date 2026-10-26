type Subscribe<Event> = (notify: (event?: Event) => void) => () => void;

/** Selected progress notifications wait for a frame; other transitions notify React synchronously.
 * Controller state, effects and ordinary subscribers always stay synchronous. A cold acquisition can publish
 * many updates in one microtask chain; the next paint needs only the latest progress snapshot.
 */
export function frameSubscription<Event>(
  subscribe: Subscribe<Event>,
  request: (notify: () => void) => number = requestAnimationFrame,
  cancel: (frame: number) => void = cancelAnimationFrame,
  defer: (event?: Event) => boolean = () => true,
): Subscribe<never> {
  return (notify) => {
    let active = true;
    let frame: number | null = null;
    const off = subscribe((event) => {
      if (!active) return;
      // Native controlled-input changes must reach React before its event restores the DOM value.
      if (!defer(event)) {
        if (frame !== null) cancel(frame);
        frame = null;
        notify();
        return;
      }
      if (frame !== null) return;
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
