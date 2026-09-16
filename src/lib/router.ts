/**
 * URL <-> state, without a router dependency.
 *
 * Why this file exists: until now the atlas had exactly one URL. Seven and a
 * half thousand records and no address for any of them — which means no
 * citation, no share link, no search index, and no way for a landowner to
 * send us *this one, take it down*. A database whose records cannot be
 * addressed is a demo of a database.
 *
 * Real paths rather than a fragment, because a fragment is never sent to the
 * server and so is never indexed or logged. `vercel.json` rewrites every
 * unmatched path to index.html, so a cold load of /s/whs_… still boots the
 * app; without that rewrite deep links 404 and this whole file is a liability
 * rather than a feature.
 */

/**
 * Vite's base, minus the trailing slash, so `${BASE}/s/x` is never `//s/x`.
 *
 * Read defensively because this module is imported by the store, and the store
 * is imported by `scripts/filters.test.mjs` running under plain Node -- where
 * `import.meta.env` does not exist and an unguarded `.BASE_URL.replace` throws
 * at module load, taking the filter tests down with it. The guard costs
 * nothing and keeps the store testable outside a bundler.
 */
const BASE = ((import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/').replace(/\/+$/, '');

export type PageName = 'about' | 'terms' | 'privacy' | 'safety';

export const PAGES: readonly PageName[] = ['about', 'terms', 'privacy', 'safety'];

export type Route =
  | { kind: 'map' }
  | { kind: 'spring'; id: string }
  | { kind: 'page'; page: PageName };

/**
 * Identities are `whs_` + 12 lowercase hex, minted by the build. The shape is
 * asserted here rather than trusted, because this value arrives from the
 * address bar: an unvalidated id goes straight into a store lookup and into
 * the canonical <link>, which is how a crawler gets handed an infinite space
 * of URLs that all render the same empty card.
 */
const ID_RE = /^whs_[0-9a-f]{12}$/;

export function isSpringId(value: string): boolean {
  return ID_RE.test(value);
}

export function parse(pathname: string = window.location.pathname): Route {
  let path = pathname;
  if (BASE && path.startsWith(BASE)) path = path.slice(BASE.length);
  const seg = path.split('/').filter(Boolean);

  if (seg.length === 2 && seg[0] === 's' && ID_RE.test(seg[1])) {
    return { kind: 'spring', id: seg[1] };
  }
  if (seg.length === 1 && (PAGES as readonly string[]).includes(seg[0])) {
    return { kind: 'page', page: seg[0] as PageName };
  }
  return { kind: 'map' };
}

/** The canonical path for a route. Always absolute, never relative. */
export function href(route: Route): string {
  switch (route.kind) {
    case 'spring':
      return `${BASE}/s/${route.id}`;
    case 'page':
      return `${BASE}/${route.page}`;
    case 'map':
      return `${BASE}/` || '/';
  }
}

/** The full, shareable URL for a route — what goes in og:url and in a citation. */
export function absoluteHref(route: Route): string {
  return typeof window === 'undefined' ? href(route) : new URL(href(route), window.location.origin).toString();
}

/**
 * Write the route to the address bar.
 *
 * `replace` for the boot-time normalisation (a bad id becoming `/`), `push`
 * for anything the user did — closing a card with Escape should go back to
 * the map, and Back should reopen the card, which only works if opening it
 * pushed an entry.
 */
export function navigate(route: Route, { replace = false } = {}): void {
  if (typeof window === 'undefined') return;
  const url = href(route);
  if (url === window.location.pathname) return;
  if (replace) window.history.replaceState(null, '', url);
  else window.history.pushState(null, '', url);
}

export function onPopState(cb: (route: Route) => void): () => void {
  const handler = () => cb(parse());
  window.addEventListener('popstate', handler);
  return () => window.removeEventListener('popstate', handler);
}
