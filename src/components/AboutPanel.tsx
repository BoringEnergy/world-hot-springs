import { useEffect, useState } from 'react';
import { useStore } from '../store/useStore';

interface Summary {
  total: number;
  countries: number;
  coverage: { temperature: number; price: number; hours: number; clothing: number };
  generated: string;
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

export function AboutPanel() {
  const show = useStore((s) => s.showAbout);
  const setShow = useStore((s) => s.setShowAbout);
  const [summary, setSummary] = useState<Summary | null>(null);

  useEffect(() => {
    if (!show || summary) return;
    fetch(`${import.meta.env.BASE_URL}data/summary.json`)
      .then((r) => (r.ok ? r.json() : null))
      .then(setSummary)
      .catch(() => setSummary(null));
  }, [show, summary]);

  useEffect(() => {
    if (!show) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setShow(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [show, setShow]);

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
          <h2 className="text-xl font-semibold text-steam-100">World Hot Springs</h2>
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

        <p className="mt-3 text-sm leading-relaxed text-steam-300">
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
            Public sources only. The current build is derived from OpenStreetMap
            (<code className="text-steam-200">natural=hot_spring</code> and thermal{' '}
            <code className="text-steam-200">amenity=public_bath</code>), normalised into
            our own schema with provenance on every record. Every spring links back to
            its sources so you can check us.
          </p>
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

        <footer className="mt-6 border-t border-basalt-800 pt-4 text-[11px] leading-relaxed text-steam-400">
          Map data © OpenStreetMap contributors, ODbL 1.0. Basemap © CARTO,
          satellite imagery © Esri, Maxar, Earthstar Geographics, terrain
          Mapzen Terrain Tiles (AWS Open Data). Live air temperature from
          Open-Meteo, CC BY 4.0. Dataset
          {summary ? ` built ${summary.generated.slice(0, 10)}` : ''}. Code MIT.
        </footer>
      </div>
    </div>
  );
}
