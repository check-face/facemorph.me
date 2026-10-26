"""Pure report observer against actual production-budget/native-worker messages; no inference replacement."""
import importlib.util
import json
from pathlib import Path
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[4]
spec = importlib.util.spec_from_file_location('ios_product_metrics', ROOT/'apps/web/scripts/next-ios-sim.py')
ios = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ios)


def observe(script):
    source = ios.ACQUISITION_METRICS + '\n' + script
    result = subprocess.run(['node', '--input-type=module'], input=source, text=True,
                            capture_output=True, check=True, timeout=15, cwd=ROOT)
    return json.loads(result.stdout)


class ProductMetricsTests(unittest.TestCase):
    def test_complete_campaign_parses_without_running_browser_apis(self):
        self.assertNotIn('__ACQUISITION_METRICS__', ios.CAMPAIGN)
        script = ios.CAMPAIGN.replace('__COLD__', 'false').replace('<script>', '').replace('</script>', '')
        subprocess.run(['node', '--check'], input=script, text=True,
                       capture_output=True, check=True, timeout=15)

    def test_absent_and_incomplete_counters_are_unknown(self):
        result = observe("""
const empty = acquisitionMetrics();
const missing = acquisitionMetrics();
const id = missing.worker('native-worker');
missing.request(id, {type:'generate'});
const partial = acquisitionMetrics();
const partialId = partial.worker('native-worker');
partial.observe(partialId, {type:'progress',stage:'asset-acquisition',loaded:3,total:8,fetched:3,fetchedTotal:8});
console.log(JSON.stringify([empty.report(),missing.report(),partial.report()]));
""")
        for row in result:
            self.assertEqual(row['status'], 'untested')
            self.assertIsNone(row['acquiredPayloadBytes'])
            self.assertIsNone(row['fetchedBodyBytes'])
            self.assertIsNone(row['completeTransferBytes'])
        for row in result[:2]:
            self.assertIsNone(row['observedPayloadBytes'])
            self.assertIsNone(row['plannedPayloadBytes'])
        self.assertEqual(result[2]['observedPayloadBytes'], 3)
        self.assertEqual(result[2]['plannedPayloadBytes'], 8)
        self.assertFalse(result[2]['budgetComplete'])

    def test_native_budget_partial_first_face_snapshot_remains_observable(self):
        result = observe("""
import {Worker} from 'node:worker_threads';
import {pathToFileURL} from 'node:url';
const moduleUrl = pathToFileURL(process.cwd()+'/apps/web/src/Next/browser/acquisition-budget.mjs').href;
const metrics = acquisitionMetrics();
const id = metrics.worker('actual-native-worker');
metrics.request(id,{type:'generate'});
const source = `
  import {parentPort,workerData} from 'node:worker_threads';
  const {createAcquisitionBudget} = await import(workerData.moduleUrl);
  const budget = createAcquisitionBudget();
  const face = {sha256:'first-face-assets',size:157442243,url:'/face'};
  const remaining = {sha256:'remaining-canary-references',size:8335853,url:'/remaining'};
  budget.planAsset([face,remaining]);
  budget.attach(values => parentPort.postMessage({type:'progress',stage:'asset-acquisition',...values}));
  await budget.probe(async () => false);
  budget.cacheEvent({status:'missing',sha256:face.sha256});
  budget.cacheEvent({status:'verified',sha256:face.sha256,bytes:face.size});
`;
await new Promise((resolve,reject) => {
  const worker = new Worker(new URL('data:text/javascript,'+encodeURIComponent(source)),{workerData:{moduleUrl}});
  worker.on('message', data => metrics.observe(id,data));
  worker.on('error',reject);
  worker.on('exit',code => code === 0 ? resolve() : reject(Error('worker exit '+code)));
});
console.log(JSON.stringify(metrics.report()));
""")
        self.assertEqual(result['status'], 'untested')
        self.assertEqual(result['observedPayloadBytes'], 157442243)
        self.assertEqual(result['plannedPayloadBytes'], 165778096)
        self.assertFalse(result['budgetComplete'])
        self.assertIsNone(result['acquiredPayloadBytes'])
        self.assertIsNone(result['completeTransferBytes'])

    def test_real_budget_messages_from_native_workers_are_not_summed_as_deltas(self):
        result = observe("""
import {Worker} from 'node:worker_threads';
import {pathToFileURL} from 'node:url';
const moduleUrl = pathToFileURL(process.cwd()+'/apps/web/src/Next/browser/acquisition-budget.mjs').href;
const metrics = acquisitionMetrics();
const individuals = [];
const workerSource = `
  import {parentPort,workerData} from 'node:worker_threads';
  const {createAcquisitionBudget} = await import(workerData.moduleUrl);
  const budget = createAcquisitionBudget();
  const a = {sha256:'a',size:11,url:'/a'}, b = {sha256:'b',size:7,url:'/b'};
  budget.planAsset([a,b]);
  budget.attach(values => parentPort.postMessage({type:'progress',stage:'asset-acquisition',...values}));
  await budget.probe(async () => workerData.warm);
  for (const asset of [a,b]) {
    if (!workerData.warm) {
      budget.cacheEvent({status:'missing',sha256:asset.sha256});
      budget.cacheEvent({status:'progress',sha256:asset.sha256,loaded:asset.size-1});
      budget.progress(true); // repeated snapshots are not additional bytes
      budget.cacheEvent({status:'progress',sha256:asset.sha256,loaded:1}); // retry resets partial read
    }
    budget.cacheEvent({status:'verified',sha256:asset.sha256,bytes:asset.size});
  }
  budget.progress(true);
`;
for (const warm of [false,true,false]) {
  const id = metrics.worker('actual-node-worker');
  metrics.request(id,{type:'initialize',provider:'wasm'});
  const individual = acquisitionMetrics();
  const individualId = individual.worker('actual-node-worker');
  individual.request(individualId,{type:'initialize',provider:'wasm'});
  await new Promise((resolve,reject) => {
    const worker = new Worker(new URL('data:text/javascript,'+encodeURIComponent(workerSource)),
      {workerData:{moduleUrl,warm}});
    worker.on('message', data => {metrics.observe(id,data);individual.observe(individualId,data);});
    worker.on('error', reject);
    worker.on('exit', code => code === 0 ? resolve() : reject(Error('worker exit '+code)));
  });
  individuals.push(individual.report());
}
console.log(JSON.stringify({combined:metrics.report(),individuals}));
""")
        warm = result['individuals'][1]
        self.assertEqual(warm['status'], 'measured')
        self.assertEqual(warm['acquiredPayloadBytes'], 0)
        result = result['combined']
        self.assertEqual(result['status'], 'measured')
        self.assertEqual(result['acquiredPayloadBytes'], 36)
        self.assertEqual(result['observedPayloadBytes'], 36)
        self.assertTrue(result['budgetComplete'])
        self.assertEqual(result['fetchedBodyBytes'], 36)
        self.assertEqual([row['latest']['fetched'] for row in result['workers']], [18, 0, 18])
        self.assertGreater(result['workers'][0]['regressions'], 0)
        self.assertTrue(all(len(row['snapshots']) <= 8 for row in result['workers']))
        self.assertIsNone(result['completeTransferBytes'])

    def test_invalid_or_overflowed_observation_cannot_claim_zero(self):
        result = observe("""
const invalid = acquisitionMetrics(), overflow = acquisitionMetrics();
const id = invalid.worker('worker');
invalid.observe(id,{type:'progress',stage:'asset-acquisition',loaded:0,total:0,fetched:-1,fetchedTotal:0});
for(let i=0;i<17;i++) overflow.worker('worker');
console.log(JSON.stringify([invalid.report(),overflow.report()]));
""")
        for row in result:
            self.assertEqual(row['status'], 'untested')
            self.assertIsNone(row['fetchedBodyBytes'])
            self.assertIsNone(row['observedPayloadBytes'])
            self.assertIsNone(row['plannedPayloadBytes'])
            self.assertFalse(row['budgetComplete'])


if __name__ == '__main__':
    unittest.main()
