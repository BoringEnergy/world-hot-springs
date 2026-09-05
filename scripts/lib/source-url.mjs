/**
 * Which URLs this project will accept as evidence, and will fetch.
 *
 * One definition, used twice, deliberately:
 *
 *   validateOverlay() calls it offline, so a malformed or unfetchable
 *   citation is rejected at the gate without touching the network. Until now
 *   `source` only had to be truthy -- the string "yes" satisfied it -- which
 *   made "every claim carries a source" a much weaker promise than it reads.
 *
 *   fetchSource() calls it before every request AND after every redirect hop,
 *   because the fetch is the part that can be turned into a weapon. The
 *   verifier is designed to run in CI against URLs written by a stranger. A
 *   request to http://169.254.169.254/ from a workflow that holds a key is
 *   not a broken citation, it is credential exfiltration with extra steps.
 *
 * If these two ever disagree, the gate accepts a claim the verifier then
 * refuses to check, and the claim lands unverified. That is exactly the shape
 * of hole this file exists to prevent, so they share the function rather than
 * the intent.
 *
 * ## What this does not cover
 *
 * DNS rebinding across the check/connect boundary. `assertPublicAddress()`
 * resolves the hostname and rejects private answers, but a hostile resolver
 * can return a public address to that lookup and a loopback one to the
 * connection microseconds later. Closing it properly means pinning the
 * resolved address into the socket, which Node's fetch does not expose.
 *
 * The honest mitigation is elsewhere: Gate 2 runs the fetch in a job with no
 * secrets in scope, so the worst a rebind reaches is an empty runner. This
 * file raises the cost; the workflow's permissions are what make the attack
 * pointless. Do not read this module as making it safe to hand the verifier a
 * key.
 */
import dns from 'node:dns/promises';
import net from 'node:net';

/**
 * https only.
 *
 * Every one of the 25 committed claims is already https, so this costs
 * nothing today. It buys evidence integrity: over http, the page that
 * "verifies" a claim is whatever the network chose to return, and the whole
 * verification step becomes theatre against an attacker who can see the
 * traffic. A source worth citing publishes over TLS.
 */
export const ALLOWED_PROTOCOL = 'https:';

/**
 * Structural check. No DNS, no network -- safe to run in the gate.
 *
 * @returns {{ok: true, url: URL} | {ok: false, reason: string}}
 */
export function parseSourceUrl(raw) {
  if (typeof raw !== 'string' || !raw.trim()) {
    return { ok: false, reason: 'source must be a URL string' };
  }
  let url;
  try {
    url = new URL(raw.trim());
  } catch {
    return { ok: false, reason: `source is not a URL: ${JSON.stringify(raw)}` };
  }
  if (url.protocol !== ALLOWED_PROTOCOL) {
    return { ok: false, reason: `source must be https, got ${url.protocol}//` };
  }
  // Credentials in a citation are never legitimate, and they are a classic
  // way to make a URL read as one host while addressing another.
  if (url.username || url.password) {
    return { ok: false, reason: 'source must not contain credentials' };
  }
  const host = hostnameOf(url);
  if (!host) return { ok: false, reason: 'source has no hostname' };

  // An IP literal is never a published source anyone can check later, and it
  // is the shortest path to the metadata endpoint. Rejected on both counts,
  // before any of the range tests below have to be right.
  if (net.isIP(host)) {
    return { ok: false, reason: 'source must name a host, not an IP address' };
  }
  if (!host.includes('.') || isReservedSuffix(host)) {
    return { ok: false, reason: `source host is not publicly resolvable: ${host}` };
  }
  return { ok: true, url };
}

/** Bracket-stripped, lowercased hostname. `new URL` keeps IPv6 brackets. */
export function hostnameOf(url) {
  return url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
}

/**
 * Names that never belong to the public internet. `localhost` has no dot and
 * is caught above; these are the ones that do.
 */
const RESERVED_SUFFIXES = ['.localhost', '.local', '.internal', '.localdomain', '.home.arpa'];

function isReservedSuffix(host) {
  return RESERVED_SUFFIXES.some((s) => host === s.slice(1) || host.endsWith(s));
}

/**
 * Is this address one we refuse to talk to?
 *
 * Covers loopback, RFC1918, link-local (including the cloud metadata address
 * at 169.254.169.254), carrier-grade NAT, and the IPv6 equivalents -- plus
 * IPv4-mapped IPv6 (`::ffff:127.0.0.1`), which is the standard way to smuggle
 * a v4 loopback past a v6-unaware check.
 */
export function isPrivateAddress(ip) {
  const v = net.isIP(ip);
  if (v === 4) return isPrivateV4(ip);
  if (v === 6) {
    const a = ip.toLowerCase();
    // Unwrap IPv4-mapped and IPv4-compatible forms before judging them.
    const mapped = a.match(/^::(?:ffff:)?(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateV4(mapped[1]);
    if (a === '::' || a === '::1') return true;
    if (a.startsWith('fe80')) return true;           // link-local
    if (/^f[cd]/.test(a)) return true;               // unique local
    return false;
  }
  // Not an address at all: refuse rather than guess.
  return true;
}

function isPrivateV4(ip) {
  const p = ip.split('.').map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = p;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;                 // link-local + metadata
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;       // CGNAT
  if (a >= 224) return true;                               // multicast + reserved
  return false;
}

/**
 * Resolve the host and refuse if any answer is private.
 *
 * Every answer, not the first: a name that resolves to both a public address
 * and 127.0.0.1 is a rebinding setup, and which one a later connection picks
 * is not ours to decide.
 *
 * @returns {Promise<{ok: true} | {ok: false, reason: string}>}
 */
export async function assertPublicAddress(host, { lookup = dns.lookup } = {}) {
  let answers;
  try {
    answers = await lookup(host, { all: true });
  } catch {
    return { ok: false, reason: `source host does not resolve: ${host}` };
  }
  if (!answers?.length) return { ok: false, reason: `source host does not resolve: ${host}` };
  for (const { address } of answers) {
    if (isPrivateAddress(address)) {
      return { ok: false, reason: `source host resolves to a non-public address: ${host}` };
    }
  }
  return { ok: true };
}
