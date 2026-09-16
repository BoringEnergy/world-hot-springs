import { useEffect, useState } from 'react';
import { useStore } from '../store/useStore';
import { BasemapCredits, LegalPages, PAGE_TITLES, type LegalPage } from './LegalPages.tsx';

interface Summary {
  total: number;
  countries: number;
  coverage: { temperature: number; price: number; hours: number; clothing: number };
  sourceDate: string;
}

function Stat({ label, value, of }: { label: string; value: number; of?: number }) {
  return (
    <div className="rounded-xl border border-basalt-800 bg-basalt-850 px-3 py-2.5">
      <div className="text-lg font-semibold tabular-nums text-steam-100">
        {value.toLocaleString()}
        {of !== undefined && (
          <span className="ml-1 text-xs font-normal text-steam-400">
            ({Math.round((value / of) * 100)}%)
          </span>
        )}
      </div>
      <div className="mt-0.5 text-[11px] uppercase tracking-[0.1em] text-steam-400">{label}</div>
    </div>
  );
}

/**
 * Tabs rather than four separate modals.
 *
 * Terms, privacy and safety are pages a reputable dataset is expected to have
 * and that almost nobody opens deliberately. Giving each its own entry point in
 * the header would spend the top of the screen on documents; burying them in a
 * footer the map covers would hide them. One panel, four tabs, and each tab
 * carries its own URL so it can still be linked, cited and crawled.
 */
const TABS: { key: 'about' | LegalPage; label: string }[] = [
  { key: 'about', label: 'About' },
  { key: 'safety', label: PAGE_TITLES.safety },
  { key: 'terms', label: PAGE_TITLES.terms },
  { key: 'privacy', label: PAGE_TITLES.privacy },
];

