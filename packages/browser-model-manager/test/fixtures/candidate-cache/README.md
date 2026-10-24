The candidate's own model-cache modules, byte for byte (fm-eulc): `src/Next/Assets/model-cache.mjs`,
`shard-store.mjs` and `sha256.mjs` at classic `a42829b` (identical at `551b607`, the control artifact's commit),
with the SHA-256s `import/allowlist.json` pins (`fe532653…`, `26f65f7f…`, `91b5831f…`). They are the writer in
`cache-local.test.ts`: the control's code stores assets in Cache Storage and OPFS, and the package must read
those entries locally, without a download. The `.frozen` suffix keeps the formatter off their bytes; the test
checks the digests before serving them.
