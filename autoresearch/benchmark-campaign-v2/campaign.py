"""Versioned plans and evidence inventory. Never runs or certifies missing implementations."""
import argparse
import hashlib
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
PHOTO_STAGES = ['decode_alignment', 'e4e', 'reconstruction1024', 'original_cache', 'repeat', 'failure_recovery']
STAGES = ['assetAcquisition', 'runtimeInitialization', 'modelInitialization', 'decodeAlignment',
          'encoder', 'mapping', 'synthesis', 'readback', 'originalCache', 'videoEncode', 'videoDecodePlayback', 'wholeWorkflow']

def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def read(path):
    return json.loads(path.read_text())

def portfolios():
    result = []
    for path in [ROOT/'autoresearch/candidates/synthesis-research-v2/candidates.json', ROOT/'autoresearch/candidates/e4e-research-v2/candidates.json']:
        obj = read(path)
        rows = obj if isinstance(obj, list) else obj['candidates']
        for item in rows:
            for key in ['id','workload','implementationStatus','hypothesis','control','proposedChange','targetLanes','requiredEvidence','priority']:
                if not item.get(key):
                    raise ValueError(f'{path.name}: {item.get("id")} missing {key}')
            if item['workload'] not in ['synthesis','e4e']:
                raise ValueError('Unknown workload')
            result.append({**item, 'portfolio':str(path.relative_to(ROOT)), 'portfolioSha256':sha(path)})
    ids=[c['id'] for c in result]
    if len(ids)!=len(set(ids)): raise ValueError('Duplicate candidate ID')
    return result

def plan():
    contract = read(HERE/'contract.json')
    candidates = portfolios()
    return {'campaignVersion':contract['version'], 'contractSha256':sha(HERE/'contract.json'),
            'scope':'Research plan; no experiment execution or qualification implied',
            'candidates':candidates,
            'matrix':[{'candidateId':c['id'], 'targetId':t['id'],
                       'workloads':contract['workloadSets'][c['workload']],
                       'status':'planned-unexecuted', 'prerequisites':['exact implementation and asset hashes','target capability and resource checks','unchanged correctness fixtures'],
                       'sameDeviceControl':c['control']}
                      for c in candidates for t in contract['targets'] if set(t['lanes']) & set(c['targetLanes'])]}

def finite_ms(value):
    return value if type(value) in [int,float] and math.isfinite(value) and value>=0 else None

def inventory_report(path):
    """Retain observed facts only. Unknown environment/cache/stages remain unknown."""
    doc=read(path)
    rows=doc.get('results')
    if rows is None: rows=doc.get('rows')
    if not isinstance(rows,list): rows=[doc]
    env=doc.get('executionEnvironment')
    if isinstance(env,dict): env=env.get('kind')
    # A label/user agent never establishes physical hardware provenance.
    env=env or 'unclassified'
    result=[]
    for index,row in enumerate(rows):
        if not isinstance(row,dict): continue
        checks=row.get('checks',row.get('rows',[]))
        if not isinstance(checks,list):checks=[]
        actual_photo = row.get('e4eExecuted') is True or doc.get('e4eExecuted') is True
        stage_evidence=row.get('stages',doc.get('stages',{}))
        if not isinstance(stage_evidence,dict):stage_evidence={}
        # Declared stages are an inventory, not an independent correctness oracle.
        photo_stage_observations={stage:stage_evidence.get(stage) for stage in PHOTO_STAGES}
        numeric_checks=[c for c in checks if isinstance(c,dict) and 'passed' in c]
        stats=row.get('hybridStats',{})
        metrics={'singleInferenceMs':finite_ms(row.get('singleMedianMs',row.get('medianInferenceMs'))),
                 'sequenceMsPerFace':finite_ms(row.get('msPerFace')),
                 'reportedLoadMs':finite_ms(row.get('loadMs')),
                 'reportedEncodeMs':finite_ms(row.get('encodeMs')),
                 'reportedDecodeMs':finite_ms(row.get('decodeMs'))}
        missing=[]
        if env=='unclassified':missing.append('execution environment unclassified')
        if row.get('completed') is not True or row.get('error'):missing.append('row incomplete or failed')
        if any(c.get('passed') is not True for c in numeric_checks):missing.append('failed correctness case')
        if not doc.get('metricsVersion') and not row.get('metricsVersion'):missing.append('legacy metric scopes; not a v2 benchmark')
        if not row.get('stageTimings') and not doc.get('startup'):missing.append('complete stage timing unavailable')
        result.append({'rawArtifact':str(path.relative_to(ROOT)) if path.is_relative_to(ROOT) else path.name,
                       'rawSha256':sha(path),'runId':doc.get('runId'), 'rowId':row.get('id',row.get('variant',str(index))),
                       'environment':env,'testOnly':doc.get('test') is True,'recoveredFromRunId':doc.get('recoveredFromRunId'),
                       'completed':row.get('completed') is True, 'error':row.get('error'),
                       'observedPassingChecks':sum(c.get('passed') is True for c in numeric_checks),
                       'observedFailedChecks':sum(c.get('passed') is False for c in numeric_checks),
                       'e4eExecutionDeclared':actual_photo,'photoStageObservations':photo_stage_observations,
                       'provider':row.get('provider'), 'encoderProvider':row.get('encoderProvider',doc.get('encoderProvider')),
                       'synthesisProvider':row.get('synthesisProvider',stats.get('gpuProvider')),
                       'metrics':metrics,'stageTimings':row.get('stageTimings'),
                       'memory':{'accountedPeakBytes':stats.get('managedPeakAccountedBytes'),
                                 'accountedBudgetBytes':stats.get('managedBudgetBytes'),'physicalPeakBytes':None,
                                 'scope':stats.get('memoryScope','not measured by this adapter')},
                       'speedRankingEligible':False,'releaseQualified':False,'gaps':missing,
                       'interpretation':'Evidence inventory only; no implicit cross-device pairing, CPU/GPU certification, cold-load claim or photo qualification'})
    return result

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    sub=parser.add_subparsers(dest='command',required=True)
    p=sub.add_parser('plan');p.add_argument('--output',type=Path,required=True)
    p=sub.add_parser('inventory');p.add_argument('--reports',type=Path,required=True);p.add_argument('--output',type=Path,required=True)
    args=parser.parse_args()
    if args.command=='plan': data=plan()
    else:
        rows=[]
        paths=sorted(args.reports.glob('*.json')) if args.reports.is_dir() else [args.reports]
        for path in paths:
            if path.stem in ['summary','coverage','readiness']:continue
            doc=read(path)
            if not isinstance(doc,dict) or not doc.get('runId'):continue
            rows.extend(inventory_report(path))
        data={'campaignVersion':'benchmark-campaign-v2','scope':'Observed historical facts; missing metrics remain unknown','rows':rows}
    args.output.parent.mkdir(parents=True,exist_ok=True)
    args.output.write_text(json.dumps(data,indent=2,allow_nan=False)+'\n')
    print(args.output)
if __name__=='__main__':main()
