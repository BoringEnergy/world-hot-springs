/**
 * The source-URL trust boundary.
 *
 * Two jobs, and they must not drift apart: what the gate will accept as a
 * citation, and what the verifier will connect to. This suite asserts both
 * against the same function, and asserts that the gate rejects anything the
 * fetcher would refuse -- a claim accepted by one and refused by the other
 * lands in the dataset unverified, which is the hole the module exists to
 * close.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSourceUrl, isPrivateAddress, assertPublicAddress } from './lib/source-url.mjs';
import { validateOverlay } from './lib/overlay.mjs';

const ok = (u) => parseSourceUrl(u).ok;

test('a normal published source is accepted', () => {
  for (const u of [
    'https://parks.canada.ca/pn-np/ab/banff/sources-banff-springs',
    'https://www.szechenyifurdo.hu/en/prices',
    'https://example.co.uk/a?b=c#d',
  ]) {
    assert.ok(ok(u), `${u} should be accepted`);
  }
});

test('a source must be a URL, not merely a truthy string', () => {
  // This is the defect that motivated the module: `if (!claim.source)` was
  // satisfied by any non-empty string, so "yes" was a valid citation.
  for (const bad of ['yes', 'see the website', '', '   ', null, undefined, 42, {}]) {
    assert.equal(ok(bad), false, `${JSON.stringify(bad)} must be rejected`);
  }
});

test('only https is accepted', () => {
  // Over http the page that "verifies" a claim is whatever the network chose
  // to return, which makes the whole verification step theatre.
  assert.equal(ok('http://example.com/a'), false);
  assert.equal(ok('file:///etc/passwd'), false);
  assert.equal(ok('ftp://example.com/a'), false);
  assert.equal(ok('javascript:alert(1)'), false);
  assert.equal(ok('data:text/html,hi'), false);
});

test('the loopback and metadata addresses are refused structurally', () => {
  // These are the targets that make an SSRF worth attempting. They must fail
  // before DNS is consulted, so the guard does not depend on a resolver.
  for (const u of [
    'https://169.254.169.254/latest/meta-data/',
    'https://127.0.0.1/',
    'https://localhost/',
    'https://localhost.localdomain/',
    'https://[::1]/',
    'https://10.0.0.1/',
    'https://192.168.1.1/',
    'https://172.16.0.1/',
    'https://redis.internal/',
    'https://printer.local/',
  ]) {
    assert.equal(ok(u), false, `${u} must be refused`);
  }
});

test('credentials in a citation are refused', () => {
  // `https://trusted.example@evil.example/` reads as one host and addresses
  // another. Never legitimate in a published source.
  assert.equal(ok('https://user:pass@example.com/a'), false);
  assert.equal(ok('https://parks.canada.ca@evil.example/a'), false);
});

test('an IP literal is never a citation', () => {
  // Independently of the range tests: a raw address is not a source a
  // stranger can check later, and rejecting all of them means the private
  // range tests are defence in depth rather than the only line.
  assert.equal(ok('https://93.184.216.34/a'), false, 'even a public IP');
  assert.equal(ok('https://[2606:4700::1]/a'), false);
});

test('isPrivateAddress covers the v6 smuggling forms', () => {
  // ::ffff:127.0.0.1 is the standard way past a v6-unaware check.
  assert.equal(isPrivateAddress('::ffff:127.0.0.1'), true);
  assert.equal(isPrivateAddress('::ffff:169.254.169.254'), true);
  assert.equal(isPrivateAddress('::1'), true);
  assert.equal(isPrivateAddress('fe80::1'), true);
  assert.equal(isPrivateAddress('fd00::1'), true);
  assert.equal(isPrivateAddress('2606:4700::1'), false, 'a real public v6 must pass');
  assert.equal(isPrivateAddress('93.184.216.34'), false, 'a real public v4 must pass');
  assert.equal(isPrivateAddress('not-an-address'), true, 'unparseable must fail closed');
});

test('isPrivateAddress covers the v4 ranges', () => {
  for (const ip of ['0.0.0.0', '10.1.2.3', '127.0.0.1', '169.254.169.254',
    '172.16.0.1', '172.31.255.255', '192.168.0.1', '100.64.0.1', '224.0.0.1']) {
    assert.equal(isPrivateAddress(ip), true, `${ip} must be private`);
  }
  for (const ip of ['8.8.8.8', '1.1.1.1', '172.15.0.1', '172.32.0.1', '99.1.1.1']) {
    assert.equal(isPrivateAddress(ip), false, `${ip} must be public`);
  }
});

test('a public name resolving to a private address is refused', () => {
  // The rebinding shape: the name looks fine, the answer does not.
  const evil = async () => [{ address: '127.0.0.1', family: 4 }];
  return assertPublicAddress('rebind.example', { lookup: evil }).then((r) => {
    assert.equal(r.ok, false);
  });
});

test('every answer is checked, not just the first', async () => {
  // A name that resolves to both public and loopback is a rebinding setup,
  // and which one the later connection picks is not ours to decide.
  const mixed = async () => [
    { address: '93.184.216.34', family: 4 },
    { address: '127.0.0.1', family: 4 },
  ];
  const r = await assertPublicAddress('mixed.example', { lookup: mixed });
  assert.equal(r.ok, false, 'a private answer anywhere in the set must refuse');
});

test('a host that does not resolve is refused, not assumed public', async () => {
  const nx = async () => { throw new Error('ENOTFOUND'); };
  assert.equal((await assertPublicAddress('nope.example', { lookup: nx })).ok, false);
  const empty = async () => [];
  assert.equal((await assertPublicAddress('nope.example', { lookup: empty })).ok, false);
});

test('the gate rejects a claim whose source the verifier would refuse', () => {
  // The integration that matters. If validateOverlay accepted a citation
  // fetchSource then refused, the claim would land unverified -- which is
  // precisely the gap this work closes.
  const overlay = {
    id: 'whs_f9eacbbc41b0',
    claims: {
      'temperature.celsius': {
        value: 38.5,
        source: 'http://169.254.169.254/latest/meta-data/',
        contributor: 'hostile agent',
        state: 'active',
      },
    },
  };
  const errors = validateOverlay(overlay, { knownIds: new Set(['whs_f9eacbbc41b0']) });
  assert.ok(
    errors.some((e) => e.includes('temperature.celsius')),
    `the metadata endpoint must not be an acceptable citation, got ${JSON.stringify(errors)}`,
  );
});

test('the gate still accepts a well-formed claim', () => {
  // The rejection tests above all pass if validateOverlay rejects everything.
  const overlay = {
    id: 'whs_f9eacbbc41b0',
    claims: {
      'temperature.celsius': {
        value: 38.5,
        source: 'https://parks.canada.ca/pn-np/ab/banff/sources-banff-springs',
        contributor: 'HudsonR&D',
        state: 'active',
      },
    },
  };
  assert.deepEqual(
    validateOverlay(overlay, { knownIds: new Set(['whs_f9eacbbc41b0']) }),
    [],
  );
});
