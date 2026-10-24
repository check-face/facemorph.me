#!/usr/bin/env python3
"""Record the research handover from classic (fm-zxj): one journal event and the matching round-log entry.

The handover cites the ledger snapshot (the bytes of classic's autoresearch/results.tsv imported at b2d945a, whose
SHA-256 docs/research-import/digest-list.json records) and the last journal IDs at the moment of handover: the
machine's shared lease journal (<lease dir>/runs.jsonl, from ~/.config/facemorph/lease.json or FACEMORPH_LEASE_DIR) and
classic's own relative journal (autoresearch/state/runs.jsonl in the classic checkout), if present.

It checks that the current results.tsv still begins with exactly the snapshot bytes, appends the event to the machine
journal under the same exclusive lock run.py takes, and prints the log entry (Markdown) on stdout. It never writes a
results.tsv row.
  python3 scripts/research-ledger/record-handover.py [--classic ../facemorph.me-classic] [--dry-run]
"""
import argparse, datetime, fcntl, hashlib, json, os, subprocess, sys, uuid
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]


def lease_dir():
    env = os.environ.get('FACEMORPH_LEASE_DIR')
    if env:
        return Path(env)
    config = Path.home() / '.config/facemorph/lease.json'
    return Path(json.loads(config.read_text())['stateDir'])


def last_id(journal):
    if not journal.exists():
        return None
    last = None
    for line in journal.read_text().splitlines():
        try:
            last = json.loads(line).get('id') or last
        except json.JSONDecodeError:
            continue
    return last


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--classic', type=Path, default=REPO.parent / 'facemorph.me-classic')
    ap.add_argument('--dry-run', action='store_true')
    a = ap.parse_args()
    digest = json.loads((REPO / 'docs/research-import/digest-list.json').read_text())
    entry = next(f for f in digest['files'] if f['destination'] == 'autoresearch/results.tsv')
    ledger = (REPO / 'autoresearch/results.tsv').read_bytes()
    prefix = ledger[:entry['size']]
    prefix_sha = hashlib.sha256(prefix).hexdigest()
    if prefix_sha != digest['ledger']['sha256'] or prefix_sha != entry['sha256']:
        sys.exit(f'results.tsv no longer begins with the snapshot bytes ({prefix_sha} != {entry["sha256"]})')
    journal = lease_dir() / 'runs.jsonl'
    classic_journal = a.classic / 'autoresearch/state/runs.jsonl'
    now = datetime.datetime.now(datetime.timezone.utc).replace(microsecond=0)
    event = {
        'id': f'{now.strftime("%Y%m%dT%H%M%SZ")}-handover-{uuid.uuid4().hex[:8]}',
        'event': 'research-handover', 'bead': 'fm-zxj', 'at': now.isoformat(),
        'ledger': {'path': 'autoresearch/results.tsv', 'prefixBytes': entry['size'], 'prefixSha256': prefix_sha,
                   'rowsAtSnapshot': digest['ledger']['rows'], 'rowsNow': len(ledger.decode('utf-8').splitlines()) - 1},
        'snapshot': digest['snapshot'],
        'lastJournalIds': {'machine': last_id(journal), 'machineJournal': str(journal),
                           'classic': last_id(classic_journal), 'classicJournal': str(classic_journal)},
        'monorepoCommit': subprocess.run(['git', '-C', str(REPO), 'rev-parse', 'HEAD'], capture_output=True, text=True).stdout.strip(),
        'qualification': 'not_evaluated',
    }
    if not a.dry_run:
        with journal.open('a') as f:
            fcntl.flock(f, fcntl.LOCK_EX)
            f.write(json.dumps(event) + '\n')
    ids = event['lastJournalIds']
    print(f"""### {event['at']} — {event['id']}

- Phase / status: implemented / research handed over from classic to this repository; no new round starts in classic
- Round / experiment / correction: 2026-10-24-handover / not_applicable / not_applicable
- Hypothesis / decision: research home moves here (fm-zxj); classic keeps its history read-only
- Identity: ledger `autoresearch/results.tsv` prefix of {entry['size']} bytes, SHA-256 `{prefix_sha}` ({digest['ledger']['rows']} rows), imported from classic `{digest['snapshot']['commit']}`; monorepo commit `{event['monorepoCommit']}`
- Context: last machine journal ID `{ids['machine']}` ({ids['machineJournal']}); last classic journal ID `{ids['classic']}` (classic `autoresearch/state/runs.jsonl`)
- Boundary / samples: not_applicable
- Correctness / workflow: `scripts/check-research-ledger.mjs` keeps this prefix and the header; `scripts/check-research-import.mjs` keeps the imported tree
- Resources / failures: not_applicable
- Evidence: journal event `{event['id']}` in the machine journal; classic forward pointer `autoresearch/MOVED.md`
- Conclusion / next action: the first evaluated row here cites this entry and the prefix hash in its evidence cell""")


if __name__ == '__main__':
    main()
