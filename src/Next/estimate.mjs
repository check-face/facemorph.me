// Estimates come from measurement, never from a guess. A cached face or frame is not a
// measurement of work, and no estimate appears before this device has actually produced one
// (U-12). The estimator is the single place that turns the measured medians kept in
// product-bridge.mjs into user-visible predictions, so the pre-run estimate, the
// time-remaining readout and the slow-video warning can never disagree.

/** A job predicted to take longer than this deserves a spoken warning, never a block. */
export const SLOW_JOB_MS = 30000;

/**
 * Builds an estimator from measurement suppliers. Both suppliers return a median
 * milliseconds figure or null when this device has not produced one yet; the product
 * keeps the medians over the last eight measured units with cache hits excluded.
 */
export function createEstimator({faceMs = null, frameMs = null} = {}) {
	const finite = value => Number.isFinite(value) && value > 0 ? value : null;
	return {
		/** Median measured milliseconds per face, or null. */
		faceMs() {return finite(faceMs?.());},
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
