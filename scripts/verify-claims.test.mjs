/**
 * The check the gate never had: does the page support the number?
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyClaims, summarise, isLiterallyVerifiable, VERDICT } from './lib/verify-claims.mjs';

const publicLookup = async () => [{ address: '93.184.216.34', family: 4 }];
const page = (html) => async () => ({
  ok: true,
  status: 200,
  headers: { get: () => null },
  text: async () => html,
});
const run = (overlay, fetchImpl) =>
  verifyClaims(overlay, { fetchImpl, lookup: publicLookup });

const claim = (value, extra = {}) => ({
  value,
  source: 'https://example.com/spring',
  contributor: 'agent',
  state: 'active',
  ...extra,
});

test('a temperature the page states is verified', async () => {
  const out = await run(
    { claims: { 'temperature.celsius': claim(38.5) } },
    page('<p>The pools are kept at 38.5&deg;C year round.</p>'),
  );
  assert.deepEqual(out, [{ field: 'temperature.celsius', verdict: VERDICT.VERIFIED }]);
});

test('a temperature the page does not state is refuted', async () => {
  // The defect this whole file exists for: a confident number on a real page
  // that says nothing of the kind.
  const out = await run(
    { claims: { 'temperature.celsius': claim(55) } },
    page('<p>The pools are kept at 38.5&deg;C year round.</p>'),
  );
  assert.equal(out[0].verdict, VERDICT.REFUTED);
  assert.match(out[0].detail, /value-absent-from-source/);
});

test('a fabricated citation is refuted, not excused', async () => {
  // source-not-found means the page is not there at all. That is a fact about
  // the claim, not about the network.
  const out = await run(
    { claims: { 'temperature.celsius': claim(38.5) } },
    async () => ({ ok: false, status: 404, headers: { get: () => null }, text: async () => '' }),
  );
  assert.equal(out[0].verdict, VERDICT.REFUTED);
  assert.equal(out[0].detail, 'source-not-found');
});

test('an unreachable source is undecided, never refuted', async () => {
  // A site being down says nothing about the claim. Collapsing this into
  // refutation would let an afternoon of DNS trouble write permanent, citable
  // accusations against honest contributors.
  const out = await run(
    { claims: { 'temperature.celsius': claim(38.5) } },
    async () => { throw new Error('ECONNRESET'); },
  );
  assert.equal(out[0].verdict, VERDICT.UNREACHABLE);
});

test('enum and prose fields are flagged for review, never silently passed', async () => {
  // These never appear verbatim: "textile-only" is our vocabulary, "open" is
  // our enum, and a price summary is a human rendering of a table. Matching
  // them literally would refute true claims.
  const out = await run(
    {
      claims: {
        'clothing.policy': claim('textile-only'),
        'hours.status': claim('open'),
        'access.price': claim('Adult $19.75'),
      },
    },
    page('<p>Adults $19.75. Swimsuits required. Open daily.</p>'),
  );
  assert.equal(out.length, 3);
  for (const r of out) {
    assert.equal(r.verdict, VERDICT.NEEDS_REVIEW, `${r.field} must not be auto-passed`);
  }
});

test('a retracted claim is not fetched at all', async () => {
  let called = 0;
  const out = await run(
    { claims: { 'temperature.celsius': claim(38.5, { state: 'retracted' }) } },
    async () => { called++; return page('')(); },
  );
  assert.deepEqual(out, []);
  assert.equal(called, 0, 'a withdrawn claim must not spend a fetch or risk a refutation');
});

test('isLiterallyVerifiable follows FIELD_TYPES, not a second list', async () => {
  // Driven off the type table so a new numeric field is covered the day it is
  // added. A hand-kept duplicate would silently miss it.
  assert.equal(isLiterallyVerifiable('temperature.celsius'), true);
  assert.equal(isLiterallyVerifiable('location.elevation'), true);
  assert.equal(isLiterallyVerifiable('access.price'), false);
  assert.equal(isLiterallyVerifiable('clothing.policy'), false);
  assert.equal(isLiterallyVerifiable('tags'), false);
  assert.equal(isLiterallyVerifiable('not.a.field'), false);
});

test('refutation outranks unreachability in the exit code', () => {
  // One provably wrong claim makes the submission wrong; another claim's
  // flaky host does not soften that.
  const mixed = [
    { field: 'a', verdict: VERDICT.UNREACHABLE },
    { field: 'b', verdict: VERDICT.REFUTED },
  ];
  assert.equal(summarise(mixed).code, 1);
});

test('the exit codes separate reject from retry', () => {
  assert.equal(summarise([{ verdict: VERDICT.VERIFIED }]).code, 0);
  assert.equal(summarise([{ verdict: VERDICT.NEEDS_REVIEW }]).code, 0);
  assert.equal(summarise([{ verdict: VERDICT.UNREACHABLE }]).code, 2);
  assert.equal(summarise([{ verdict: VERDICT.REFUTED }]).code, 1);
  // Distinct codes matter: a workflow must never be able to retry a
  // refutation into a pass.
  assert.notEqual(summarise([{ verdict: VERDICT.REFUTED }]).code,
                  summarise([{ verdict: VERDICT.UNREACHABLE }]).code);
});

test('counts are reported per verdict', () => {
  const { counts } = summarise([
    { verdict: VERDICT.VERIFIED }, { verdict: VERDICT.VERIFIED },
    { verdict: VERDICT.REFUTED }, { verdict: VERDICT.NEEDS_REVIEW },
    { verdict: VERDICT.UNREACHABLE },
  ]);
  assert.deepEqual(counts, { refuted: 1, unreachable: 1, needsReview: 1, verified: 2 });
});

test('a source pointing at the metadata endpoint is refuted, not fetched', async () => {
  // The SSRF guard and the claim verifier meet here: a hostile citation is a
  // malformed source, which is a fact about the claim.
  let called = 0;
  const out = await verifyClaims(
    { claims: { 'temperature.celsius': claim(38.5, { source: 'http://169.254.169.254/' }) } },
    { fetchImpl: async () => { called++; return page('38.5')(); }, lookup: publicLookup },
  );
  assert.equal(out[0].verdict, VERDICT.REFUTED);
  assert.equal(called, 0, 'the request must never be made');
});
