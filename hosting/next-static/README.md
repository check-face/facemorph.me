# Independently hosted candidate

Cloudflare Workers Assets with a narrowly routed optional diagnostics handler. No tunnel, origin server or home-network dependency. The repository's tested `deploy-next` artifact and checked public runtime assets are staged in ignored `public/`. Runtime assets above25MiB are represented by sequential16MiB verified chunks, with original full-file checksums preserved. Source inventories and private inputs are never copied.

Reuse the private diagnostics handler in `../next-cloudflare` through `run_worker_first` only for `/diagnostics/*`. Ordinary matching static requests bypass Worker execution. This avoids a separate zone-route permission requirement. Native packages belong in versioned GitHub Releases. The public runtime manifest and catalogue are same-origin. Research model notices remain mandatory.

Publish first to the workers.dev preview and verify actual acquisition and rendering before attaching `next.facemorph.me`. Do not change classic, API, or Triton routes. The previous temporary tunnel remains historical infrastructure until separately retired; it must not be referenced by the final site.
