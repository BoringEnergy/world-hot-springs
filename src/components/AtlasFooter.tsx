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
import { TEMP_BANDS, UNKNOWN_TEMP_COLOR } from '../lib/types';
import { formatTempValue } from '../lib/format';
import { useStore } from '../store/useStore';
import { href } from '../lib/router.ts';

const REPO = 'https://github.com/BoringEnergy/world-hot-springs';

function Swatch({ color, label, range }: { color: string; label: string; range?: string }) {
  return (
    <span className="flex shrink-0 items-center gap-1.5" title={range ? `${label} — ${range}` : label}>
      <span className="size-2 rounded-full" style={{ background: color }} aria-hidden />
      <span className="hidden text-steam-400 lg:inline">{label}</span>
      <span className="text-steam-500 tabular-nums lg:hidden">{range ?? label}</span>
      <span className="hidden tabular-nums text-steam-500 xl:inline">{range}</span>
    </span>
  );
}

export function AtlasFooter() {
  const units = useStore((s) => s.units);
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

  const link =
    'shrink-0 rounded px-1 text-steam-400 transition hover:text-steam-100 focus-visible:text-steam-100';

  return (
    <footer className="relative z-30 flex shrink-0 items-center gap-x-4 gap-y-1 overflow-x-auto border-t border-basalt-800/80 bg-basalt-950 px-3 py-2 text-[11px] scroll-slim sm:px-4">
      {/*
        The key. Labelled as a group so a screen reader is told what the six
        colours are for rather than reading six loose words.
      */}
      <div
        className="hidden shrink-0 items-center gap-3 sm:flex"
        role="group"
        aria-label="Water temperature key"
      >
        <span className="hidden shrink-0 font-medium uppercase tracking-[0.12em] text-steam-500 sm:inline">
          Water
        </span>
        {TEMP_BANDS.map((b, i) => (
          <Swatch
            key={b.id}
            color={b.color}
            label={b.label}
            range={
              i === 0
                ? `<${formatTempValue(b.maxC, units)}`
                : b.maxC === Infinity
                  ? `${formatTempValue(TEMP_BANDS[i - 1].maxC, units)}+`
                  : `${formatTempValue(TEMP_BANDS[i - 1].maxC, units)}–${formatTempValue(b.maxC, units)}`
            }
          />
        ))}
        {/*
          Five springs in six are this colour, so it is not an afterthought at
          the end of the key -- it is the commonest thing on the map and the
          one fact about the dataset a visitor most needs to arrive knowing.
        */}
        <Swatch color={UNKNOWN_TEMP_COLOR} label="No reading" range="4 in 5" />
      </div>

      <nav
        aria-label="About this atlas"
        className="mx-auto flex shrink-0 items-center gap-1 sm:mx-0 sm:ml-auto"
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
        >
          Download the data
        </a>
        <span aria-hidden className="text-basalt-700">
          ·
        </span>
        <a href={REPO} target="_blank" rel="noreferrer noopener" className={link}>
          Source
        </a>
      </nav>
    </footer>
  );
}
