import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
spec=importlib.util.spec_from_file_location('campaign',Path(__file__).with_name('campaign.py'))
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class InventoryTests(unittest.TestCase):
    def inspect(self,doc):
        with tempfile.TemporaryDirectory() as tmp:
            p=Path(tmp)/'run.json';p.write_text(json.dumps(doc));return m.inventory_report(p)
    def test_legacy_cpu_rows_retained_without_fabricating_photo_or_memory(self):
        r=self.inspect({'runId':'one','userAgent':'iPhone','results':[{'id':'cpu','completed':True,'rows':[{'passed':True}]*31,'medianInferenceMs':12}]})[0]
        self.assertEqual(r['observedPassingChecks'],31)
        self.assertEqual(r['environment'],'unclassified')
        self.assertFalse(r['e4eExecutionDeclared']);self.assertFalse(r['speedRankingEligible'])
        self.assertIsNone(r['memory']['physicalPeakBytes']);self.assertIsNone(r['metrics']['reportedLoadMs'])
    def test_precomputed_photo_case_never_counts_as_encoder(self):
        r=self.inspect({'runId':'one','executionEnvironment':{'kind':'ios-simulator'},'results':[{'id':'gpu','completed':True,'checks':[{'name':'encoded-photo','passed':True}]}]})[0]
        self.assertFalse(r['e4eExecutionDeclared']);self.assertFalse(r['releaseQualified'])
        self.assertEqual(r['environment'],'ios-simulator')
    def test_failed_row_retained_in_finished_run(self):
        r=self.inspect({'runId':'one','finished':'today','results':[{'id':'gpu','completed':False,'error':'context lost','checks':[{'passed':False}]}]})[0]
        self.assertEqual(r['observedFailedChecks'],1);self.assertIn('row incomplete or failed',r['gaps'])
    def test_actual_encoder_not_complete_photo_certificate(self):
        r=self.inspect({'runId':'one','e4eExecuted':True,'completed':True})[0]
        self.assertTrue(r['e4eExecutionDeclared']);self.assertFalse(r['releaseQualified'])
        self.assertTrue(all(v is None for v in r['photoStageObservations'].values()))
    def test_nonfinite_negative_boolean_not_timing_measurements(self):
        for v in [float('nan'),float('inf'),-1,True,'12',None]:self.assertIsNone(m.finite_ms(v))
        self.assertEqual(m.finite_ms(0),0)
    def test_native_synthesis_rows_retain_variant_and_scope(self):
        r=self.inspect({'runId':'one','metricsVersion':2,'rows':[{'variant':'control','completed':True,'checks':[{'passed':True}],'singleMedianMs':1.2}]})[0]
        self.assertEqual(r['rowId'],'control');self.assertEqual(r['metrics']['singleInferenceMs'],1.2)
        self.assertFalse(r['e4eExecutionDeclared'])
if __name__=='__main__':unittest.main()
