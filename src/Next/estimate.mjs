// Estimates come from measurement, never from a guess. A cached face or frame is not a
// measurement of work, and no estimate appears before this device has actually produced one
// (U-12). The estimator is the single place that turns the measured medians kept in
// product-bridge.mjs into user-visible predictions, so the pre-run estimate, the
// time-remaining readout and the slow-video warning can never disagree.

/** A job predicted to take longer than this deserves a spoken warning, never a block. */
export const SLOW_JOB_MS = 30000;

/**
 * Per-face priors, in milliseconds, from `route-priors.mjs`'s measured table. These are other
 * devices' numbers and are only ever used before this one has produced its own — a cold visitor
 * deciding whether to start a thirty-face job deserves a figure rather than an unbounded wait
 * (AGENTS.md, Performance Philosophy). `measured` on the returned estimate says which it is, so
 * the interface can label a prior as a rough guide and never present it as measured here.
 */
export const COLD_FACE_MS = Object.freeze({webgpu: 686, webgl: 13000, cpu: 2582});

/**
 * Builds an estimator from measurement suppliers. Both suppliers return a median
 * milliseconds figure or null when this device has not produced one yet; the product
 * keeps the medians over the last eight measured units with cache hits excluded.
 *
 * `route` supplies the admitted route name so a cold estimate can come from that route's prior
 * rather than from an average of routes that differ by twenty times.
 */
export function createEstimator({faceMs = null, frameMs = null, route = null} = {}) {
	const finite = value => Number.isFinite(value) && value > 0 ? value : null;
	return {
		/** True once this device has timed its own work; false while a prior is standing in. */
		measured() {return finite(faceMs?.()) != null || finite(frameMs?.()) != null;},
		/** This route's per-face prior, or null when the route is unknown or unranked. */
		coldFaceMs() {const name = route?.(); return name ? (COLD_FACE_MS[name] ?? null) : null;},
		/** Median measured milliseconds per face, falling back to this route's prior. */
		faceMs() {return finite(faceMs?.()) ?? this.coldFaceMs();},
		/** Median measured milliseconds per morph frame, falling back to the per-face
		 * figure when only faces have been measured: a frame is one synthesis too. */
		frameMs() {return finite(frameMs?.()) ?? this.faceMs();},
		/** Predicted total milliseconds for a job with the given unit counts, or null
		 * without a measurement. Missing units contribute nothing rather than guessing. */
		predict({faces = 0, frames = 0} = {}) {
			const perFace = this.faceMs(), perFrame = this.frameMs();
			if (perFace == null && perFrame == null)return null;
			return (perFace ?? 0) * faces + (perFrame ?? 0) * frames;
		},
		/** Predicted milliseconds still to run in the job in flight, or null. */
		remaining({facesLeft = 0, framesLeft = 0} = {}) {
			const perFace = this.faceMs(), perFrame = this.frameMs();
			if (perFace == null && perFrame == null)return null;
			return (perFace ?? 0) * facesLeft + (perFrame ?? 0) * framesLeft;
		},
	};
}

/** Spoken duration, matching the wording the product already uses elsewhere. */
export function describeMs(ms) {
	if (!Number.isFinite(ms))return '';
	const seconds = ms / 1000;
	if (seconds < 90)return `about ${Math.max(1, Math.round(seconds))} seconds`;
	if (seconds < 5400)return `about ${Math.max(1, Math.round(seconds / 60))} minutes`;
	return `about ${(seconds / 3600).toFixed(1)} hours`;
}

/** True when a predicted duration deserves the slow-run warning. Never blocking. */
export function isSlowJob(ms) {return Number.isFinite(ms) && ms > SLOW_JOB_MS;}
