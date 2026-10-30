# Changelog

All notable changes to `cloudflare-model-host` are recorded here. Versions follow [semantic versioning](https://semver.org/);
while the major version is 0, a minor release may break the API and a patch release does not. A published version
is never changed: a fix is a new version. Each tarball carries `PROVENANCE.json`, naming the commit and the digest
of the `dist/` it was built from ([releasing](../../docs/packages/RELEASING.md)).

## 0.1.0 (not yet published)

First release.

- The `facemorph-model-host` command: `stage`, `verify`, `qualify-origin`, `publish`, `origin-deploy`, `mirror-deploy`
  and `warm`.
- Staging for any HTTPS static host: digest checks, chunking of large files and a manifest rewritten to hosted URLs.
- An optional Cloudflare guide: a static-assets origin Worker and an R2 mirror Worker.
