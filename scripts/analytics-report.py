#!/usr/bin/env python3
"""Offline release dashboard from a GA4 BigQuery JSON/JSONL export. No network or IDs in output."""
import argparse, collections, datetime, html, json, math
from pathlib import Path

def percentile(values, fraction):
    values=sorted(v for v in values if isinstance(v,(int,float)) and math.isfinite(v) and v>=0)
    return values[max(0,math.ceil(len(values)*fraction)-1)] if values else None

def parameters(event):
    result={}
    for parameter in event.get('event_params',[]):
        value=parameter.get('value',{})
        result[parameter['key']]=next((value[k] for k in ('string_value','int_value','double_value','float_value') if value.get(k) is not None),None)
    return result

def summarize(events,as_of=None):
    rows=[]
    for event in events:
        p=parameters(event)
        if str(p.get('page_location','')).split('/')[2:3]!=['next.facemorph.me']:continue
        rows.append((int(event['event_timestamp'])/1e6,event['event_name'],p))
    as_of=as_of if as_of is not None else max((row[0] for row in rows),default=0)
    # Join across route transitions and preserve the start's cache context. Fallback must
    # not turn a resolved request into an apparent unknown start in the 'auto' bucket.
    start_context={p['attempt_id']:p for _,name,p in rows if name=='job_start' and p.get('attempt_id')}
    finish_context={p['attempt_id']:p for _,name,p in rows if name=='job_finish' and p.get('attempt_id')}
    groups=collections.defaultdict(list)
    for timestamp,name,p in rows:
        if name in ('job_start','job_finish') and p.get('attempt_id'):
            p={**start_context.get(p['attempt_id'],{}),**p,**finish_context.get(p['attempt_id'],{})}
        key=tuple(str(p.get(k,'unknown')) for k in ('release','action','visit_kind','cache_state','route'))
        groups[key].append((timestamp,name,p))
    output=[]
    for key,observations in sorted(groups.items()):
        starts={};finishes={};durations=[];other=collections.Counter();operations=collections.Counter();milestones=collections.defaultdict(list)
        for timestamp,name,p in observations:
            attempt=p.get('attempt_id')
            if name=='job_start' and attempt:starts.setdefault(attempt,timestamp)
            if name=='job_finish' and attempt:finishes.setdefault(attempt,p)
            if name=='job_finish' and not attempt:other['unjoinable_terminals']+=1
            if name=='operation_result':operations[f"{p.get('operation','unknown')}:{p.get('outcome','unknown')}"]+=1
            if name=='visit_milestone':milestones[p.get('milestone','unknown')].append(p.get('duration_ms'))
        outcomes=collections.Counter(p.get('outcome','unknown') for p in finishes.values())
        for p in finishes.values():
            if p.get('outcome')=='completed':durations.append(p.get('duration_ms'))
        resolved=outcomes['completed']+outcomes['failed']
        unresolved=sum(1 for attempt,timestamp in starts.items() if attempt not in finishes and as_of-timestamp>=86400)
        pending=sum(1 for attempt,timestamp in starts.items() if attempt not in finishes and as_of-timestamp<86400)
        output.append(dict(zip(('release','action','visit_kind','cache_state','route'),key))|{
            'starts':len(starts),'outcomes':dict(outcomes),'unknown_after_24h':unresolved,'pending_under_24h':pending,
            'terminals_without_start':sum(attempt not in starts for attempt in finishes),
            'failure_numerator':outcomes['failed'],'resolved_denominator':resolved,'failure_rate':outcomes['failed']/resolved if resolved else None,
            'completed_latency_ms':{'n':sum(isinstance(v,(int,float)) for v in durations),'p50':percentile(durations,.5),'p95':percentile(durations,.95)},
            'operations':dict(operations),'milestones':{name:{'n':len(values),'p50':percentile(values,.5),'p95':percentile(values,.95)} for name,values in milestones.items()},**other})
    return {'hostname':'next.facemorph.me','as_of_seconds':as_of,'unknown_expiry_hours':24,'percentile_method':'nearest-rank','groups':output}

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('input',type=Path);p.add_argument('--output',type=Path,required=True);p.add_argument('--as-of',type=float);a=p.parse_args()
    source=a.input.read_text();events=json.loads(source) if source.lstrip().startswith('[') else [json.loads(line) for line in source.splitlines() if line.strip()]
    report=summarize(events,a.as_of);a.output.mkdir(parents=True,exist_ok=True)
    (a.output/'report.json').write_text(json.dumps(report,indent=2)+'\n')
    heading='<h1>Candidate reliability and latency</h1><p>GA observed traffic only. Unknown starts expire after 24 hours. Nearest-rank percentiles; cancelled/interrupted requests remain separate. No user identifiers in this report.</p>'
    body='<table><thead><tr><th>Release / action / visit / cache / route</th><th>Failed / resolved</th><th>Unknown / pending</th><th>Completed latency n / p50 / p95 ms</th><th>Outcomes</th></tr></thead><tbody>'
    for row in report['groups']:
        label=' / '.join(row[k] for k in ('release','action','visit_kind','cache_state','route'));latency=row['completed_latency_ms']
        cells=[label,f"{row['failure_numerator']} / {row['resolved_denominator']}",f"{row['unknown_after_24h']} / {row['pending_under_24h']}",f"{latency['n']} / {latency['p50']} / {latency['p95']}",json.dumps(row['outcomes'])]
        body+='<tr>'+''.join('<td>'+html.escape(str(cell))+'</td>' for cell in cells)+'</tr>'
    (a.output/'index.html').write_text('<!doctype html><meta charset="utf-8"><title>Candidate analytics</title><style>body{font:16px system-ui;margin:2rem}table{border-collapse:collapse}td,th{padding:.6rem;border:1px solid #bbb;text-align:left}</style>'+heading+body+'</tbody></table>')

if __name__=='__main__':main()
