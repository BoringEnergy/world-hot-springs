/**
 * The strip that makes this look like an institution rather than a demo.
 *
 * Two jobs, and they are the same job.
 *
 * The **legend** was only ever visible inside the filter rail, which is closed
 * on arrival. So the first thing a visitor saw was several hundred coloured
 * circles and nothing anywhere on the page saying what the colours meant. A
 * map whose key is behind a button has no key.
 *
 * The **links** are worse. Terms, privacy and safety exist and are reachable
 * at /terms, /privacy and /safety -- and nothing on the page linked to any of
 * them. The only route in was an unlabelled circled-i in the corner of the
 * header. Publishing a safety page for a hot springs atlas and then hiding it
 * is not a small omission: heat and thin ground are the two things that
 * actually injure people, and the page that says so has to be one click away
 * from the map, on every screen, always.
 *
 * In normal flow rather than floating over the map, because an overlay can be
 * covered and this must not be. It costs 34 pixels of globe.
 */
import { TEMP_BANDS, UNKNOWN_TEMP_COLOR, UNKNOWN_TEMP_LABEL } from '../lib/types';
import { formatTempNumber, formatTempValue, shareAsFraction, type Units } from '../lib/format';
import { useStore } from '../store/useStore';
import { href } from '../lib/router.ts';
import { REPO_URL } from '../lib/citation.ts';

/*
 * One band's range, in the current unit. `unit: false` is the phone key's
 * short form, which states the unit once at the start of the row instead of
 * on every number.
 */
function bandRange(i: number, units: Units, unit: boolean): string {
  const t = (c: number) => (unit ? formatTempValue(c, units) : formatTempNumber(c, units));
  const b = TEMP_BANDS[i];
  if (i === 0) return `<${t(b.maxC)}`;
  if (b.maxC === Infinity) return `${t(TEMP_BANDS[i - 1].maxC)}+`;
  return `${t(TEMP_BANDS[i - 1].maxC)}–${t(b.maxC)}`;
}

/*
 * Below 640 px only the short range shows, and the band's name is there for
 * a screen reader. From 640 up the key looks as it always has: the range,
 * then the name from 1024, then both from 1280.
 */
function Swatch({ color, label, range, short }: { color: string; label: string; range?: string; short: string }) {
  return (
    <span className="flex shrink-0 items-center gap-1 sm:gap-1.5" title={range ? `${label} — ${range}` : label}>
      <span className="size-2 shrink-0 rounded-full" style={{ background: color }} aria-hidden />
      <span className="sr-only text-steam-400 lg:not-sr-only">{label}</span>
      <span className="tabular-nums text-steam-500 sm:hidden">{short}</span>
      <span className="hidden tabular-nums text-steam-500 sm:inline lg:hidden">{range ?? label}</span>
      <span className="hidden tabular-nums text-steam-500 xl:inline">{range}</span>
    </span>
  );
}