export function AboutPanel() {
  const showAbout = useStore((s) => s.showAbout);
  const page = useStore((s) => s.page);
  const setShowAbout = useStore((s) => s.setShowAbout);
  const setPage = useStore((s) => s.setPage);
  const meta = useStore((s) => s.meta);
  const [summary, setSummary] = useState<Summary | null>(null);

  const show = showAbout || page !== null;
  const active: 'about' | LegalPage = page ?? 'about';
  const setShow = (v: boolean) => {
    if (v) setShowAbout(true);
    else if (page) setPage(null);
    else setShowAbout(false);
  };
  const goto = (key: 'about' | LegalPage) => (key === 'about' ? setShowAbout(true) : setPage(key));

  useEffect(() => {
    if (!show || summary) return;
    fetch(`${import.meta.env.BASE_URL}data/summary.json`)
      .then((r) => (r.ok ? r.json() : null))
      .then(setSummary)
      .catch(() => setSummary(null));
  }, [show, summary]);

  useEffect(() => {
    if (!show) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShow(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show, page, showAbout]);

  if (!show) return null;

  return (
    <div
      className="pointer-events-auto fixed inset-0 z-50 flex items-end justify-center bg-basalt-950/70 p-0 backdrop-blur-sm sm:items-center sm:p-6"
      onClick={() => setShow(false)}
      role="dialog"
      aria-modal="true"
      aria-label="About this atlas"
    >
      <div
        className="animate-rise max-h-[88vh] w-full max-w-lg overflow-y-auto rounded-t-2xl border border-basalt-700 bg-basalt-900 p-6 scroll-slim sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <h2 className="text-xl font-semibold text-steam-100">
            {active === 'about' ? 'World Hot Springs' : PAGE_TITLES[active]}
          </h2>
          <button
            onClick={() => setShow(false)}
            className="-mr-1 -mt-1 rounded-lg p-1.5 text-steam-400 transition hover:bg-basalt-800 hover:text-steam-100"
            aria-label="Close"
          >
            <svg viewBox="0 0 20 20" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.7">
              <path d="M5 5l10 10M15 5L5 15" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <nav
          aria-label="Sections"
          className="mt-4 flex gap-1 overflow-x-auto border-b border-basalt-800 pb-px"
        >
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => goto(t.key)}
              aria-current={active === t.key ? 'page' : undefined}
              className={`shrink-0 rounded-t-lg border-b-2 px-3 py-2 text-sm transition ${
                active === t.key
                  ? 'border-ember text-steam-100'
                  : 'border-transparent text-steam-400 hover:text-steam-200'
              }`}
            >
              {t.label}
            </button>
          ))}
        </nav>

        {active !== 'about' && (
          <div className="mt-5">
            <LegalPages page={active} meta={meta} />
          </div>
        )}

        {active === 'about' && (
          <>
        <p className="mt-5 text-sm leading-relaxed text-steam-300">
          An open atlas of the world's public and semi-public hot springs. Temperature,
          price, clothing policy and opening hours are treated as first-class facts —
          and when we don't know one, we say <span className="italic text-steam-400">Unknown</span>{' '}
          rather than leaving a blank that reads like an answer.
        </p>

        {summary && (
          <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="Springs" value={summary.total} />
            <Stat label="Countries" value={summary.countries} />
            <Stat label="With temp" value={summary.coverage.temperature} of={summary.total} />
            <Stat label="With price" value={summary.coverage.price} of={summary.total} />
          </div>
        )}

        <section className="mt-6">
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ember-bright">
            What we deliberately leave out
          </h3>
          <p className="mt-2 text-sm leading-relaxed text-steam-300">
            Some springs are known only to the people who live near them and look after
            them. Those are not on this map, and there is no mode, no login and no
            request form that will reveal them. If a spring is added and the local
            community or the landowner asks us to take it down, it comes down
            permanently and is never re-added — including if a later data import
            rediscovers it.
          </p>
          <p className="mt-2 text-sm leading-relaxed text-steam-300">
            This is not a limitation we are working around. It is the point. A map that
            indexes every secret pool is how those pools get ruined.
          </p>
        </section>

        <section className="mt-6">
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-steam-400">
            Where the data comes from
          </h3>
          <p className="mt-2 text-sm leading-relaxed text-steam-300">
            Public sources only, normalised into our own schema with provenance on
            every record. Every spring links back to the sources it came from, so you
            can check us one pin at a time. OpenStreetMap placed most of the pins
            (<code className="text-steam-200">natural=hot_spring</code> and thermal{' '}
            <code className="text-steam-200">amenity=public_bath</code>); the rest of
            this list is where the temperatures and the chemistry come from.
          </p>

          {/*
            Rendered from the dataset's own metadata, never from prose. This
            paragraph used to name OpenStreetMap alone and stayed that way
            through four more upstreams, one of which requires attribution as a
            condition of its licence. A list that is typed by hand is a list
            that goes stale; this one cannot say less than the build contains.
          */}
          {meta && (
            <ul className="mt-3 space-y-2">
              {meta.sources.map((src) => (
                <li
                  key={src.provider}
                  className="rounded-xl border border-basalt-800 bg-basalt-850 px-3 py-2"
                >
                  <a
                    href={src.url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="text-sm leading-snug text-steam-200 underline decoration-basalt-700 underline-offset-2 hover:decoration-steam-400"
                  >
                    {src.name}
                  </a>
                  <p className="mt-1 text-[11px] leading-relaxed text-steam-400">
                    {src.attribution} · {src.license}
                  </p>
                </li>
              ))}
            </ul>
          )}

          <p className="mt-2 text-sm leading-relaxed text-steam-300">
            Records are machine-ingested and marked unverified until a human checks them
            against a primary source. The completeness bar on each card tells you how
            much we actually know.
          </p>
        </section>

        <section className="mt-6">
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-steam-400">
            Safety
          </h3>
          <p className="mt-2 text-sm leading-relaxed text-steam-300">
            Geothermal water can scald, and undeveloped sources have no staff and no
            rescue. Temperatures shift. Treat every reading here as a starting point,
            not a guarantee, and test the water before you get in.
          </p>
        </section>

          </>
        )}

        {/*
          The dataset line reads from metadata; the basemap line is typed here
          because the basemap is not in the dataset and has no entry to read.
          The OSM fetch date describes the OSM layer alone, so it is named as
          that and not as the age of the whole atlas.
        */}
        <footer className="mt-6 border-t border-basalt-800 pt-4 text-[11px] leading-relaxed text-steam-400">
          Dataset {meta?.attribution ?? '© OpenStreetMap contributors'} —{' '}
          {meta ? (
            <a
              href={meta.licenseUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="underline underline-offset-2"
            >
              {meta.license}
            </a>
          ) : (
            'ODbL 1.0'
          )}
          {summary ? `, OpenStreetMap layer as of ${summary.sourceDate.slice(0, 10)}` : ''}. Code
          MIT. Basemap © CARTO. <BasemapCredits />
        </footer>
      </div>
    </div>
  );
}
