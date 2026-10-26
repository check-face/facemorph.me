// The estimate and slow-route notes under the faces (classic Product.fs view, lines 1266-1288). The estimate
// never says "on this device" about a number this device has not produced: a prior from similar devices and a
// measurement from this one always read differently. Declared change: the slow-route note no longer links to
// desktop app availability, because native desktop packages are retired for the web-only release.

import { estimateText, type EstimateProps } from './estimate.ts';

export { estimateText, type EstimateProps };

export function Estimate(props: EstimateProps) {
  return (
    <p
      className="next-estimate"
      role="note"
      data-next-estimate={props.measuredHere ? 'measured' : 'prior'}
    >
      {estimateText(props)}
    </p>
  );
}

/** Guidance follows evidence, not the route's name: a qualified GPU route can still be slow on a given machine. */
export function SlowRoute({ route }: { route: string }) {
  return (
    <div className="next-slow-route box" role="note">
      <p>
        <strong>Generating is slow on this device.</strong>
        {route === 'cpu'
          ? ' No graphics acceleration qualified here, so it is running on the processor.'
          : ` It qualified the ${route} route, but this machine is still taking a long time per face.`}
      </p>
      <p>
        You can keep using the page while work is queued. Try a shorter morph, or compare available
        processing routes with the Processing control above the faces. A capable desktop browser may
        help if you are using a phone.
      </p>
    </div>
  );
}
