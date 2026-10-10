import importlib.util, pathlib, unittest
spec=importlib.util.spec_from_file_location('report',pathlib.Path(__file__).with_name('analytics-report.py'));report=importlib.util.module_from_spec(spec);spec.loader.exec_module(report)
def event(name,at,**params):
    params={'page_location':'https://next.facemorph.me/','release':'abcd123','action':'face','visit_kind':'first',**params}
    return {'event_name':name,'event_timestamp':int(at*1e6),'event_params':[{'key':k,'value':{'string_value':v} if isinstance(v,str) else {'double_value':v}} for k,v in params.items()]}
class ReportTest(unittest.TestCase):
    def test_fallback_join_duplicates_unknowns_and_percentiles(self):
        finish=event('job_finish',20,attempt_id='a',route='cpu',outcome='completed',duration_ms=400)
        rows=[event('job_start',1,attempt_id='a',route='auto',cache_state='cold'),finish,finish,event('job_start',1,attempt_id='b',route='auto'),event('job_start',99999,attempt_id='c',route='auto')]
        output=report.summarize(rows,as_of=100000)['groups'];cpu=next(r for r in output if r['route']=='cpu');auto=next(r for r in output if r['route']=='auto')
        self.assertEqual(cpu['starts'],1);self.assertEqual(cpu['resolved_denominator'],1);self.assertEqual(cpu['completed_latency_ms'],{'n':1,'p50':400,'p95':400});self.assertEqual(cpu['cache_state'],'cold');self.assertEqual(auto['unknown_after_24h'],1);self.assertEqual(auto['pending_under_24h'],1)
        self.assertEqual(report.percentile(list(range(1,101)),.95),95)
    def test_first_terminal_wins_even_when_export_order_differs(self):
        rows=[event('job_finish',30,attempt_id='a',route='webgl',outcome='failed'),event('job_start',1,attempt_id='a',route='auto'),event('job_finish',20,attempt_id='a',route='cpu',outcome='completed',duration_ms=400)]
        groups=report.summarize(rows)['groups'];self.assertEqual(len(groups),1);self.assertEqual(groups[0]['route'],'cpu');self.assertEqual(groups[0]['outcomes'],{'completed':1})
    def test_other_hosts_excluded_and_empty_not_zero_latency(self):
        self.assertEqual(report.summarize([event('job_start',1,page_location='https://facemorph.me/')])['groups'],[])
        self.assertIsNone(report.percentile([], .5))
if __name__=='__main__':unittest.main()
