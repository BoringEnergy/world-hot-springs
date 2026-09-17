/**
 * The records the specs open, and what the page should say about them.
 *
 * Which records: scripts/fixtures/cards.json, the Node suite's hand-picked
 * cards, so both suites exercise the same springs. What they hold: the
 * dataset itself, data/hot-springs.json, because that is what the page loads.
 * A fixture copy of a record can go stale; the build output cannot disagree
 * with the build.
 */
import fs from 'node:fs';
import type { HotSpring } from '../../src/lib/types.ts';
import { SITE_NAME } from './source.ts';

const CARDS = JSON.parse(fs.readFileSync('scripts/fixtures/cards.json', 'utf8')) as Record<string, { id: string }>;
const DATASET = JSON.parse(fs.readFileSync('data/hot-springs.json', 'utf8')) as HotSpring[];

export type Card = 'radium' | 'prohibited';

/** The dataset record behind a named card in cards.json. */
export function record(card: Card): HotSpring {
  const id = CARDS[card]?.id;
  if (!id) throw new Error(`scripts/fixtures/cards.json has no "${card}" card`);
  const r = DATASET.find((s) => s.id === id);
  if (!r) throw new Error(`${id} ("${card}" in cards.json) is not in data/hot-springs.json`);
  return r;
}

/** True when an id is not in the dataset, for the dead-permalink test. */
export function isUnknownId(id: string): boolean {
  return !DATASET.some((s) => s.id === id);
}

/** The document title applySpringMeta (lib/seo.ts) gives a record. */
export function springTitle(s: HotSpring): string {
  const name = s.name ?? 'Unnamed hot spring';
  const where = [s.location.nearestTown, s.location.countryName].filter(Boolean).join(', ');
  return `${name}${where ? `, ${where}` : ''} — ${SITE_NAME}`;
}
