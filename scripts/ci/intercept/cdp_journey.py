# browser-harness script (fm-o8xn): the interception fixture journey through the CDP helper. Runs inside
# browser-harness (cdp, drain_events, new_tab, goto_url, js, click_at_xy and capture_screenshot are its globals).
# Env: FIXTURE (the fixture's JSON line), EARLY ('1' for the model-before-approval variant), LOG_DIR.
# Prints one line {"record": ..., "verdicts": [...], "shot": ...}.
import json
import os
import sys
import time

sys.path.insert(0, os.environ['INTERCEPT_DIR'])
import intercept  # noqa: E402
from browser_harness.helpers import _send  # noqa: E402  (the active page session)

fixture = json.loads(os.environ['FIXTURE'])
early = os.environ.get('EARLY') == '1'
log_dir = os.environ['LOG_DIR']

new_tab('about:blank')
session = _send({'meta': 'session'}).get('session_id')
att = intercept.attach_cdp(cdp, drain_events, fixture['hostMap'], page_session=session,
                           page_target=current_tab()['targetId'])


def until_title(title, timeout=30):
    end = time.time() + timeout
    while time.time() < end:
        att.collect()
        # Target metadata comes from the browser process. Runtime.evaluate can
        # itself wait for the navigating renderer while workers need collect().
        if current_tab()['title'].removeprefix('🐴 ') == title:
            return True
        time.sleep(0.1)
    raise RuntimeError('timeout waiting for page title ' + title)


intercept.step(att.rec, 'load')
# Workers pause until collect() enables their domains and resumes them. A blocking
# Page.navigate can wait on those same workers before returning, leaving nobody to
# drain their attach events. Schedule real navigation, then keep draining below.
url = fixture['early'] if early else fixture['page']
js(f'setTimeout(() => location.assign({json.dumps(url)}), 0); 0')
until_title('ready')
intercept.step(att.rec, 'approve')
js("document.getElementById('approve').click()")
until_title('approved')
att.settled()
log = intercept.file_log(os.path.join(log_dir, f"cdp-{'early' if early else 'approved'}.jsonl"))
verdicts = [
    intercept.assertNoRequests(att.rec, 'model-host', {'toStep': 'load'}, log),
    intercept.assertOrder(att.rec, {'step': 'approve'}, {'hostClass': 'model-host'}, log),
    intercept.bytesBy(att.rec, 'model-host', {'fromStep': 'approve'}, log),
    intercept.requestsIn(att.rec, {'hostClass': 'app', 'fromCache': True}, log),
    intercept.assertNoRequests(att.rec, 'model-host', {'fromStep': 'consent'}, log),
]
shot = intercept.keep_on_failure(verdicts, capture_screenshot, os.path.join(log_dir, 'early' if early else 'approved'))
print(json.dumps({'record': att.rec, 'verdicts': [{k: v for k, v in x.items() if k != 'requests'} for x in verdicts],
                  'shot': shot}))