export function AtlasFooter() {
  const units = useStore((s) => s.units);
  const springs = useStore((s) => s.springs);
  const setPage = useStore((s) => s.setPage);
  const setShowAbout = useStore((s) => s.setShowAbout);

  /*
   * Real anchors with real hrefs, intercepted on the plain left-click.
   * Middle-click, ctrl-click and "copy link address" then all work, and a
   * crawler following the footer reaches the same URL the sitemap advertises
   * -- which is the entire reason those pages have addresses.
   */
  const page = (to: 'about' | 'terms' | 'privacy' | 'safety') => ({
    href: href({ kind: 'page', page: to }),
    onClick: (e: React.MouseEvent) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
      e.preventDefault();
      if (to === 'about') setShowAbout(true);
      else setPage(to);
    },
  });

  // Counted from the records the map is drawing, so the key cannot disagree
  // with the dots. Nothing to say until they have arrived.
  const unknown = springs.length ? shareAsFraction(springs.filter((s) => s.temperature.celsius === null).length / springs.length) : null;

  const link =
    'shrink-0 rounded px-1 text-steam-400 transition hover:text-steam-100 focus-visible:text-steam-100';

  return (
    /*
      Two rows on a phone, the key and then the links; one row from 640 px,
      wrapping the links under the key where the two do not fit side by side
      (at 800 px they need 836). Nothing in it is wider than 320 px, so it
      never scrolls sideways: it used to, and hid Source past the edge.
    */
    <footer className="relative z-30 flex shrink-0 flex-col gap-y-1.5 border-t border-basalt-800/80 bg-basalt-950 px-3 py-2 text-[11px] sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-4 sm:gap-y-1 sm:px-4">
      {/*
        The key. Labelled as a group so a screen reader is told what the six
        colours are for rather than reading six loose words. On a phone it is
        the compact row Hudson asked for on 2026-09-16: every colour, with
        its range and the unit stated once, because a map whose key is
        missing on the screen most people hold is a map with no key.
      */}
      <div
        className="flex flex-wrap items-center justify-between gap-x-1.5 gap-y-0.5 sm:shrink-0 sm:flex-nowrap sm:justify-start sm:gap-3"
        role="group"
        aria-label="Water temperature key"
      >
        <span className="shrink-0 font-medium uppercase tracking-[0.12em] text-steam-500">
          {/* The word from 375 px; below that the row has room for the unit alone. */}
          <span className="hidden min-[375px]:inline">Water </span>
          <span className="normal-case tracking-normal sm:hidden">°{units.toUpperCase()}</span>
        </span>
        {TEMP_BANDS.map((b, i) => (
          <Swatch
            key={b.id}
            color={b.color}
            label={b.label}
            range={bandRange(i, units, true)}
            short={bandRange(i, units, false)}
          />
        ))}
        {/*
          Most springs are this colour, so it is not an afterthought at the end
          of the key -- it is the commonest thing on the map and the one fact
          about the dataset a visitor most needs to arrive knowing.
        */}
        <Swatch
          color={UNKNOWN_TEMP_COLOR}
          label={UNKNOWN_TEMP_LABEL}
          range={unknown ? `${unknown.part} in ${unknown.whole}` : undefined}
          short="—"
        />
      </div>

      <nav
        aria-label="About this atlas"
        className="flex flex-wrap items-center justify-center gap-x-0.5 gap-y-0.5 sm:ml-auto sm:shrink-0 sm:justify-end sm:gap-x-1"
      >
        <a {...page('safety')} className={`${link} font-medium text-ember-bright hover:text-ember-bright`}>
          Safety
        </a>
        <span aria-hidden className="text-basalt-700">
          ·
        </span>
        <a {...page('about')} className={link}>
          About
        </a>
        <span aria-hidden className="text-basalt-700">
          ·
        </span>
        <a {...page('terms')} className={link}>
          Terms
        </a>
        <span aria-hidden className="text-basalt-700">
          ·
        </span>
        <a {...page('privacy')} className={link}>
          Privacy
        </a>
        <span aria-hidden className="text-basalt-700">
          ·
        </span>
        {/*
          The whole dataset, one request. Advertised here because the terms ask
          people not to scrape the interface a card at a time, and an
          instruction to take the file instead is only fair if the file is
          visible.
        */}
        <a
          href={`${import.meta.env.BASE_URL}data/hot-springs.geojson`}
          download
          className={link}
          title="The entire atlas as one GeoJSON file, ODbL 1.0"
          aria-label="Download the data"
        >
          {/* One word on a phone, so the links fit one row at 320 px; the name is whole everywhere. */}
          Download<span className="hidden sm:inline"> the data</span>
        </a>
        <span aria-hidden className="text-basalt-700">
          ·
        </span>
        <a href={REPO_URL} target="_blank" rel="noreferrer noopener" className={link}>
          Source
        </a>
      </nav>
    </footer>
  );
}
