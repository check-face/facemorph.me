#!/usr/bin/env python3
"""Operator evidence snapshot: one static page with what is happening and where the proof lives.

Collects, read-only, from what already exists:
- beads: status/label counts and the most recently updated beads (.beads/issues.jsonl);
- CI: the last main.yml runs with status and wall clock (gh api);
- device lab: the newest tools/device-lab/out/<ts>-<label> run — summary, journey durations and
  the per-cell last-state screenshots;
- pointers to the authoritative surfaces (beads.dilger.dev, GitHub Actions, the evidence map).

Output: <out>/index.html plus copied screenshots. --publish deploys it with the cf CLI to a
Cloudflare Pages project (put it behind Cloudflare Access, like beads.dilger.dev). Run it from a
timer on eris and after lab runs; it never mutates what it reads.
"""
import argparse, json, shutil, subprocess, sys, time
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
LAB_OUT = REPO / 'tools' / 'device-lab' / 'out'
ISSUES = REPO / '.beads' / 'issues.jsonl'
WATCH = ('reopened', 'lab-pending', 'gate', 'in_progress')


def beads():
    counts, watch, recent = {}, {w: 0 for w in WATCH}, []
    if not ISSUES.exists():
        return counts, watch, recent
    for line in ISSUES.read_text(errors='replace').splitlines():
        try:
            b = json.loads(line)
        except Exception:
            continue
        if 'id' not in b:
            continue
        s = b.get('status', '?')
        counts[s] = counts.get(s, 0) + 1
        for w in WATCH:
            if w in (b.get('labels') or []) or (w == 'in_progress' and s == 'in_progress'):
                watch[w] += 1
        if s == 'closed':
            recent.append((b.get('updated_at', ''), b['id'], b.get('title', '')))
    recent.sort(reverse=True)
    return counts, watch, recent[:12]


def ci_runs():
    try:
        out = subprocess.run(
            ['gh', 'api', 'repos/check-face/facemorph.me/actions/workflows/main.yml/runs?per_page=10'],
            capture_output=True, text=True, check=True, timeout=30).stdout
        runs = json.loads(out).get('workflow_runs', [])
    except Exception as e:
        return [], str(e)
    rows = []
    for r in runs:
        started = datetime.fromisoformat(r['run_started_at'].replace('Z', '+00:00')) if r.get('run_started_at') else None
        ended = datetime.fromisoformat(r['updated_at'].replace('Z', '+00:00')) if r.get('updated_at') else None
        mins = round((ended - started).total_seconds() / 60, 1) if started and ended else None
        rows.append({'status': r.get('status'), 'conclusion': r.get('conclusion'),
                     'minutes': mins, 'sha': (r.get('head_sha') or '')[:7],
                     'url': r.get('html_url'), 'created': r.get('created_at', '')[:16]})
    return rows, None


def latest_lab(out_dir):
    runs = sorted((d for d in LAB_OUT.iterdir() if d.is_dir()), key=lambda p: p.name, reverse=True) if LAB_OUT.exists() else []
    for run in runs:
        summary = run / 'summary.md'
        report = run / 'report.json'
        if not (summary.exists() or report.exists()):
            continue
        shots = []
        for png in sorted(run.glob('*.png')):
            rel = f"assets/{run.name}-{png.name}"
            shutil.copy2(png, out_dir / rel)
            shots.append({'cell': png.stem, 'file': rel})
        journeys = None
        if report.exists():
            try:
                journeys = json.loads(report.read_text(errors='replace'))
            except Exception:
                journeys = None
        return {'run': run.name, 'summary': summary.read_text(errors='replace') if summary.exists() else '',
                'shots': shots, 'report': journeys}
    return None


