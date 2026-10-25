// The page the facade harness drives (fm-pia9): the typed facade over the real candidate bridge, its runtime and
// ort-worker, bundled by Vite. Every step returns the facade's typed records; nothing here replaces bridge behaviour.
import * as f from '../../../shell/facade/bridge.ts';
import { readSession } from '../../../src/Next/last-result.mjs';
import { generationIdentity } from '../../../src/Next/browser/identity.mjs';
import { digest, openOriginals } from '../../../src/Next/browser/originals.mjs';

const progress: f.Progress[] = [];
const downloads: f.Downloads[] = [];
const invalid: string[] = [];
f.subscribe(
  (p) => progress.push(p),
  (e) => invalid.push(e.message),
);
f.subscribeDownloads(
  (d) => downloads.push(d),
  (e) => invalid.push(e.message),
);
let job = 0;

const input = (
  id: string,
  mode: f.InputMode,
  value: string,
  file: Blob | null = null,
): f.Input => ({ id, mode, value, file });
const request = (action: f.Action, target: string, inputs: f.Input[], frames = 8): f.Request => ({
  jobId: ++job,
  action,
  target,
  inputs,
  kind: 'linear',
  width: 1,
  pinch: false,
  frames,
  fps: 16,
  provider: 'cpu',
});
const settled = () => ({
  job: f.jobProgress(),
  progressEvents: progress.length,
  invalid: [...invalid],
});

const harness = {
  async face(id: string, mode: 'text' | 'seed', value: string) {
    const out = await f.execute(request('face', id, [input(id, mode, value)]));
    return { out, ...settled() };
  },
  /** Starts a face, cancels at its first progress event, then makes another face on the same lane. */
  async cancelMidRun() {
    const before = progress.length;
    const running = f.execute(request('face', 'c', [input('c', 'text', 'cancel me')]));
    const deadline = Date.now() + 120_000;
    while (progress.length === before && Date.now() < deadline)
      await new Promise((r) => setTimeout(r, 20));
    f.cancel();
    const cancelled = await running;
    const late: string[] = [];
    const after = await f.execute(request('face', 'd', [input('d', 'text', 'after cancel')]));
    if (cancelled.faces.some((x) => x.id === 'c')) late.push('the cancelled face has a result');
    return { cancelled, after, late, ...settled() };
  },
  async photo(id: string, url: string) {
    const blob = await (await fetch(url)).blob();
    const file = new File([blob], 'photo.jpg', { type: 'image/jpeg' });
    const selection = await f.selectPhoto({ id, files: [file] });
    let chosen: Blob;
    if (selection.kind === 'photo') chosen = selection.file;
    else if (selection.kind === 'crop') {
      const offer = selection.offer;
      const side = Math.min(offer.previewWidth, offer.previewHeight);
      chosen = await f.cropPhoto(
        offer.file,
        {
          left: (offer.previewWidth - side) / 2,
          top: (offer.previewHeight - side) / 2,
          width: side,
          height: side,
        },
        { previewScale: offer.scale, rotation: 0 },
      );
    } else return { selection: selection.kind };
    const out = await f.execute(request('face', id, [input(id, 'photo', 'Photo', chosen)]));
    return { selection: selection.kind, out, ...settled() };
  },
  save: (id: string) => f.saveMedia(id),
  async morph(a: string, b: string) {
    const options = request('morph', '', [input(a, 'text', a), input(b, 'text', b)], 8);
    f.rememberView(options);
    const out = await f.execute(options);
    const planned = f.plannedFrames({
      inputs: [input(a, 'text', a), input(b, 'text', b)],
      kind: 'linear',
      width: 1,
      pinch: false,
      frames: 8,
      fps: 16,
    });
    return { out, planned, ...settled() };
  },
  restore: () => f.restoreLastResult(),
  async retained() {
    const session: unknown = await readSession();
    return Boolean(
      session &&
      typeof session === 'object' &&
      'faces' in session &&
      Array.isArray(session.faces) &&
      session.faces.length > 0,
    );
  },
  async retentionFacts() {
    const field = (value: unknown, key: string): unknown =>
      value && typeof value === 'object' ? Reflect.get(value, key) : undefined;
    const session: unknown = await readSession();
    const manifest: unknown = await (await fetch('/runtime/manifest.json')).json();
    const faces: unknown = field(session, 'faces');
    const store = await openOriginals();
    const raw: unknown = await store.get('last-generated-session-v2');
    store.close();
    const rawFaces = field(raw, 'faces');
    const storage = {
      rawFaces: Array.isArray(rawFaces) ? rawFaces.length : null,
      settings: field(raw, 'settings'),
    };
    if (!Array.isArray(faces)) return { faces: null, storage };
    const checks = await Promise.all(
      faces.map(async (face: unknown) => {
        const result = field(face, 'result');
        const provenance = field(result, 'provenance');
        const kind = field(face, 'generationKind');
        return {
          id: field(face, 'id'),
          kind,
          modelMatches: field(provenance, 'modelSha256') === field(manifest, 'modelSourceSha256'),
          noiseMatches: field(provenance, 'noiseSha256') === field(manifest, 'noiseSha256'),
          generation: field(result, 'generationSha256'),
          expected: await digest(JSON.stringify(generationIdentity(manifest, kind))),
        };
      }),
    );
    return { checks, storage };
  },
  downloads: () => downloads.slice(-1)[0] ?? null,
  async reports() {
    f.setDebug(true, 'checkbox');
    await f.execute(request('face', 'r', [input('r', 'seed', '7')]));
    return {
      staged: f.stagedReportCount(),
      reference: f.reportReference(),
      answered: f.consentAnswered(),
    };
  },
  draw(id: string) {
    const canvas = document.getElementById('face') as HTMLCanvasElement;
    f.drawFace(canvas, id);
    return canvas.toDataURL().length;
  },
};
Object.assign(window, { harness, harnessReady: true });
