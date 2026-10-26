# The workspace and its gates (fm-fy2.4)

## Layout

npm workspaces, one lock at the root. Root `workspaces` is exactly `apps/web`, `packages/stylegan-js`,
`packages/browser-model-manager`, `packages/cloudflare-model-host` and `packages/model-conv`. Do not add another
package manager or orchestration tool; `scripts/build/check-scaffold.mjs` fails on `pnpm-lock.yaml`, `yarn.lock`,
`bun.lockb`, `turbo.json`, `nx.json` or `lerna.json`.

```sh
npm ci                  # Node 24 (.nvmrc); CI never runs npm install
npm run format:check    # oxfmt --check
npm run lint            # oxlint --deny-warnings
npm run typecheck       # tsc per workspace, separate from bundling
npm run build           # declaration builds, stylegan-js first
npm test                # every workspace's tests plus scripts/build
npm run build:next      # deploy-next/ (docs/dev/build-next.md)
```

To fix rather than check, run `npm run format` and `npm run lint:fix`.

Run these from the repository root. `npm test` and `build:next` fetch the pinned classic control from GitHub's API
(scripts/import/fetch-control.mjs); when the anonymous rate limit is spent (a 403), export a token first, for example
`export GITHUB_TOKEN=$(gh auth token)`. On 26 October 2026 this whole sequence passed in a fresh clone of 759ec1d.

## Dependencies

Every dependency is a caret range at its latest release (`npm install <pkg>@latest`), never an exact pin or a
held-back version (operator, 24 October 2026). The lock records what resolved; CI installs it with `npm ci` and
never fetches `latest` at build time. Every TypeScript-API tool resolves the one root TypeScript.

## TypeScript

`tsconfig.base.json` sets `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
`isolatedModules` and `verbatimModuleSyntax`; no package overrides them. Pick the scoped config that matches
where the code runs: `tsconfig.dom.json` (browser), `tsconfig.worker.json` (WebWorker) or `tsconfig.node.json`
(Node). Shared contracts get none of these, so a stray `window` or `process` fails typecheck.

## Oxc

`.oxfmtrc.json` sets width 100, two spaces, single quotes, and import and package.json sorting off. `.oxlintrc.json` enables
correctness, TypeScript, React and react-hooks rules, with browser, worker and Node overrides. Both configs
carry exactly the ignore list in `scripts/build/oxc-scope.json`: dependencies and build output, the imported
candidate closure, frozen research directories, generated data and fixtures, `.beads/` and Markdown.

### Editors

- **VS Code:** install the Oxc extension (`oxc.oxc-vscode`). Add this to the workspace settings:
  ```json
  {
    "editor.defaultFormatter": "oxc.oxc-vscode",
    "editor.formatOnSave": true,
    "oxc.enable": true
  }
  ```
  The extension reads both config files at the root. If your extension version cannot format with oxfmt, run
  `npx oxfmt <file>` on save instead.
- **Other editors:** run `npx oxfmt <file>` on save and `npx oxlint <file>` for diagnostics. Both use the
  versions in the lock.

Never format ignored paths by hand. The imported application is maintained as product code; CI checks behavior,
module resolution and excluded private/generated files without requiring frozen per-file hashes.

## CI

`.github/workflows/scaffold.yml` runs on every push to `main`, in this order:

1. `npm ci`.
2. The scaffold, single-TypeScript and interop checks.
3. `format:check`, `lint` and `typecheck`.
4. `check-tests-listed`.
5. Build, test and pack every package.
6. `seeded-gates.mjs`: each gate fails on a planted violation that names its own file, and the clean tree
   passes.
7. `format-stable.mjs`: a second `format` changes nothing, and frozen paths keep their digests.
8. `git diff --exit-code`.

Every building lane runs `format:check` and `lint` before it builds.
