// Where model files may also come from (fm-fr9s): application configuration for the manager's `alternateOrigins`.
// models.facemorph.me (R2, separate storage from the site; added after one edge answered HTTP 500 for a chunk for
// twenty-five minutes on 20 October, candidate 6107f80) is used only when the page itself is facemorph.me or one of
// its subdomains, the candidate's runtimeMirror() scoping. A local harness, a preview host or any other origin gets
// no alternate, so it never contacts models.facemorph.me. The mirror copies only the site's immutable /runtime/
// files, so pass these origins to the cache that acquires the runtime manifest's assets, not to other fetches.

export const MODEL_ALTERNATE_ORIGIN = 'https://models.facemorph.me';

/** True for facemorph.me and its subdomains, never for a look-alike such as `notfacemorph.me`. */
export const isFacemorphHost = (hostname: string): boolean =>
  hostname === 'facemorph.me' || hostname.endsWith('.facemorph.me');

/** The manager's `alternateOrigins` for a page on `hostname` (`location.hostname`). */
export function modelAlternateOrigins(hostname: string): readonly string[] {
  return isFacemorphHost(hostname) ? Object.freeze([MODEL_ALTERNATE_ORIGIN]) : Object.freeze([]);
}
