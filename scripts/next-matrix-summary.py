#!/usr/bin/env python3
"""Collects the per-engine matrix reports into one table.

A row that produced no report is reported as missing, not as a pass. A stage an engine cannot
support is reported as unsupported with its reason, which is a real limitation of that row.
"""
import json
import sys
from pathlib import Path

STAGES = ['nameSeed', 'repeatOriginal', 'photoE4e', 'localCrop', 'projectSaveReopen', 'morphPlayableMp4']
REQUIRED = STAGES[:-1]


def cell(stage):
    if stage is None:
        return 'not run'
    if stage.get('passed'):
        return 'pass'
    return 'unsupported' if stage.get('unsupported') else 'FAIL'


def main(root):
    reports = sorted(Path(root).rglob('next-matrix-*.json'))
    rows, complete = [], True
    for path in reports:
        try:
            report = json.loads(path.read_text())
        except (OSError, ValueError):
            rows.append((path.name, 'unreadable', ['not run'] * len(STAGES), ''))
            complete = False
            continue
        cells = [cell(report.get('stages', {}).get(name)) for name in STAGES]
        required_ok = all(report.get('stages', {}).get(name, {}).get('passed') for name in REQUIRED)
        if not required_ok:
            complete = False
        rows.append((path.stem.replace('next-matrix-', ''), report.get('agent', '')[:80],
                     cells, report.get('error', '')))

    lines = ['# New site browser matrix', '',
             '| Row | ' + ' | '.join(STAGES) + ' | Notes |',
             '|---|' + '---|' * (len(STAGES) + 1)]
    for name, agent, cells, error in rows:
        note = error or agent
        lines.append(f'| `{name}` | ' + ' | '.join(cells) + f' | {note} |')
    if not rows:
        lines.append('| _no reports were produced_ | ' + ' | '.join(['not run'] * len(STAGES)) + ' |  |')
        complete = False
    lines += ['',
              'A row is evidence for that engine and operating system only. WebKit on Linux is the '
              'WebKit engine, not Safari on macOS or iOS. Physical-device rows are attached '
              'separately; a missing row stays missing.',
              '',
              f'**Required stages across every row: {"pass" if complete else "INCOMPLETE"}**']
    output = '\n'.join(lines) + '\n'
    Path('next-matrix-summary.md').write_text(output)
    print(output)
    return 0 if complete else 1


if __name__ == '__main__':
    sys.exit(main(sys.argv[1] if len(sys.argv) > 1 else '.'))
