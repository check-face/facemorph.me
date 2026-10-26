import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createFacadeShard, FACADE_SHARDS } from './facade-shards.mjs';

// Read declarations without importing the real suite, launching browsers or registering its hooks.
function declaredNames() {
  const source = readFileSync(new URL('./facade.e2e.ts', import.meta.url), 'utf8');
  const calls = [...source.matchAll(/(?:^|\n)\s*test\(/g)];
  const declarations = [...source.matchAll(/(?:^|\n)\s*test\(\s*(?:'([^']*)'|`([^`]*)`)/g)];
  assert.equal(
    declarations.length,
    calls.length,
    'each facade declaration needs an inventoried name',
  );
  return declarations.flatMap((match) => {
    if (match[1] !== undefined) return [match[1]];
    assert.equal(
      match[2],
      "operation-service: Morph ${cancelParent ? 'cancellation preserves' : 'joins'} its independently requested CPU face",
      'inventory any new generated declaration explicitly',
    );
    assert.match(source, /for \(const cancelParent of \[false, true\]\)/);
    return [
      'operation-service: Morph joins its independently requested CPU face',
      'operation-service: Morph cancellation preserves its independently requested CPU face',
    ];
  });
}

test('four disjoint shards exhaust the actual facade declarations, including generated cases', () => {
  const declarations = declaredNames();
  const inventory = Object.values(FACADE_SHARDS).flat();
  assert.equal(declarations.length, 27);
  assert.equal(new Set(inventory).size, inventory.length);
  assert.deepEqual([...inventory].sort(), [...declarations].sort());
  const included = [];
  for (const selected of ['1', '2', '3', '4']) {
    const shard = createFacadeShard(selected);
    const names = declarations.filter((name) => shard.include(name));
    shard.assertComplete();
    assert.ok(names.length > 0);
    assert.deepEqual(names, FACADE_SHARDS[selected], 'filter retains declaration order');
    included.push(...names);
  }
  assert.deepEqual(included.sort(), [...declarations].sort());
});

test('an unsharded run registers the whole original suite', () => {
  const shard = createFacadeShard();
  for (const name of declaredNames()) assert.equal(shard.include(name), true);
  shard.assertComplete();
});

test('unknown shards and unassigned declarations fail closed', () => {
  for (const invalid of ['', '0', '5', 'all', 1, null, true, {}])
    assert.throws(() => createFacadeShard(invalid), /Unknown facade shard/);
  assert.throws(
    () => createFacadeShard('1').include('a newly added test'),
    /Unassigned facade test/,
  );
});

test('duplicate declarations fail even when excluded from this shard', () => {
  const shard = createFacadeShard('1');
  const excluded = FACADE_SHARDS['2'][0];
  assert.equal(shard.include(excluded), false);
  assert.throws(() => shard.include(excluded), /Duplicate facade test declaration/);
});

test('a missing declaration in any shard fails the full inventory check', () => {
  const shard = createFacadeShard('1');
  const missing = FACADE_SHARDS['4'].at(-1);
  for (const name of declaredNames()) if (name !== missing) shard.include(name);
  assert.throws(
    () => shard.assertComplete(),
    (error) => {
      assert.match(error.message, /Missing facade test declarations/);
      assert.ok(error.message.includes(missing));
      return true;
    },
  );
});
