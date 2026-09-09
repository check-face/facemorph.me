const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const source = readFileSync(require('node:path').join(__dirname, '../src/hfTrial.js'), 'utf8').replace("import 'regenerator-runtime/runtime';", '');
const bridge = import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));

test('Fable tuple inputs reach the queue; completion resolves', async () => {
  const {generate} = await bridge;
  const calls = [];
  global.fetch = async (url, options) => {
    calls.push([url, options]);
    return calls.length === 1
      ? new Response(JSON.stringify({event_id: 'test-event'}))
      : new Response('event: heartbeat\ndata: null\n\nevent: complete\ndata: [{"ok":true}]\n\n');
  };
  await generate(['seed=42', 'value=hello']);
  assert.deepEqual(JSON.parse(calls[0][1].body).data, ['seed=42', 'value=hello']);
  assert.equal(calls[0][1].credentials, 'same-origin');
  assert.match(calls[1][0], /test-event$/);
});

test('authentication denial is shown as an error', async () => {
  const {generate} = await bridge;
  let count = 0;
  global.fetch = async () => ++count === 1
    ? new Response('{"event_id":"denied"}')
    : new Response('event: complete\ndata: [{"ok":false,"message":"Sign in first"}]\n\n');
  await assert.rejects(generate(['seed=1', 'seed=2']), /Sign in first/);
});

test('restoring a share link only requests a saved result', async () => {
  const {restore} = await bridge;
  global.fetch = async (url, options) => {
    assert.equal(options.method, undefined);
    const query = new URL(url, 'http://localhost').searchParams;
    assert.equal(query.get('first'), 'value=a&b');
    assert.equal(query.get('second'), 'seed=0');
    return new Response('{"found":true}');
  };
  assert.equal(await restore(['value=a&b', 'seed=0']), true);
});

test('local review changes only the selected demo session', async () => {
  const {demoMode} = await bridge;
  global.fetch = async (url, options) => {
    assert.equal(url, '/review/session?mode=free');
    assert.equal(options.method, 'POST');
    return new Response('{"mode":"free"}');
  };
  assert.equal(await demoMode('free'), 'free');
});
