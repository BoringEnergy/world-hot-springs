import { useEffect, useState } from 'react';
import { MapView } from './components/MapView';
import { Header } from './components/Header';
import { FilterRail } from './components/FilterRail';
import { DetailPanel } from './components/DetailPanel';
import { ResultsList } from './components/ResultsList';
import { AboutPanel } from './components/AboutPanel';
import { AtlasFooter } from './components/AtlasFooter';
import { WelcomePanel } from './components/WelcomePanel';
import { useStore } from './store/useStore';
import { onPopState } from './lib/router.ts';

export default function App() {
  const load = useStore((s) => s.load);
  const loading = useStore((s) => s.loading);
  const error = useStore((s) => s.error);
  const select = useStore((s) => s.select);
  const applyRoute = useStore((s) => s.applyRoute);
  const [filtersOpen, setFiltersOpen] = useState(false);

  useEffect(() => {
    load();
  }, [load]);

  /*
   * Back and Forward. The store writes history on every selection, so without
   * this listener the browser's own buttons would change the URL and leave the
   * app showing whatever was on screen -- the failure mode that makes people
   * distrust a single-page app. Registered once, independent of the initial
   * route, which load() applies after the dataset arrives.
   */
  useEffect(() => onPopState(applyRoute), [applyRoute]);

  // Escape backs out one layer at a time: filters, then the detail card.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (filtersOpen) setFiltersOpen(false);
      else select(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [filtersOpen, select]);

  return (
    /*
     * The header sits in normal flow and the map area is what remains. The
     * overlay panels then position against the map, not the window, so none of
     * them needs to know how tall the header is — which is what put the filter
     * rail's own heading underneath it.
     */
    <div className="flex h-full w-full flex-col overflow-hidden">
      <Header onToggleFilters={() => setFiltersOpen((v) => !v)} filtersOpen={filtersOpen} />

      {/*
        A landmark, so the atlas is something a screen reader can jump to
        rather than something it has to be tabbed into past the whole header.
        The element is the only structural change: it lays out exactly as the
        div it replaced.
      */}
      <main className="relative flex-1 overflow-hidden">
        <MapView />
        <FilterRail open={filtersOpen} onClose={() => setFiltersOpen(false)} />
        {!filtersOpen && <ResultsList />}
        {/*
          The greeting shares the top-left corner with the results list and the
          filter rail, and gives way to both: opening either is a statement that
          you already know what you are doing here. The rail hides it for as
          long as the rail is open. A search or "Near me", which is what brings
          up the results list, dismisses it for good -- WelcomePanel does that,
          because the list alone would sit underneath it.
        */}
        {!filtersOpen && <WelcomePanel />}
        <DetailPanel />

        {loading && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="rounded-2xl border border-basalt-800 bg-basalt-900/90 px-5 py-3 text-sm text-steam-300 backdrop-blur-xl">
              Loading the atlas…
            </div>
          </div>
        )}

        {error && (
          <div className="pointer-events-auto absolute inset-x-4 top-1/2 mx-auto max-w-md -translate-y-1/2 rounded-2xl border border-ember/40 bg-basalt-900 p-5 text-sm leading-relaxed text-steam-200">
            <h2 className="mb-2 font-semibold text-steam-100">No dataset yet</h2>
            <p className="text-steam-300">{error}</p>
            <pre className="mt-3 overflow-x-auto rounded-lg bg-basalt-950 px-3 py-2 text-xs text-steam-300">
              npm run data:all
            </pre>
          </div>
        )}
      </main>

      {/*
        In flow, below the map. The key and the links to safety, terms and
        privacy cannot be things an overlay can cover -- see AtlasFooter.
      */}
      <AtlasFooter />

      <AboutPanel />
    </div>
  );
}
