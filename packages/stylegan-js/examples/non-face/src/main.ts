// The page: `?variant=manager` (default) or `?variant=caller`, `?model=<converted model base URL>` and
// `?runtime=<runtime base URL>`. Only the chosen variant's module is imported, so the caller-loaded page never
// requests the manager. The example is also on window.nonface for scripted use; the last report on
// window.nonfaceReport.
import type { ExampleOptions, NonFaceExample } from './nonface.js';

const params = new URLSearchParams(location.search);
const variant = params.get('variant') === 'caller' ? 'caller' : 'manager';
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const out = $<HTMLPreElement>('report');
const show = (value: unknown) => {
  out.textContent = JSON.stringify(value, null, 2);
};

const options: ExampleOptions = {
  modelBase: new URL(params.get('model') ?? './afhqcat/', location.href).href,
  runtimeBase: new URL(params.get('runtime') ?? './runtime/', location.href).href,
  onLog: (line) => console.log(JSON.stringify(line)),
};
const example: NonFaceExample =
  variant === 'caller'
    ? (await import('./caller-loaded.js')).createCallerLoadedExample(options)
    : (await import('./manager-loaded.js')).createManagerLoadedExample(options);

const paint = () => {
  example.images().forEach((face, i) => {
    const canvas = $<HTMLCanvasElement>(`face-${i}`);
    canvas.width = face.width;
    canvas.height = face.height;
    canvas
      .getContext('2d')
      ?.putImageData(
        new ImageData(new Uint8ClampedArray(face.rgba), face.width, face.height),
        0,
        0,
      );
  });
};

$('variant').textContent = example.variant;
$<HTMLButtonElement>('go').addEventListener('click', async () => {
  show({ phase: 'loading' });
  const load = await example.load();
  if (!load.ok) return show(load);
  show({ load, phase: 'running' });
  const run = await example.run();
  Object.assign(window, { nonfaceReport: { load, run } });
  paint();
  show({ load, run });
});
$<HTMLButtonElement>('dispose').addEventListener('click', () => void example.dispose());
show(example.status());

Object.assign(window, { nonface: example });
