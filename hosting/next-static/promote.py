#!/usr/bin/env python3
"""Promote retained CI bytes only after matching real-workflow qualification.

Re-homed from classic 6107f80 by fm-6fx6, and fail-closed where classic was silent:
- the research backing is read before anything else, from local inputs only: the runtime manifest must carry kernel
  provenance (file, sha256, candidateId, sourceHash) and the canonical ledger (autoresearch/results.tsv) must exist
  and hold a `keep` row for that candidate with that source hash. Classic skipped the check when the ledger was absent.
- the build run must come from this repository's build workflow (main.yml, or next-site.yml on a candidate branch)
  with its exact-artifact gates passed (artifact, compiled-ui and every qualify job), and the qualification must have
  tested the same bytes (SHA256SUMS), the same runtime and the catalogue built into the artifact.
- publishing is explicit (--publish) and goes through scripts/hosting/deploy.mjs, whose single-publisher guard
  (scripts/hosting/publish-guard.mjs) refuses a target this repository may not publish before any network call; the
  guard also runs here first, so a refused target downloads nothing. Without --publish nothing is published: the
  receipt says so and the staged tree is left in --work for inspection.
Python 3.8 compatible (triton).
"""
import argparse
import hashlib
import json
import shutil
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import webgpu_contract  # noqa: E402

REPO = HERE.parents[1]
REMOTE = 'facemorph-me/facemorph.me'
LEDGER = REPO / 'autoresearch' / 'results.tsv'
BUILD_WORKFLOWS = ('.github/workflows/main.yml', '.github/workflows/next-site.yml')
QUALIFICATION_WORKFLOW = '.github/workflows/next-e2e.yml'
KERNEL_FIELDS = ('file', 'sha256', 'candidateId', 'sourceHash')
REQUIRED_CHECKS = {'nameSeed', 'repeatOriginal', 'syntheticPhotoE4e', 'localCrop', 'morphPlayableMp4',
                   'routeRejectionNamed'}


class Refused(Exception):
    """Promotion refused: the message names the missing or differing evidence."""


def command(*args):
    return subprocess.check_output(list(args), cwd=str(REPO), text=True)


def gh_json(path):
    return json.loads(command('gh', 'api', path))


def research_backing(manifest, ledger):
    """The kernel provenance and the ledger keep row backing it, or Refused. Reads local files only."""
    kernel = manifest.get('kernel') or {}
    for field in KERNEL_FIELDS:
        if not kernel.get(field):
            raise Refused('Runtime manifest lacks kernel provenance field %r: rebuild with a research-backed kernel'
                          % field)
    if not ledger.is_file():
        raise Refused('Research ledger %s is missing: promotion needs the keep row for kernel candidate %r'
                      % (ledger, kernel['candidateId']))
    lines = ledger.read_text().splitlines()
    header = lines[0].split('\t') if lines else []
    for column in ('experiment_id', 'source_hash', 'status'):
        if column not in header:
            raise Refused('Research ledger %s has no %r column' % (ledger, column))
    rows = [dict(zip(header, line.split('\t'))) for line in lines[1:] if '\t' in line]
    keep = [r for r in rows if r.get('experiment_id') == kernel['candidateId'] and r.get('status') == 'keep']
    if not keep:
        raise Refused('Kernel candidate %r has no keep row in %s' % (kernel['candidateId'], ledger))
    if not any(r.get('source_hash') == kernel['sourceHash'] for r in keep):
        raise Refused('Kernel source hash %s... is not recorded in a keep row for %r'
                      % (kernel['sourceHash'][:12], kernel['candidateId']))
    return {k: kernel[k] for k in KERNEL_FIELDS}


