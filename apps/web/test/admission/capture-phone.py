#!/usr/bin/env python3
"""Captures a capability record from Chrome on the lab phone (fm-4umi), through the device lab's own Phone (CDP over
adb) under its lab lock and the phone's device lease, with the same probe as the desktop captures (probe.js).
  uv run --with playwright python apps/web/test/admission/capture-phone.py <out.json>"""
import json, re, sys
from datetime import date
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[3] / 'tools' / 'device-lab'))
import lab  # noqa: E402
from playwright.sync_api import sync_playwright  # noqa: E402

out = Path(sys.argv[1])
probe = re.sub(r'^//.*\n', '', (HERE / 'probe.js').read_text(), flags=re.M).replace('export default ', '', 1).strip().rstrip(';')
HEADERS = {'cross-origin-opener-policy': 'same-origin', 'cross-origin-embedder-policy': 'require-corp'}
with lab.lab_lock(['phone-cpu']), sync_playwright() as pw:
    phone = lab.Phone(pw)
    phone.page.route('https://caps.test/**', lambda r: r.fulfill(status=200, content_type='text/html', headers=HEADERS, body='<!doctype html><title>caps</title>'))
    phone.page.goto('https://caps.test/')
    record = phone.page.evaluate(f'({probe})()')
    version = phone.browser.version
    phone.page.close()
doc = {'captured': date.today().isoformat(), 'machine': 'lab phone (Huawei P30 Pro, USB)', 'browser': f'Chrome {version}',
       'note': 'userAgent is recorded for provenance only; admission never reads it', 'record': record}
out.write_text(json.dumps(doc, indent=2) + '\n')
print(json.dumps({'webgpu': record['webgpu'] if isinstance(record['webgpu'], str) else ('adapter' if record['webgpu']['adapter'] else 'null'), 'wasm': record['wasm'], 'deviceMemoryGiB': record['deviceMemoryGiB'], 'video': record['videoEncoder']}))
