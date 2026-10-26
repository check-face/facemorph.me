// The page side of the caller-loaded example: buttons for load, run, abort and dispose, a progress bar, the three
// faces on canvases and a log. `?runtime=<url>` names the runtime directory (default ./runtime/), `?route=webgpu`
// the WebGPU route. The demo is also on window.demo for scripted use.
import { createCallerLoadedDemo, type Face, type LogLine, type Settled } from './caller-loaded.js';

const params = new URLSearchParams(location.search);
const route = params.get('route') === 'webgpu' ? 'webgpu' : 'cpu';
const logLines: LogLine[] = [];
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const out = $<HTMLPreElement>('log');
const bar = $<HTMLProgressElement>('progress');
const say = (line: LogLine) => {
  logLines.push(line);
  console.log(JSON.stringify(line));
  out.textContent = `${JSON.stringify(line)}\n${out.textContent ?? ''}`.slice(0, 20000);
};

const demo = createCallerLoadedDemo({
  runtimeBase: new URL(params.get('runtime') ?? './runtime/', location.href).href,
  route,
  onLog: say,
});
let controller: AbortController | null = null;
const onProgress = (p: { phase: string; bytes: number }) => {
  bar.removeAttribute('value');
  $('phase').textContent = `${p.phase}: ${(p.bytes / 1048576).toFixed(1)} MiB read`;
};
const paint = (id: string, s: Settled<Face>) => {
  if (s.status !== 'completed') return say({ event: 'not-drawn', id, status: s.status });
  const canvas = $<HTMLCanvasElement>(id);
  canvas.width = s.value.width;
  canvas.height = s.value.height;
  const rgba = new Uint8ClampedArray(s.value.rgba);
  canvas.getContext('2d')!.putImageData(new ImageData(rgba, s.value.width, s.value.height), 0, 0);
};

$('load').addEventListener('click', async () => {
  controller = new AbortController();
  const r = await demo.load({ signal: controller.signal, onProgress });
  bar.value = 1;
  say({
    event: 'load-result',
    ok: r.ok,
    ...(r.ok ? { provider: r.report.provider } : { error: r.error }),
  });
});
$('run').addEventListener('click', async () => {
  controller = new AbortController();
  const r = await demo.run({ signal: controller.signal, onProgress });
  paint('face-a', r.faceA);
  paint('face-b', r.faceB);
  paint('face-mid', r.interpolated);
  bar.value = 1;
});
$('abort').addEventListener('click', () => controller?.abort());
$('dispose').addEventListener('click', () => void demo.dispose());
$('status').textContent = JSON.stringify(demo.status());

Object.assign(window, { demo, demoLog: logLines });
