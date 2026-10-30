# Changelog

All notable changes to `browser-model-manager` are recorded here. Versions follow [semantic versioning](https://semver.org/);
while the major version is 0, a minor release may break the API and a patch release does not. A published version
is never changed: a fix is a new version. Each tarball carries `PROVENANCE.json`, naming the commit and the digest
of the `dist/` it was built from ([releasing](../../docs/packages/RELEASING.md)).

## 0.1.0 (not yet published)

First release.

- Acquisition only after the app or person authorizes it; construction and status reads make no request.
- Verified local storage in OPFS, with a Cache Storage fallback; quota checks, eviction and reference-counted leases.
- A verified local reader the engine loads models through, and typed invalidation.
- The model manifest schema (`schema/model-manifest.v1.schema.json`).
