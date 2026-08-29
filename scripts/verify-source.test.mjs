import test from 'node:test';
import assert from 'node:assert/strict';
import { textOf, valueAppears, fetchSource, MAX_SOURCE_BYTES } from './lib/verify-source.mjs';

test('html is reduced to searchable text', () => {
  const html = '<html><head><style>.a{color:red}</style></head><body><p>The spring is 42.5&nbsp;&deg;C</p><script>var x=1</script></body></html>';
  const text = textOf(html);
  assert.match(text, /The spring is 42\.5/);
  assert.match(text, /42\.5 °C/, 'entities must be decoded, not passed through');
  assert.doesNotMatch(text, /&nbsp;|&deg;/);
  assert.doesNotMatch(text, /color:red/, 'style contents must not survive');
  assert.doesNotMatch(text, /var x/, 'script contents must not survive');
});

test('a numeric value is found regardless of formatting', () => {
  for (const body of ['water is 42.5 °C', 'water is 42,5°C', 'temp: 42.5C', 'reaches 42.5 degrees']) {
    assert.equal(valueAppears(42.5, body), true, body);
  }
});

test('trailing zeros after a decimal point are the same number', () => {
  // A source writing 42.50 has said 42.5. Rejecting it is a false negative,
  // and false negatives here look identical to fabricated citations.
  assert.equal(valueAppears(42.5, 'the pool is 42.50 °C'), true);
  assert.equal(valueAppears(42.5, 'exactly 42.500 degrees'), true);
});

test('a numeric value that is absent is reported absent', () => {
  assert.equal(valueAppears(42.5, 'the water is 38 °C and pleasant'), false);
});

test('a near-miss is not a match, on either side of the number', () => {
  // Left-side collapse: 425 contains "42.5" only if you strip punctuation.
  assert.equal(valueAppears(42.5, 'elevation 425 metres'), false);
  // Right-side extension. These are the dangerous ones, and an earlier draft
  // of this module matched all three: the decimal branch had a lookbehind but
  // no lookahead. "42,500" is not contrived -- accepting decimal commas for
  // non-English sources is exactly what makes a European thousands separator
  // collide with a temperature.
  assert.equal(valueAppears(42.5, 'a crowd of 42,500 people'), false);
  assert.equal(valueAppears(42.5, 'elevation 42.55 metres'), false);
  assert.equal(valueAppears(42.5, 'the price is 42.51 euros'), false);
  assert.equal(valueAppears(42.5, 'a crowd of 42,5001 people'), false);
});

test('a thousands separator does not hide an integer value', () => {
  // OSM prices are plain integers; sources write them grouped.
  assert.equal(valueAppears(2000, 'entry is 2,000 yen'), true);
  assert.equal(valueAppears(2000, 'entry is 2.000 yen'), true);
  assert.equal(valueAppears(2000, 'entry is 20,000 yen'), false);
});

test('an integer does not match a longer number containing it', () => {
  assert.equal(valueAppears(40, 'open until 2400 daily'), false);
  assert.equal(valueAppears(40, 'the pool is 40 degrees'), true);
});

test('a string value matches case-insensitively but must be whole', () => {
  assert.equal(valueAppears('mixed', 'Bathing is Mixed here'), true);
  assert.equal(valueAppears('mixed', 'unmixedly awful'), false);
});

test('the byte cap is a rejection, not a truncation', () => {
  // Truncation is itself an injection primitive: it lets an attacker choose
  // where the evidence stops.
  assert.equal(MAX_SOURCE_BYTES, 2_000_000);
});

/** A fetch stub that records whether it was reached at all. */
function stubFetch(response) {
  const calls = [];
  const impl = async (url) => {
    calls.push(url);
    if (response instanceof Error) throw response;
    return response;
  };
  return { impl, calls };
}

const okResponse = (body) => ({ ok: true, text: async () => body });

test('a non-http scheme is refused without the fetch ever being reached', async () => {
  // The SSRF-adjacent property is not the return value but the silence:
  // file: and data: must never become a request.
  for (const url of ['file:///etc/passwd', 'data:text/html,<p>42.5 °C</p>']) {
    const { impl, calls } = stubFetch(okResponse('<p>42.5 °C</p>'));
    const res = await fetchSource(url, { fetchImpl: impl });
    assert.equal(res.ok, false, url);
    assert.equal(res.outcome, 'source-unreachable', url);
    assert.equal(calls.length, 0, `${url} must not be fetched`);
  }
});

test('an unparseable url is unreachable', async () => {
  const { impl, calls } = stubFetch(okResponse('anything'));
  const res = await fetchSource('not a url', { fetchImpl: impl });
  assert.deepEqual(res, { ok: false, outcome: 'source-unreachable' });
  assert.equal(calls.length, 0);
});

test('a non-ok response is unreachable', async () => {
  const { impl } = stubFetch({ ok: false, text: async () => '42.5 °C' });
  const res = await fetchSource('https://example.com/a', { fetchImpl: impl });
  assert.deepEqual(res, { ok: false, outcome: 'source-unreachable' });
});

test('a throwing fetch is unreachable, not an exception', async () => {
  const { impl } = stubFetch(new Error('ECONNRESET'));
  const res = await fetchSource('https://example.com/a', { fetchImpl: impl });
  assert.deepEqual(res, { ok: false, outcome: 'source-unreachable' });
});

test('an oversized body is rejected whole, not truncated', async () => {
  const body = `<p>42.5 °C</p>${'x'.repeat(MAX_SOURCE_BYTES)}`;
  const { impl } = stubFetch(okResponse(body));
  const res = await fetchSource('https://example.com/a', { fetchImpl: impl });
  assert.equal(res.ok, false);
  assert.equal(res.outcome, 'source-unreachable');
  // No partial evidence may escape: truncation would let the page author
  // choose where the evidence stops.
  assert.equal(res.text, undefined);
});

test('a body within the cap comes back as stripped text', async () => {
  const { impl } = stubFetch(okResponse('<html><body><p>The spring is 42.5&nbsp;&deg;C</p><script>var x=1</script></body></html>'));
  const res = await fetchSource('https://example.com/a', { fetchImpl: impl });
  assert.equal(res.ok, true);
  assert.equal(res.text, 'The spring is 42.5 °C');
});
