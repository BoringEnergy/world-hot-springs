/**
 * Everything this site writes to the visitor's device.
 *
 * ONE list. The store and the welcome panel take their keys from here, and
 * the privacy page renders this list rather than describing it in prose. It
 * exists because the prose went stale: the page named the unit key and said
 * it was "the only thing this site writes", while the welcome panel had been
 * writing a second key since the day it shipped. A key written anywhere else
 * is a key the privacy page does not mention, and the browser harness
 * (e2e/disclosure.spec.ts) checks both directions against a real visit.
 *
 * A leaf module with no imports, so the e2e specs can import it directly.
 * localStorage only: no cookies, no sessionStorage, no IndexedDB, and the
 * harness checks those stay empty too.
 */

/** The temperature unit, `c` or `f`. */
export const UNITS_KEY = 'whs.units';

/** That the welcome panel has been dismissed, `1`. */
export const WELCOMED_KEY = 'whs.welcomed';

export interface StoredKey {
  key: string;
  /** What it is, in the page's words. */
  title: string;
  /** What it holds and why, in plain language. */
  purpose: string;
}

export const STORAGE_KEYS: readonly StoredKey[] = [
  {
    key: UNITS_KEY,
    title: 'Your unit preference.',
    purpose: 'The letter c or f, so temperatures stay in the unit you chose.',
  },
  {
    key: WELCOMED_KEY,
    title: 'That you have seen the welcome panel.',
    purpose:
      'The digit 1, written when you close the panel or start using the map, so it is not shown to you again.',
  },
];
