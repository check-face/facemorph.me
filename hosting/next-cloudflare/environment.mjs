// Public deployment bindings only; no credentials or storage identifiers enter the app bundle.
export const environments = Object.freeze({
  next: Object.freeze({
    collector: 'https://next.facemorph.me/diagnostics/events',
    origins: ['https://next.facemorph.me', 'https://facemorph.me', 'https://labs.facemorph.me', 'tauri://localhost', 'http://tauri.localhost', 'https://tauri.localhost'],
  }),
  production: Object.freeze({
    collector: 'https://facemorph.me/diagnostics/events',
    origins: ['https://facemorph.me'],
  }),
  local: Object.freeze({
    collector: 'http://127.0.0.1:8788/diagnostics/events',
    origins: ['http://localhost:5173', 'http://127.0.0.1:5173'],
  }),
});
export function collectorEnvironment(name = 'next') {
  const value = Object.hasOwn(environments, name) && environments[name];
  if (!value) throw Error('Unknown diagnostics environment');
  return value;
}
export function collectorEndpoint(hostname) {
  return (hostname === 'facemorph.me' ? environments.production : environments.next).collector;
}