def gate_jobs(jobs):
    """Refused unless artifact, compiled-ui and every qualify job of the build run passed. Pure."""
    by_name = {}
    for job in jobs:
        name = job['name']
        if name.startswith('next-site / '):
            name = name[len('next-site / '):]
        by_name.setdefault(name, []).append(job.get('conclusion'))
    qualify = [c for name, cs in by_name.items() if name == 'qualify' or name.startswith('qualify /') for c in cs]
    missing = [n for n in ('artifact', 'compiled-ui') if by_name.get(n) != ['success']]
    if missing or not qualify or any(c != 'success' for c in qualify):
        raise Refused('The build run\'s exact-artifact gates did not all pass (artifact, compiled-ui, qualify): %s'
                      % json.dumps({'artifact': by_name.get('artifact'), 'compiled-ui': by_name.get('compiled-ui'),
                                    'qualify': qualify}))


def build_run(run):
    data = gh_json('repos/%s/actions/runs/%d' % (REMOTE, run))
    head = data.get('head_repository') or {}
    if data.get('path') not in BUILD_WORKFLOWS or head.get('id') != data['repository']['id']:
        raise Refused('Run %d is not this repository\'s build workflow' % run)
    jobs = [json.loads(line) for line in command(
        'gh', 'api', '--paginate', 'repos/%s/actions/runs/%d/jobs?per_page=100' % (REMOTE, run),
        '--jq', '.jobs[] | {name, conclusion}').splitlines() if line.strip()]
    gate_jobs(jobs)
    return data


def qualification_run(run):
    data = gh_json('repos/%s/actions/runs/%d' % (REMOTE, run))
    head = data.get('head_repository') or {}
    if data.get('conclusion') != 'success' or data.get('path') != QUALIFICATION_WORKFLOW \
            or head.get('id') != data['repository']['id']:
        raise Refused('Required successful qualification run is missing')
    return data


