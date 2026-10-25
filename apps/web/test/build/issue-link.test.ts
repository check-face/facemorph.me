import assert from 'node:assert/strict';
import test from 'node:test';
import { issueUrl } from '../../shell/links.ts';

test('issue context contains coarse classes and public identifiers, never content-bearing inputs', () => {
  const reference = '12345678-1234-1234-1234-123456789abc';
  const link = new URL(
    issueUrl({
      version: 'abcdef0',
      route: 'webgpu',
      reference,
      userAgent:
        'Mozilla/5.0 (Linux; Android) Chrome/141.0 Mobile private typed words seed=4294967295 holiday.jpg Error: private failure',
    }),
  );
  assert.equal(
    link.origin + link.pathname,
    'https://github.com/facemorph-me/facemorph.me/issues/new',
  );
  assert.equal(link.searchParams.get('device'), 'phone / Chrome');
  assert.equal(link.searchParams.get('version'), 'abcdef0');
  assert.equal(link.searchParams.get('route'), 'webgpu');
  assert.equal(link.searchParams.get('reference'), reference);
  for (const secret of ['private typed words', '4294967295', 'holiday.jpg', 'private failure']) {
    assert.ok(!decodeURIComponent(link.href).includes(secret));
    const invalid = issueUrl({
      version: secret,
      route: secret,
      reference: secret,
      userAgent: secret,
    });
    assert.ok(!decodeURIComponent(invalid).includes(secret));
  }
});
