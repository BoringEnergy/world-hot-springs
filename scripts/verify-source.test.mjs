import test from 'node:test';
import assert from 'node:assert/strict';
import { textOf, valueAppears, fetchSource, MAX_SOURCE_BYTES , MAX_REDIRECTS } from './lib/verify-source.mjs';
import { OUTCOMES } from './lib/refutations.mjs';

/**
 * A resolver that answers "public" for every host.
 *
 * fetchSource() now resolves each hop and refuses private answers, which
 * would otherwise make this suite depend on live DNS -- and on `.example`
 * domains that are reserved never to resolve at all. Stubbing it keeps these
 * tests about fetch behaviour, which is what they are for. The guard itself
 * is exercised directly in source-url.test.mjs and by the SSRF tests below.
 */
const publicLookup = async () => [{ address: '93.184.216.34', family: 4 }];

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
  // A dash with no digit before it is a sign wherever it sits in the line.
  assert.equal(valueAppears(40, 'lows of -40 °C in winter'), false);
  assert.equal(valueAppears(40, 'sub-40 °C only'), false, 'a word before the dash is not a range');
  // Was `false` until Task 12 defect 1: the upper bound of a range read as a
  // negative. Hot spring temperatures are published as ranges more often than
  // as single values, so that rejected half of every published range.
  assert.equal(valueAppears(45, 'range 40-45 °C'), true);
  assert.equal(valueAppears(40, 'range 40-45 °C'), true);
});