def guard(target):
    """The single-publisher guard; local, before any network call. Raises Refused."""
    r = subprocess.run([shutil.which('node') or 'node', str(REPO / 'scripts/hosting/publish-guard.mjs'),
                        '--target', target, '--kind', 'site,mirror'], cwd=str(REPO), text=True,
                       stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    if r.returncode != 0:
        raise Refused('Publish guard refused target %r: %s' % (target, r.stdout.strip()))


def promote(a):
    manifest_path = a.runtime / 'manifest.json'
    manifest_bytes = manifest_path.read_bytes()
    manifest = json.loads(manifest_bytes)
    kernel = research_backing(manifest, a.ledger)
    # The bytes the engine actually imports must agree with that provenance (classic 20 September: the gate above
    # passed while every WebGPU device fell back to CPU after a 183 MB download). Local, before any network call.
    webgpu_contract.require(a.runtime, manifest)
    if a.publish:
        if not a.target:
            raise Refused('--publish needs --target (a name in hosting/publish-targets.json)')
        guard(a.target)
    build = build_run(a.build_run)
    # The artifact build calls the qualification as a reusable workflow, so the usual case is one run that both built
    # and qualified these bytes. A separate run is still accepted when the qualification was pointed at an earlier
    # artifact by hand.
    if a.qualification_run != a.build_run:
        qualification_run(a.qualification_run)
    work = a.work.resolve()
    work.mkdir(parents=True, exist_ok=False)
    web = work / 'web'
    proof = work / 'qualification'
    command('gh', 'run', 'download', str(a.build_run), '-R', REMOTE, '-n', 'next-site-' + build['head_sha'],
            '-D', str(web))
    command('gh', 'run', 'download', str(a.qualification_run), '-R', REMOTE, '-n',
            'next-e2e-' + str(a.qualification_run), '-D', str(proof))
    command(sys.executable, 'apps/web/scripts/verify-web-artifact.py', '--artifact', str(web), '--revision',
            build['head_sha'], '--receipt', str(work / 'web-receipt.json'))
    report = json.loads((proof / 'report.json').read_text())
    source = json.loads((proof / 'source-run.json').read_text())
    required = set(REQUIRED_CHECKS)
    # Project export and open have been hidden since 21 September (operator), so no browser can demonstrate the
    # save/reopen round trip; the qualification states which artifact it saw. A missing record still fails, and the
    # pass is required again the moment the control ships.
    project = report.get('checks', {}).get('projectSaveReopen')
    if not isinstance(project, dict):
        raise Refused('Required real-workflow evidence is missing (projectSaveReopen)')
    if project.get('shipped') is not False:
        required.add('projectSaveReopen')
    if report.get('passed') is not True or not all(
            report.get('checks', {}).get(k, {}).get('passed') is True for k in required):
        raise Refused('Required real-workflow evidence is missing')
    if source.get('id') != a.build_run or source.get('head_sha') != build['head_sha'] or \
            (proof / 'next-site-SHA256SUMS').read_bytes() != (web / 'next-site-SHA256SUMS').read_bytes():
        raise Refused('Qualification tested a different artifact')
    # The catalogue is built into the artifact. Publishing a different one would ship a names index no qualification
    # ever served. A missing built catalogue is refused too (classic skipped the comparison then).
    built_catalogue = web / 'deploy-next' / 'catalogue.json'
    if not built_catalogue.is_file() or built_catalogue.read_bytes() != a.catalogue.read_bytes():
        raise Refused('Catalogue differs from the one built into the qualified artifact')
    manifest_sha = hashlib.sha256(manifest_bytes).hexdigest()
    if manifest_sha != report.get('runtimeSha256'):
        raise Refused('Runtime differs from qualified bundle')
    receipt = {'catalogueSha256': hashlib.sha256(a.catalogue.read_bytes()).hexdigest(), 'buildRun': a.build_run,
               'qualificationRun': a.qualification_run, 'source': build['head_sha'], 'runtimeSha256': manifest_sha,
               'kernel': kernel,
               'projectFiles': ('qualified' if project.get('shipped') is not False else 'not in this artifact'),
               'published': False}
    command(sys.executable, 'hosting/next-static/stage.py', '--runtime', str(a.runtime.resolve()), '--frontend',
            str(web / 'deploy-next'), '--catalogue', str(a.catalogue.resolve()), '--output', str(work / 'public'))
    (work / 'promotion.json').write_text(json.dumps(receipt, indent=2) + '\n')
    if a.publish:
        # The deploy driver re-checks the guard, deploys the site with cf, then checks the live bytes.
        for step in ('site-deploy', 'live'):
            subprocess.run([shutil.which('node') or 'node', 'scripts/hosting/deploy.mjs', step, '--target', a.target,
                            '--public', str(work / 'public'), '--artifact', str(web), '--publish'],
                           cwd=str(REPO), check=True)
        receipt['published'] = True
        receipt['target'] = a.target
        (work / 'promotion.json').write_text(json.dumps(receipt, indent=2) + '\n')
    # Staging hard-links the runtime, so a work directory costs little, but they accumulate one per promotion.
    # Removing this run's own directory is opt-in and never touches anything else.
    if a.discard_after:
        shutil.rmtree(str(work), ignore_errors=True)
        receipt['workDiscarded'] = True
    return receipt


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    p.add_argument('--build-run', type=int, required=True)
    p.add_argument('--qualification-run', type=int, required=True)
    p.add_argument('--runtime', type=Path, required=True)
    p.add_argument('--catalogue', type=Path, required=True)
    p.add_argument('--work', type=Path, required=True)
    p.add_argument('--ledger', type=Path, default=LEDGER, help='The canonical research ledger (default %(default)s).')
    p.add_argument('--target', help='Publish target named in hosting/publish-targets.json (with --publish).')
    p.add_argument('--publish', action='store_true')
    p.add_argument('--discard-after', action='store_true',
                   help='Remove this run\'s work directory once the receipt is written.')
    a = p.parse_args(argv)
    try:
        receipt = promote(a)
    except Refused as error:
        print(json.dumps({'refused': str(error), 'published': False}))
        return 1
    print(json.dumps(receipt))
    return 0


if __name__ == '__main__':
    sys.exit(main())