def html(beads_counts, watch, recent, runs, ci_err, lab, stamp):
    def table(rows, head):
        if not rows:
            return '<p><em>none</em></p>'
        th = ''.join(f'<th>{h}</th>' for h in head)
        trs = ''.join('<tr>' + ''.join(f'<td>{c}</td>' for c in r) + '</tr>' for r in rows)
        return f'<table><tr>{th}</tr>{trs}</table>'
    b_rows = [[s, n] for s, n in sorted(beads_counts.items())]
    w_rows = [[k, v] for k, v in watch.items()]
    r_rows = [[t[:16], f'<a href="https://beads.dilger.dev">{i}</a>', (title or '')[:70]] for t, i, title in recent]
    c_rows = [[r['created'], r['status'], r['conclusion'] or '', r['minutes'] if r['minutes'] is not None else '',
               f'<a href="{r["url"]}">{r["sha"]}</a>' if r['url'] else r['sha']] for r in runs]
    shots = ''.join(f'<figure><img src="{s["file"]}"><figcaption>{s["cell"]}</figcaption></figure>' for s in (lab or {}).get('shots', []))
    summary = f'<pre>{(lab or {}).get("summary", "")[:4000]}</pre>' if lab else '<p><em>no device-lab run yet</em></p>'
    labname = (lab or {}).get('run', '')
    ci_note = f'<p>gh api error: {ci_err}</p>' if ci_err else ''
    return f"""<!doctype html><meta charset="utf-8"><title>FaceMorph — what is happening</title>
<style>body{{font-family:system-ui,sans-serif;margin:2rem;max-width:70rem}}table{{border-collapse:collapse;margin:.5rem 0}}
td,th{{border:1px solid #bbb;padding:.2rem .6rem;font-size:.9rem}}img{{max-width:240px;border:1px solid #bbb}}
figure{{display:inline-block;margin:.4rem;text-align:center}}h2{{margin-top:2rem}}pre{{background:#f6f6f6;padding:.6rem;overflow-x:auto}}</style>
<h1>FaceMorph — what is happening <small style="font-weight:400">{stamp}</small></h1>
<h2>Beads <small><a href="https://beads.dilger.dev">beads.dilger.dev (full tracker)</a></small></h2>
{table(b_rows, ['status', 'count'])}{table(w_rows, ['watch label', 'count'])}
<h3>Recently closed</h3>{table(r_rows, ['updated (UTC)', 'id', 'title'])}
<h2>CI — main.yml (backstop)</h2>{ci_note}{table(c_rows, ['created', 'status', 'conclusion', 'minutes', 'head'])}
<h2>Device lab — latest local run <small>{labname}</small></h2>
{shots if shots else '<p><em>no screenshots in the latest run</em></p>'}
<h3>Summary</h3>{summary}
<h2>Where evidence lives</h2>
<p>See <code>docs/evidence.md</code> in the repository — bead proof, CI artifacts, device-lab runs,
research ledgers, deploy receipts, each with its path and its phone-access route.</p>"""


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    ap.add_argument('--out', default=str(Path.home() / '.cache/facemorph-obs'))
    ap.add_argument('--publish', metavar='PROJECT', help='deploy the result with: cf pages deploy <out> --project-name PROJECT')
    a = ap.parse_args()
    out = Path(a.out)
    (out / 'assets').mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')
    counts, watch, recent = beads()
    runs, ci_err = ci_runs()
    lab = latest_lab(out)
    (out / 'snapshot.json').write_text(json.dumps(
        {'generated': stamp, 'beads': counts, 'watch': watch, 'ci_runs': runs, 'lab': lab and lab['run']}, indent=1))
    (out / 'index.html').write_text(html(counts, watch, recent, runs, ci_err, lab, stamp))
    print(f"wrote {out}/index.html ({len(recent)} closed beads, {len(runs)} CI runs, lab: {(lab or {}).get('run', 'none')})")
    if a.publish:
        subprocess.run(['cf', 'pages', 'deploy', str(out), '--project-name', a.publish], check=True)
    return 0


if __name__ == '__main__':
    sys.exit(main())
