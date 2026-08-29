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
  assert.equal(textOf('<p>hot &amp; deep</p>'), 'hot & deep');
});

test('script bodies cannot leak into the evidence text', () => {
  // The page is attacker-controlled. A leaked script body turns JSON blobs and
  // analytics ids into quotable evidence -- the false positive this module
  // exists to prevent. HTML permits whitespace before the close bracket, and
  // an unclosed script simply runs to the end of the document.
  assert.equal(textOf('<script>hidden 42.5 here</script >tail'), 'tail');
  assert.equal(textOf('<style>.a{color:red}</style >tail'), 'tail');
  assert.equal(textOf('<script>hidden 42.5 here'), '');
  assert.equal(textOf('keep<script>hidden 42.5'), 'keep');
  assert.equal(textOf('<template>secret 9.9</template>tail'), 'tail');
  assert.equal(textOf('<noscript>secret 9.9</noscript>tail'), 'tail');
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

test('trailing zeros on an integer are the same number too', () => {
  // The integer branch must make the same concession as the decimal branch,
  // or 40 and 40.0 disagree about whether the source said 40.
  assert.equal(valueAppears(40, 'the pool is 40.0 degrees'), true);
  assert.equal(valueAppears(2000, 'entry is 2,000.00 yen'), true);
  // But only zeros. A real fraction is a different number.
  assert.equal(valueAppears(40, 'the pool is 40.5 degrees'), false);
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

test('a sign is part of the number', () => {
  // The page says minus forty. Certifying a claim of 40 against it would be
  // the worst failure this module can produce, on its highest-risk field.
  assert.equal(valueAppears(40, 'it is -40 °C'), false);
  assert.equal(valueAppears(40, 'it is −40 °C'), false);
  assert.equal(valueAppears(40, 'it is –40 °C'), false);
  // Accepted consequence: in a range, the upper bound reads as negative and is
  // rejected, while the lower bound still matches. A false negative costs a
  // claim; a false positive on temperature can burn someone.
  assert.equal(valueAppears(45, 'range 40-45 °C'), false);
  assert.equal(valueAppears(40, 'range 40-45 °C'), true);
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

test('non-finite and exponent-form numbers never match', () => {
  // "1e+21" would splice a quantifier into the pattern rather than a digit.
  assert.equal(valueAppears(1e21, 'value 1eee21 x'), false);
  assert.equal(valueAppears(1e21, 'value 1e+21 x'), false);
  assert.equal(valueAppears(Number.NaN, 'nan everywhere'), false);
  assert.equal(valueAppears(Number.POSITIVE_INFINITY, 'infinity pool'), false);
});

test('a string value matches case-insensitively', () => {
  assert.equal(valueAppears('mixed', 'Bathing is Mixed here'), true);
});

test('a string needle must be whole, tested one side at a time', () => {
  // "unmixedly" is blocked by either guard alone, so it cannot tell which one
  // works. Each of these isolates a single side.
  assert.equal(valueAppears('mixed', 'mixedly awful'), false, 'trailing guard');
  assert.equal(valueAppears('mixed', 'the unmixed pool'), false, 'leading guard');
  assert.equal(valueAppears('mixed', 'unmixedly awful'), false);
});

test('a string needle is matched literally, not as a pattern', () => {
  assert.equal(valueAppears('a.b', 'axb here'), false);
  assert.equal(valueAppears('a.b', 'a.b here'), true);
});

test('an empty needle never matches', () => {
  // The haystack must contain a non-alphanumeric boundary. Against a word like
  // "anything" an unguarded empty needle fails on its own -- every position has
  // a letter on one side -- and the test would prove nothing.
  assert.equal(valueAppears('', 'the water is 42.5 °C'), false);
  assert.equal(valueAppears('   ', 'the water is 42.5 °C'), false);
  assert.equal(valueAppears('', ' '), false);
});

/** A fetch stub that records what it was called with, if it was reached at all. */
function stubFetch(response) {
  const calls = [];
  const impl = async (url, options) => {
    calls.push({ url, options });
    if (response instanceof Error) throw response;
    return response;
  };
  return { impl, calls };
}

function okResponse(body, headers = {}) {
  const read = { count: 0 };
  const lower = Object.fromEntries(
    Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v)]),
  );
  return {
    ok: true,
    read,
    headers: { get: (name) => lower[name.toLowerCase()] ?? null },
    text: async () => {
      read.count += 1;
      return body;
    },
  };
}

const UNREACHABLE = { ok: false, outcome: 'source-unreachable' };

test('a non-http scheme never reaches the fetch', async () => {
  // This proves one narrow thing: a non-HTTP scheme cannot become a request.
  // It is NOT an SSRF test -- localhost and link-local hosts are not covered.
  for (const url of ['file:///etc/passwd', 'data:text/html,<p>42.5 °C</p>']) {
    const { impl, calls } = stubFetch(okResponse('<p>42.5 °C</p>'));
    const res = await fetchSource(url, { fetchImpl: impl });
    assert.deepEqual(res, UNREACHABLE, url);
    assert.equal(calls.length, 0, `${url} must not be fetched`);
  }
});

test('an unparseable url is unreachable', async () => {
  const { impl, calls } = stubFetch(okResponse('anything'));
  const res = await fetchSource('not a url', { fetchImpl: impl });
  assert.deepEqual(res, UNREACHABLE);
  assert.equal(calls.length, 0);
});

test('a non-ok response is unreachable', async () => {
  const { impl } = stubFetch({ ok: false, headers: { get: () => null }, text: async () => '42.5 °C' });
  assert.deepEqual(await fetchSource('https://example.com/a', { fetchImpl: impl }), UNREACHABLE);
});

test('a throwing fetch is unreachable, not an exception', async () => {
  const { impl } = stubFetch(new Error('ECONNRESET'));
  assert.deepEqual(await fetchSource('https://example.com/a', { fetchImpl: impl }), UNREACHABLE);
});

test('the timeout is wired to a signal the fetch receives', async () => {
  const { impl, calls } = stubFetch(okResponse('<p>ok</p>'));
  await fetchSource('https://example.com/a', { fetchImpl: impl, timeoutMs: 1 });
  const { options } = calls[0];
  assert.ok(options?.signal instanceof AbortSignal, 'a signal must be forwarded');
  assert.equal(options.redirect, 'follow');
  // And it must be the caller's timeout, not an unwired one.
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(options.signal.aborted, true, 'the signal must carry timeoutMs');
});

test('an abort during the body read is an outcome, not an exception', async () => {
  // The timeout covers the body stream, so on a slow server the abort lands
  // here rather than at the header exchange. Uncaught, one slow source takes
  // down the whole enrichment run.
  const failing = {
    ok: true,
    headers: { get: () => null },
    text: async () => {
      throw Object.assign(new Error('The operation was aborted'), { name: 'TimeoutError' });
    },
  };
  const { impl } = stubFetch(failing);
  assert.deepEqual(await fetchSource('https://example.com/a', { fetchImpl: impl }), UNREACHABLE);
});

test('a declared content-length over the cap is rejected before the body is read', async () => {
  const res = okResponse('<p>small</p>', { 'content-length': MAX_SOURCE_BYTES + 1 });
  const { impl } = stubFetch(res);
  assert.deepEqual(await fetchSource('https://example.com/a', { fetchImpl: impl }), UNREACHABLE);
  assert.equal(res.read.count, 0, 'the body must never be buffered');
});

test('an oversized body is rejected whole, not truncated', async () => {
  // The backstop for a missing or lying content-length. Truncation is itself
  // an injection primitive: it lets the page author choose where the evidence
  // stops.
  assert.equal(MAX_SOURCE_BYTES, 2_000_000);
  const body = `<p>42.5 °C</p>${'x'.repeat(MAX_SOURCE_BYTES)}`;
  const { impl } = stubFetch(okResponse(body));
  const out = await fetchSource('https://example.com/a', { fetchImpl: impl });
  assert.equal(out.ok, false);
  assert.equal(out.outcome, 'source-unreachable');
  assert.equal(out.text, undefined, 'no partial evidence may escape');
});

test('a body of exactly the cap is accepted', async () => {
  const { impl } = stubFetch(okResponse('x'.repeat(MAX_SOURCE_BYTES)));
  const out = await fetchSource('https://example.com/a', { fetchImpl: impl });
  assert.equal(out.ok, true, 'the cap is a maximum, not an exclusive bound');
});

test('a body within the cap comes back as stripped text', async () => {
  const { impl } = stubFetch(okResponse('<html><body><p>The spring is 42.5&nbsp;&deg;C</p><script>var x=1</script></body></html>'));
  const out = await fetchSource('https://example.com/a', { fetchImpl: impl });
  assert.equal(out.ok, true);
  assert.equal(out.text, 'The spring is 42.5 °C');
});