test('both endpoints of a range verify, and a sign still does not', () => {
  // The four rows from the live Gamla Laugin page that exposed defect 1.
  assert.equal(valueAppears(40, 'stays at 38-40 Celsius all year'), true);
  assert.equal(valueAppears(38, 'stays at 38-40 Celsius all year'), true);
  assert.equal(valueAppears(40, 'stays at 38 to 40 Celsius'), true);
  assert.equal(valueAppears(40, 'water is -40 C'), false);

  // The other dashes a source might set a range with, each still a sign when
  // no digit precedes it.
  assert.equal(valueAppears(45, 'range 40−45 °C'), true, 'minus sign as range dash');
  assert.equal(valueAppears(45, 'range 40–45 °C'), true, 'en dash as range dash');
  assert.equal(valueAppears(45, 'from 40 to −45 °C'), false);
  assert.equal(valueAppears(45, 'from 40 to –45 °C'), false);

  // A range endpoint is still a number: the digit-boundary guards outrank the
  // range clause, or "38-405" would certify a claim of 40.
  assert.equal(valueAppears(40, 'the 38-405 series'), false);
  assert.equal(valueAppears(42.5, 'the 38-42,500 range'), false);
  // A decimal endpoint is a real published form.
  assert.equal(valueAppears(42.5, 'water is 38-42.5 °C'), true);
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

/**
 * Every failure exit of fetchSource, each driven by the narrowest stub that
 * reaches it. Named so the per-exit tests and the enum-membership test cannot
 * drift apart: if an exit stops being reachable the set assert below fires,
 * and if one is renamed the membership assert does.
 */
const FAILURE_EXITS = {
  'unparseable url': () => fetchSource('not a url', { lookup: publicLookup, fetchImpl: stubFetch(okResponse('anything')).impl }),
  'refused scheme': () => fetchSource('file:///etc/passwd', { lookup: publicLookup, fetchImpl: stubFetch(okResponse('anything')).impl }),
  'http error status': () => fetchSource('https://example.com/a', {
    fetchImpl: stubFetch({ ok: false, status: 404, headers: { get: () => null }, text: async () => 'x' }).impl,
  }),
  'network error': () => fetchSource('https://example.com/a', { lookup: publicLookup, fetchImpl: stubFetch(new Error('ECONNRESET')).impl }),
  'abort during body read': () => fetchSource('https://example.com/a', {
    fetchImpl: stubFetch({
      ok: true,
      headers: { get: () => null },
      text: async () => { throw Object.assign(new Error('The operation was aborted'), { name: 'TimeoutError' }); },
    }).impl,
  }),
  'declared length over the cap': () => fetchSource('https://example.com/a', {
    fetchImpl: stubFetch(okResponse('<p>small</p>', { 'content-length': MAX_SOURCE_BYTES + 1 })).impl,
  }),
  'body over the cap': () => fetchSource('https://example.com/a', {
    fetchImpl: stubFetch(okResponse('x'.repeat(MAX_SOURCE_BYTES + 1))).impl,
  }),
};

test('every outcome fetchSource can return is a member of the enum', async () => {
  // A typo'd outcome string is otherwise invisible until it reaches the log,
  // where it becomes an unqueryable one-off row in a public benchmark.
  const seen = new Set();
  for (const [name, run] of Object.entries(FAILURE_EXITS)) {
    const { ok, outcome } = await run();
    assert.equal(ok, false, name);
    assert.ok(OUTCOMES.has(outcome), name + ' returned ' + JSON.stringify(outcome) + ', not in OUTCOMES');
    seen.add(outcome);
  }
  // Membership alone would pass if all seven exits returned one string --
  // precisely the pre-split bug. The split itself is what is asserted here.
  assert.deepEqual([...seen].sort(), [
    'source-malformed',
    'source-not-found',
    'source-too-large',
    'source-unreachable',
  ]);
});

test('a non-http scheme never reaches the fetch, and is malformed not unreachable', async () => {
  // This proves one narrow thing: a non-HTTP scheme cannot become a request.
  // It is NOT an SSRF test -- localhost and link-local hosts are not covered.
  // The outcome must say "not a URL we will follow": a refused scheme is a
  // fact about the provider, not about the network.
  for (const url of ['file:///etc/passwd', 'data:text/html,<p>42.5 °C</p>']) {
    const { impl, calls } = stubFetch(okResponse('<p>42.5 °C</p>'));
    const res = await fetchSource(url, { lookup: publicLookup, fetchImpl: impl });
    assert.deepEqual(res, { ok: false, outcome: 'source-malformed' }, url);
    assert.equal(calls.length, 0, url + ' must not be fetched');
  }
});

test('an unparseable url is malformed', async () => {
  const { impl, calls } = stubFetch(okResponse('anything'));
  const res = await fetchSource('not a url', { lookup: publicLookup, fetchImpl: impl });
  assert.deepEqual(res, { ok: false, outcome: 'source-malformed' });
  assert.equal(calls.length, 0);
});

test('a non-ok response is not-found, not unreachable', async () => {
  // The URL parsed and the host answered. "The agent invented this page" and
  // "the network is down" are different facts about the provider.
  const { impl } = stubFetch({ ok: false, status: 404, headers: { get: () => null }, text: async () => '42.5 °C' });
  assert.deepEqual(
    await fetchSource('https://example.com/a', { lookup: publicLookup, fetchImpl: impl }),
    { ok: false, outcome: 'source-not-found' },
  );
});

test('a throwing fetch is unreachable, not an exception', async () => {
  const { impl } = stubFetch(new Error('ECONNRESET'));
  assert.deepEqual(
    await fetchSource('https://example.com/a', { lookup: publicLookup, fetchImpl: impl }),
    { ok: false, outcome: 'source-unreachable' },
  );
});

test('the timeout is wired to a signal the fetch receives', async () => {
  const { impl, calls } = stubFetch(okResponse('<p>ok</p>'));
  await fetchSource('https://example.com/a', { lookup: publicLookup, fetchImpl: impl, timeoutMs: 1 });
  const { options } = calls[0];
  assert.ok(options?.signal instanceof AbortSignal, 'a signal must be forwarded');
  // Manual, so every redirect hop can be re-checked against the SSRF guard.
  assert.equal(options.redirect, 'manual');
  // And it must be the caller's timeout, not an unwired one.
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(options.signal.aborted, true, 'the signal must carry timeoutMs');
});

test('an abort during the body read is an outcome, not an exception', async () => {
  // The timeout covers the body stream, so on a slow server the abort lands
  // here rather than at the header exchange. Uncaught, one slow source takes
  // down the whole enrichment run. A timeout is unreachable -- possibly
  // transient -- never a claim that nothing is there.
  const failing = {
    ok: true,
    headers: { get: () => null },
    text: async () => {
      throw Object.assign(new Error('The operation was aborted'), { name: 'TimeoutError' });
    },
  };
  const { impl } = stubFetch(failing);
  assert.deepEqual(
    await fetchSource('https://example.com/a', { lookup: publicLookup, fetchImpl: impl }),
    { ok: false, outcome: 'source-unreachable' },
  );
});

test('a declared content-length over the cap is rejected before the body is read', async () => {
  const res = okResponse('<p>small</p>', { 'content-length': MAX_SOURCE_BYTES + 1 });
  const { impl } = stubFetch(res);
  assert.deepEqual(
    await fetchSource('https://example.com/a', { lookup: publicLookup, fetchImpl: impl }),
    { ok: false, outcome: 'source-too-large' },
  );
  assert.equal(res.read.count, 0, 'the body must never be buffered');
});

test('an oversized body is rejected whole, not truncated', async () => {
  // The backstop for a missing or lying content-length. Truncation is itself
  // an injection primitive: it lets the page author choose where the evidence
  // stops.
  assert.equal(MAX_SOURCE_BYTES, 2_000_000);
  const body = '<p>42.5 °C</p>' + 'x'.repeat(MAX_SOURCE_BYTES);
  const { impl } = stubFetch(okResponse(body));
  const out = await fetchSource('https://example.com/a', { lookup: publicLookup, fetchImpl: impl });
  assert.equal(out.ok, false);
  assert.equal(out.outcome, 'source-too-large');
  assert.equal(out.text, undefined, 'no partial evidence may escape');
});

test('a body of exactly the cap is accepted', async () => {
  const { impl } = stubFetch(okResponse('x'.repeat(MAX_SOURCE_BYTES)));
  const out = await fetchSource('https://example.com/a', { lookup: publicLookup, fetchImpl: impl });
  assert.equal(out.ok, true, 'the cap is a maximum, not an exclusive bound');
});

test('a body within the cap comes back as stripped text', async () => {
  const { impl } = stubFetch(okResponse('<html><body><p>The spring is 42.5&nbsp;&deg;C</p><script>var x=1</script></body></html>'));
  const out = await fetchSource('https://example.com/a', { lookup: publicLookup, fetchImpl: impl });
  assert.equal(out.ok, true);
  assert.equal(out.text, 'The spring is 42.5 °C');
});

test('a redirect to the metadata endpoint is refused, not followed', async () => {
  // The reason redirects are followed by hand. With `redirect: 'follow'` the
  // hop happens inside fetch, where there is no seam to re-check: a public
  // host answers 302 to http://169.254.169.254/ and the guard never sees it.
  // This is the whole SSRF attack against a verifier that runs in CI.
  const seen = [];
  const impl = async (url) => {
    seen.push(url);
    if (seen.length === 1) {
      return {
        ok: false,
        status: 302,
        headers: { get: (h) => (h.toLowerCase() === 'location' ? 'http://169.254.169.254/latest/meta-data/' : null) },
        text: async () => '',
      };
    }
    throw new Error('the guard let the redirect through');
  };
  const out = await fetchSource('https://public.example/a', { lookup: publicLookup, fetchImpl: impl });
  assert.deepEqual(out, { ok: false, outcome: 'source-malformed' });
  assert.equal(seen.length, 1, 'the second hop must never be requested');
});

test('a redirect to a public https URL is followed', async () => {
  // The rejection test above passes if redirects are simply broken.
  const impl = async (url) => {
    if (url === 'https://public.example/a') {
      return {
        ok: false,
        status: 301,
        headers: { get: (h) => (h.toLowerCase() === 'location' ? 'https://elsewhere.example/b' : null) },
        text: async () => '',
      };
    }
    return okResponse('<p>38.5 degrees</p>');
  };
  const out = await fetchSource('https://public.example/a', { lookup: publicLookup, fetchImpl: impl });
  assert.equal(out.ok, true, 'a legitimate redirect must still resolve');
  assert.match(out.text, /38\.5/);
});

test('an endless redirect chain is an outcome, not a hang', async () => {
  let hops = 0;
  const impl = async () => {
    hops++;
    return {
      ok: false,
      status: 302,
      headers: { get: (h) => (h.toLowerCase() === 'location' ? 'https://loop.example/next' : null) },
      text: async () => '',
    };
  };
  const out = await fetchSource('https://loop.example/a', { lookup: publicLookup, fetchImpl: impl });
  assert.deepEqual(out, { ok: false, outcome: 'source-unreachable' });
  assert.ok(hops <= MAX_REDIRECTS + 1, `bounded, got ${hops} hops`);
});
