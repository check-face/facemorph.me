#!/usr/bin/env node
// fm-p7v: read-only scan of GitHub Releases for native installers and updater manifests.
// Produces the JSON the native retirement table (inventory/native-retirement.json) records.
// Reads the same release data `gh release list/view` reads, over the REST API, so it runs
// anywhere (GITHUB_TOKEN is optional; it only raises the rate limit). Makes no changes.
//   node scripts/inventory/native-releases.mjs [repo ...]   (default: both FaceMorph repos)
// Output: one JSON document {scanned_at, repos: [{repo, releases: [...], native_releases: n}]}.

const DEFAULT_REPOS = ['check-face/facemorph.me-classic', 'check-face/facemorph.me'];
// Installers and updater feed assets. A bare .zip is deliberately NOT native: the
// repository's evidence releases (control artifact, visual references) are zips.
const NATIVE_ASSET =
  /(\.(dmg|msi|exe|appimage|deb|app\.tar\.gz|sig)$|^latest\.json$|^SHA256SUMS$)/i;

export function nativeAssets(assets) {
  return (assets ?? [])
    .filter((a) => NATIVE_ASSET.test(a.name ?? ''))
    .map((a) => ({ name: a.name, size: a.size }));
}

export async function scanRepo(repo, { token, fetchImpl = fetch } = {}) {
  const headers = { accept: 'application/vnd.github+json', 'user-agent': 'facemorph-inventory' };
  if (token) headers.authorization = `Bearer ${token}`;
  const response = await fetchImpl(`https://api.github.com/repos/${repo}/releases?per_page=100`, {
    headers,
  });
  if (!response.ok) throw new Error(`${repo}: HTTP ${response.status} ${await response.text()}`);
  const releases = await response.json();
  return releases.map((r) => {
    const assets = nativeAssets(r.assets);
    return {
      tag: r.tag_name,
      name: r.name,
      published_at: r.published_at,
      url: r.html_url,
      prerelease: r.prerelease,
      draft: r.draft,
      native_assets: assets,
      carries_native: assets.length > 0,
    };
  });
}

export async function scan(repos = DEFAULT_REPOS, options = {}) {
  const out = [];
  for (const repo of repos) {
    const releases = await scanRepo(repo, options);
    out.push({
      repo,
      release_count: releases.length,
      native_releases: releases.filter((r) => r.carries_native).length,
      releases,
    });
  }
  return { scanned_at: new Date().toISOString(), repos: out };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const repos = process.argv.slice(2).length > 0 ? process.argv.slice(2) : DEFAULT_REPOS;
  scan(repos, { token: process.env.GITHUB_TOKEN })
    .then((doc) => {
      console.log(JSON.stringify(doc, null, 2));
      const problems = doc.repos.filter((r) => r.native_releases > 0);
      process.exitCode = problems.length > 0 ? 2 : 0; // 2 = native release assets exist (unexpected while retiring)
    })
    .catch((err) => {
      console.error(String(err));
      process.exit(1);
    });
}
