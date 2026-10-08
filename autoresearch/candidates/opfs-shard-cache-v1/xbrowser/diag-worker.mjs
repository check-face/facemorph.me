// Which OPFS step an engine refuses: one line per step, from a dedicated worker.
const log = [];
const tryStep = async (name, fn) => { try { const v = await fn(); log.push([name, 'ok', v === undefined ? '' : String(v)]); return v; } catch (e) { log.push([name, 'throw', `${e?.name}: ${e?.message}`]); } };
const root = await tryStep('getDirectory', () => navigator.storage.getDirectory());
const dir = root && await tryStep('getDirectoryHandle', () => root.getDirectoryHandle('diag', { create: true }));
const fh = dir && await tryStep('getFileHandle', () => dir.getFileHandle('x', { create: true }));
if (fh) {
  log.push(['has createWritable', typeof fh.createWritable, ''], ['has createSyncAccessHandle', typeof fh.createSyncAccessHandle, '']);
  if (fh.createWritable) await tryStep('createWritable+write+close', async () => { const w = await fh.createWritable(); await w.write(new Uint8Array([1, 2, 3])); await w.close(); });
  await tryStep('sync write', async () => { const s = await fh.createSyncAccessHandle(); s.truncate(0); const n = s.write(new Uint8Array([1, 2, 3, 4]), { at: 0 }); s.flush(); s.close(); return n; });
  await tryStep('getFile size', async () => (await fh.getFile()).size);
  await tryStep('slice read', async () => new Uint8Array(await (await fh.getFile()).slice(0, 2).arrayBuffer()).join(','));
  await tryStep('removeEntry', () => dir.removeEntry('x'));
}
await tryStep('subtle', () => typeof crypto.subtle?.digest);
postMessage(log);
