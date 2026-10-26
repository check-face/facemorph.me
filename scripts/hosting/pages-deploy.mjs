// Legacy Pages has no uploader in cf beta.21 (`cf pages deploy` always refuses).
// Upload immutable assets through the same Pages-only token, then let the installed
// cf create the existing project's deployment, preserving branch and commit identity.
// Protocol: cloudflare/workers-sdk packages/deploy-helpers/src/deploy/helpers/hash.ts
// and packages/wrangler/src/pages/upload.ts (Direct Upload hash/payload contract only).
import { createRequire } from 'node:module';
import { readdirSync, lstatSync, readFileSync, writeFileSync } from 'node:fs';
import { join, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { spawnSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const fromCf = createRequire(require.resolve('cf/package.json'));
const { hash } = fromCf('blake3-wasm');
const REPO = fileURLToPath(new URL('../..', import.meta.url));
const API = 'https://api.cloudflare.com/client/v4';
const TYPES = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.sqlite3': 'application/vnd.sqlite3',
};
export function assetHash(bytes, filename) {
  return hash(bytes.toString('base64') + extname(filename).slice(1))
    .toString('hex')
    .slice(0, 32);
}
export function assetsIn(directory) {
  const assets = [];
  function walk(at, prefix = '') {
    for (const name of readdirSync(at).sort()) {
      const path = join(at, name),
        relative = prefix + name,
        stat = lstatSync(path);
      if (stat.isSymbolicLink()) throw Error(`Do not publish symlink: ${relative}`);
      if (
        [
          '.git',
          '.wrangler',
          'node_modules',
          'functions',
          '_worker.js',
          '_headers',
          '_redirects',
          '_routes.json',
        ].includes(name)
      )
        throw Error(`Unsupported tracker asset: ${relative}`);
      if (stat.isDirectory()) walk(path, relative + '/');
      else {
        if (!stat.isFile() || stat.size > 25 * 1024 * 1024)
          throw Error(`Invalid Pages asset: ${relative}`);
        const bytes = readFileSync(path);
        assets.push({
          path,
          name: '/' + relative,
          bytes: bytes.length,
          hash: assetHash(bytes, name),
          contentType: TYPES[extname(name)] || 'application/octet-stream',
        });
      }
    }
  }
  walk(resolve(directory));
  if (!assets.length || assets.length > 20_000) throw Error('Invalid Pages asset count');
  return assets;
}
export function deploymentArgs({ project, branch, commit, manifest, publish }) {
  if (typeof project !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(project))
    throw Error('Invalid Pages project');
  if (!branch || /[\r\n\0]/.test(branch)) throw Error('Invalid Pages branch');
  if (!/^[a-f0-9]{40}$/.test(commit)) throw Error('A full source commit SHA is required');
  return [
    'pages',
    'deployments',
    'create',
    project,
    '--branch',
    branch,
    '--commit-hash',
    commit,
    '--commit-dirty',
    'false',
    '--manifest',
    JSON.stringify(manifest),
    ...(publish ? [] : ['--dry-run']),
  ];
}
// Every call here is idempotent (an upload token, or asset operations keyed by content hash), so a Cloudflare 5xx
// or a dropped connection is retried a few times; a 5xx body is often plain text ("Internal server error"), which
// failed the beads-site publish as a JSON parse error.
export async function request(
  path,
  token,
  body,
  { attempts = 4, wait = (ms) => new Promise((r) => setTimeout(r, ms)), fetchImpl = fetch } = {},
) {
  for (let attempt = 1; ; attempt++) {
    let response;
    try {
      response = await fetchImpl(API + path, {
        method: body === undefined ? 'GET' : 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(120_000),
        headers: {
          Authorization: `Bearer ${token}`,
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch (error) {
      if (attempt >= attempts) throw Error(`Pages API ${path}: ${error.message}`);
      await wait(2000 * attempt);
      continue;
    }
    if (response.status >= 500 && attempt < attempts) {
      await wait(2000 * attempt);
      continue;
    }
    const text = await response.text();
    let value;
    try {
      value = JSON.parse(text);
    } catch {
      throw Error(`Pages API ${path}: HTTP ${response.status}, not JSON: ${text.slice(0, 80)}`);
    }
    if (!response.ok || value.success !== true)
      throw Error(`Pages API ${path}: HTTP ${response.status}`);
    return value.result;
  }
}
async function uploadAssets(assets, { account, project, token }) {
  if (!/^[a-f0-9]{32}$/.test(account) || !token)
    throw Error('Scoped Pages token and account ID required');
  const { jwt } = await request(
    `/accounts/${account}/pages/projects/${project}/upload-token`,
    token,
  );
  if (typeof jwt !== 'string' || !jwt) throw Error('Pages upload token missing');
  const unique = new Map(assets.map((asset) => [asset.hash, asset]));
  const hashes = [...unique.keys()];
  const missing = await request('/pages/assets/check-missing', jwt, { hashes });
  if (!Array.isArray(missing) || missing.some((key) => !unique.has(key)))
    throw Error('Invalid missing-assets result');
  // Serial bounded batches: the tracker is small; no need for a second upload scheduler.
  let batch = [],
    bytes = 0;
  async function flush() {
    if (!batch.length) return;
    await request('/pages/assets/upload', jwt, batch);
    batch = [];
    bytes = 0;
  }
  for (const key of missing) {
    const asset = unique.get(key),
      value = readFileSync(asset.path);
    if (assetHash(value, asset.path) !== key) throw Error('Tracker input changed during upload');
    if (bytes + value.length > 40 * 1024 * 1024 || batch.length >= 2000) await flush();
    batch.push({
      key,
      value: value.toString('base64'),
      metadata: { contentType: asset.contentType },
      base64: true,
    });
    bytes += value.length;
  }
  await flush();
  await request('/pages/assets/upsert-hashes', jwt, { hashes });
}
export async function main(argv) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      project: { type: 'string' },
      branch: { type: 'string', default: 'main' },
      commit: { type: 'string' },
      publish: { type: 'boolean', default: false },
    },
  });
  if (positionals.length !== 1)
    throw Error(
      'Usage: pages-deploy.mjs <site-dir> --project=<name> --commit=<sha> [--branch=main] [--publish]',
    );
  // Validate identity before changing the exported directory or opening a socket.
  deploymentArgs({ ...values, manifest: {} });
  const directory = resolve(positionals[0]),
    index = join(directory, 'index.html');
  const source = `<footer id="beads-deployment-source">Source commit <code>${values.commit}</code></footer>`;
  const html = readFileSync(index, 'utf8').replace(
    /<footer id="beads-deployment-source">.*?<\/footer>\n?/s,
    '',
  );
  if (!html.includes('</body>')) throw Error('Tracker index has no body');
  writeFileSync(index, html.replace('</body>', `${source}\n</body>`));
  writeFileSync(
    join(directory, 'deploy-source.json'),
    JSON.stringify({ commit: values.commit, branch: values.branch }) + '\n',
  );
  const assets = assetsIn(directory),
    manifest = Object.fromEntries(assets.map((asset) => [asset.name, asset.hash]));
  const args = deploymentArgs({ ...values, manifest });
  if (values.publish)
    await uploadAssets(assets, {
      project: values.project,
      account: process.env.CLOUDFLARE_ACCOUNT_ID,
      token: process.env.CLOUDFLARE_API_TOKEN,
    });
  const child = spawnSync(join(REPO, 'node_modules/.bin/cf'), args, {
    encoding: 'utf8',
    env: process.env,
    maxBuffer: 8 * 1024 * 1024,
  });
  process.stdout.write(child.stdout ?? '');
  process.stderr.write(child.stderr ?? '');
  if (child.error || child.status !== 0)
    throw child.error ?? Error(`cf deployment failed: ${child.status}`);
  console.log(
    JSON.stringify({
      project: values.project,
      branch: values.branch,
      commit: values.commit,
      assets: assets.length,
      bytes: assets.reduce((n, asset) => n + asset.bytes, 0),
      published: values.publish,
    }),
  );
}
if (process.argv[1] === fileURLToPath(import.meta.url))
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
