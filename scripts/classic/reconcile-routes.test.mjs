#!/usr/bin/env node
// fm-6bj: plain-value tests for the route reconciler (no fakes; the real run over the real
// classic + archived files is the operated check in CI and locally).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFlaskRoutes, reconcile } from './reconcile-routes.mjs';

const legacySource = `
@app.route('/status/', methods=['GET'])
def status(): pass

@app.route('/api/face/', methods=['GET'])
def image_generation(): pass

@app.route('/api/encodeimage/', methods=['POST', 'GET'])
def encodeimage(): pass
`;

test('flask route parsing keeps paths and unions methods', () => {
  const routes = parseFlaskRoutes(legacySource);
  assert.deepEqual([...routes.keys()].sort(), ['/api/encodeimage/', '/api/face/', '/status/']);
  assert.deepEqual([...routes.get('/api/encodeimage/')].sort(), ['GET', 'POST']);
  assert.deepEqual([...routes.get('/status/')], ['GET']);
});

test('an inventory route missing from the successor is a gap', () => {
  const findings = reconcile({
    inventoryRoutes: new Map([['/api/gif/', new Set(['GET'])]]),
    legacyRoutes: new Map([['/api/gif/', new Set(['GET'])]]),
    successorRoutes: new Map(),
  });
  assert.deepEqual(findings, [
    { route: '/api/gif/', methods: ['GET'], kind: 'gap', source: 'inventory' },
  ]);
});

test('a recorded drop is not a gap, and an unknown drop is stale', () => {
  const base = {
    inventoryRoutes: new Map([
      ['/api/old/', new Set(['GET'])],
      ['/api/gone/', new Set(['GET'])],
    ]),
    legacyRoutes: new Map(),
    successorRoutes: new Map(),
    drops: [{ path: '/api/gone/', reason: 'frontend-only route served by the static frontend' }],
  };
  const findings = reconcile(base);
  assert.deepEqual(findings, [
    { route: '/api/old/', methods: ['GET'], kind: 'gap', source: 'inventory' },
  ]);
  const stale = reconcile({ ...base, drops: [{ path: '/api/never-existed/', reason: 'x' }] });
  assert.ok(stale.some((f) => f.kind === 'stale-drop'));
});

test('successor additions are reported without failing, and rule converters normalize', () => {
  const findings = reconcile({
    inventoryRoutes: new Map([['/', new Set(['GET'])]]),
    legacyRoutes: new Map(),
    successorRoutes: new Map([
      ['/', new Set(['GET'])],
      ['/<rule:filename>', new Set(['GET'])],
    ]),
  });
  assert.deepEqual(findings, [
    { route: '/<rule:filename>', methods: ['GET'], kind: 'addition', source: 'successor' },
  ]);
});

test('an archived-server-only route not in the inventory is still a gap', () => {
  const findings = reconcile({
    inventoryRoutes: new Map(),
    legacyRoutes: new Map([['/api/secret/', new Set(['GET'])]]),
    successorRoutes: new Map(),
  });
  assert.deepEqual(findings, [
    { route: '/api/secret/', methods: ['GET'], kind: 'gap', source: 'archived-server' },
  ]);
});
