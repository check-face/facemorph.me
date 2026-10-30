# Releasing the packages

What publishes: three npm packages, `stylegan-js`, `browser-model-manager` and `cloudflare-model-host`, and the
`model-conv` converter as source at a tagged commit (a Dockerfile and an opt-in Compose service; no npm package, no
registry image). All code is MIT licensed. No package or image contains model weights.

## Versions

- Each package has its own semantic version in its `package.json` and its own `CHANGELOG.md`. While the major
  version is 0, a minor release may break the API; a patch release does not.
- A published version is never changed or republished. A fix is a new version.
- The manager depends on `stylegan-js` and the host on `browser-model-manager` with caret ranges on the current
  versions; bump the dependent's range when a minor release of its dependency is needed.
- `model-conv` releases are tags on this repository: `model-conv-v<version>`, with release candidates
  `model-conv-v<version>-rc.<n>`. Its version is the `version` in `packages/model-conv/package.json`.

## What binds a tarball to its source

Every package build (`npm run build -w <package>`) writes `PROVENANCE.json` into the package
(`scripts/packages/write-provenance.mjs`), and `npm pack` ships it:

| Field | Meaning |
| --- | --- |
| `name`, `version` | from `package.json` |
| `sourceCommit`, `sourceTreeClean` | the commit built, and whether the package's tracked files matched it |
| `sourceIdentity` | the package's build identity (`scripts/build/identity.mjs`): its tracked files, shared configs, lockfile closure and the identities of the workspaces it depends on |
| `distSha256`, `distFiles` | a digest over every file in `dist/` (sha256 of the sorted `"<sha256>  <path>\n"` lines) |
| `build` | the GitHub repository, workflow, run and attempt when CI built it |

`node scripts/packages/verify-provenance.mjs --commit <sha> <tarball>...` recomputes the `dist/` digest from a
tarball and checks every field; it also prints each tarball's npm integrity (sha512).

## The publication workflow

`.github/workflows/packages.yml`, run by hand (Actions, "packages", Run workflow). It builds and packs the three
packages once, at the chosen commit, then on those exact tarballs:

1. checks the provenance record in each (`verify-provenance.mjs`);
2. runs the content scan on each tarball and on the model-conv build context as `docker build` sees it
   (`check-tarball-contents.mjs`, profiles in `scripts/packages/tarball-profiles/`);
3. runs the notice check on each tarball and the build context, and against the licences the built model-conv
   image's Python packages declare (`check-notices.mjs`, data in `scripts/packages/notices.json`);
4. runs `npm publish --dry-run` on each tarball.

The tarballs, `npm pack --json` output, every report and the dry-run logs are kept as the `packages-<sha>` artifact
for 90 days. Ticking `publish` adds a job that publishes those same tarballs with npm provenance attestation; it
needs the `NPM_TOKEN` secret and refuses to run without it. Publishing is the operator's step (bead fm-96v).

## Before publishing

1. Update each changed package's `CHANGELOG.md` and version, and commit to `main`.
2. Tag the converter: `git tag model-conv-v<version>-rc.<n> && git push origin model-conv-v<version>-rc.<n>`.
3. Run the `packages` workflow on that commit with `publish` unticked; it must pass.
4. Run the clean-consumer smoke with that run's tarballs and a clean clone at the tag:

   ```sh
   gh run download <run id> -n packages-<sha> -D /tmp/packages
   git clone --branch model-conv-v<version>-rc.<n> https://github.com/facemorph-me/facemorph.me.git /tmp/rc
   cd /tmp/rc && npm ci
   node scripts/packages/clean-consumer-smoke.mjs --tarballs /tmp/packages --clone /tmp/rc --out /tmp/smoke
   ```

   It follows the public docs through the non-face journey (acquire, convert in the container, host on a local
   HTTPS server, manager-loaded and caller-loaded inference, a three-seed morph, PNG and lossless WebP reopen,
   intercepted requests) and writes every step to `/tmp/smoke/smoke.json`. It needs Docker, the checkpoints'
   download and Playwright Chromium. Fix any doc step it finds wrong before publishing.
5. Tag the converter release (`model-conv-v<version>`) on the same commit, then publish (step 3 with `publish`).
6. The independent review ([review packet](review-packet.md)) runs against the published versions. An author's
   smoke never stands in for it.

## Licences and notices

- `LICENSE` (MIT) in each package and at the repository root.
- `THIRD_PARTY_NOTICES` in each npm package, and `packages/model-conv/NOTICE.md` for the converter: the third-party
  code each contains or installs. `scripts/packages/notices.json` lists that code by file; `check-notices.mjs`
  fails when the artifact holds third-party code no notice claims, when a notice names code the artifact no longer
  has, or when the notice text leaves out a listed item.
- Model weights are not covered by the code licence. Their terms (NVIDIA's StyleGAN2 and StyleGAN2-ADA licences,
  the FFHQ and AFHQ dataset terms, e4e's licence) are listed in each package README and are served beside the
  weights by whoever hosts them.
- The model-conv image is built locally and never pushed. Pushing it to a registry needs a licence review of the
  image first.
