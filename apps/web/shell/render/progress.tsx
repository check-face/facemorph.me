// The thin animated-gradient bar (classic Product.fs progressBar/scheduleFill): fills are batched into one
// animation frame and written only as `transform: scaleX(...)`, never a layout property.

const pending = new Map<HTMLElement, number>();
let scheduled = false;

function flush() {
  scheduled = false;
  for (const [element, fraction] of pending) element.style.transform = `scaleX(${fraction})`;
  pending.clear();
}

export function scheduleFill(element: HTMLElement | null, fraction: number) {
  if (!element) return;
  pending.set(element, fraction);
  if (!scheduled) {
    scheduled = true;
    requestAnimationFrame(flush);
  }
}

/** `fraction` below zero renders an indeterminate sweep. */
export function ProgressBar({ fraction }: { fraction: number }) {
  return (
    <div className="next-progress">
      {fraction < 0 ? (
        <div className="next-progress-fill next-progress-indeterminate" />
      ) : (
        <div className="next-progress-fill" ref={(el) => scheduleFill(el, fraction)} />
      )}
    </div>
  );
}
