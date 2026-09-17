import { useStore } from '../store/useStore';
import { href } from '../lib/router.ts';
import { PUBLISHER_URL } from '../lib/citation.ts';

export function Header({ onToggleFilters, filtersOpen }: { onToggleFilters: () => void; filtersOpen: boolean }) {
  const units = useStore((s) => s.units);
  const toggleUnits = useStore((s) => s.toggleUnits);
  const filters = useStore((s) => s.filters);
  const setFilter = useStore((s) => s.setFilter);
  const visible = useStore((s) => s.visible);
  const loading = useStore((s) => s.loading);
  const locateMe = useStore((s) => s.locateMe);
  const locating = useStore((s) => s.locating);
  const setShowAbout = useStore((s) => s.setShowAbout);
  const select = useStore((s) => s.select);
  const setPage = useStore((s) => s.setPage);
  // Home is "nothing open": no card, no standing page. `select(null)` already
  // writes the map route and the meta, so the wordmark needs no route logic.
  const goHome = () => {
    setPage(null);
    setShowAbout(false);
    select(null);
  };

  return (
    <header className="relative z-40 flex shrink-0 items-center gap-2 border-b border-basalt-800/80 bg-basalt-950/80 px-3 py-2.5 backdrop-blur-xl sm:px-4">
      {/*
        The masthead.

        This was an `sr-only` h1 -- the heading existed for screen readers and
        the page showed nothing but controls, so a first-time visitor arrived
        at a dark globe with a filter button and a search box and no statement
        anywhere of what they were looking at. A tool with no name reads as
        somebody's weekend project, which is the opposite of what an atlas
        asking to be cited needs.

        The mark is the favicon: a spring seen from directly above, ember
        around a pale core. The byline carries the lab, because the atlas is
        published by one and saying so is part of being checkable.
      */}
      <a
        href={href({ kind: 'map' })}
        onClick={(e) => {
          if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
          e.preventDefault();
          goHome();
        }}
        className="group flex shrink-0 items-center gap-2.5 rounded-xl pr-1 outline-none focus-visible:ring-1 focus-visible:ring-basalt-600"
        aria-label="World Hot Springs — back to the map"
      >
        <svg viewBox="0 0 32 32" className="size-7 shrink-0" aria-hidden>
          <defs>
            <radialGradient id="whs-mark" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#f5e6c8" />
              <stop offset="42%" stopColor="#f08a55" />
              <stop offset="100%" stopColor="#7e3418" />
            </radialGradient>
          </defs>
          <circle cx="16" cy="18" r="11" fill="url(#whs-mark)" />
          <circle cx="16" cy="18" r="4.4" fill="#f5efe5" />
          {/* Two wisps. Enough to read as steam at 28px; more becomes mush. */}
          <path
            d="M12 7.5c2.2-1.6 0-3.3 1.3-5M19.6 7c2-1.7-.2-3.2 1-4.8"
            fill="none"
            stroke="#c8bfb3"
            strokeOpacity="0.65"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
        {/*
          The wordmark's words are hidden on a phone, where the mark alone has
          to share a row with the search box -- but the h1 inside them is not.
          This span was `hidden md:flex`, and display:none takes a heading out
          of the accessibility tree with it, so below 768 px the page had no
          h1 at all. `sr-only` keeps the words out of sight and in the tree.
        */}
        <span className="sr-only min-w-0 flex-col leading-none md:not-sr-only md:flex">
          <h1 className="text-[13px] font-semibold uppercase tracking-[0.16em] text-steam-100 transition group-hover:text-white">
            World Hot Springs
          </h1>
          <span className="mt-1 text-[10px] tracking-[0.06em] text-steam-500">an open atlas</span>
        </span>
      </a>

      <a
        href={PUBLISHER_URL}
        target="_blank"
        rel="noreferrer noopener"
        className="hidden shrink-0 self-stretch border-l border-basalt-800 pl-3 pr-1 text-[10px] uppercase leading-[1.15] tracking-[0.14em] text-steam-500 transition hover:text-steam-200 xl:flex xl:flex-col xl:justify-center"
      >
        <span className="text-steam-400">Hudson</span>
        <span>R&amp;D</span>
      </a>

      <button
        onClick={onToggleFilters}
        aria-pressed={filtersOpen}
        className={`flex shrink-0 items-center gap-2 rounded-xl border px-3 py-2 text-sm transition ${
          filtersOpen
            ? 'border-basalt-600 bg-basalt-800 text-steam-100'
            : 'border-basalt-700 bg-basalt-850 text-steam-300 hover:border-basalt-600 hover:text-steam-100'
        }`}
      >
        <svg viewBox="0 0 20 20" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.6">
          <path d="M3 6h14M6 10h8M8.5 14h3" strokeLinecap="round" />
        </svg>
        <span className="hidden sm:inline">Filters</span>
      </button>

      <div className="relative min-w-0 flex-1">
        <svg
          viewBox="0 0 20 20"
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-steam-400"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
        >
          <circle cx="9" cy="9" r="5.5" />
          <path d="M13.5 13.5L17 17" strokeLinecap="round" />
        </svg>
        <input
          value={filters.query}
          onChange={(e) => setFilter('query', e.target.value)}
          placeholder="Search by name, town, or country"
          className="w-full rounded-xl border border-basalt-700 bg-basalt-850 py-2 pl-9 pr-9 text-sm text-steam-100 placeholder:text-steam-400 outline-none transition focus:border-basalt-600"
          aria-label="Search hot springs"
        />
        {filters.query && (
          <button
            onClick={() => setFilter('query', '')}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-1 text-steam-400 transition hover:bg-basalt-800 hover:text-steam-100"
            aria-label="Clear search"
          >
            <svg viewBox="0 0 20 20" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M5 5l10 10M15 5L5 15" strokeLinecap="round" />
            </svg>
          </button>
        )}
      </div>

      <span aria-hidden className="hidden shrink-0 text-xs tabular-nums text-steam-400 md:inline">
        {loading
          ? 'Loading…'
          : `${visible.length.toLocaleString()} spring${visible.length === 1 ? '' : 's'}`}
      </span>

      {/*
        The same count, announced.
        Filtering and searching change nothing a screen reader is told: the map
        is a canvas, the results list only exists during a search, and this
        count was the sole feedback that a filter did anything -- silent, and
        display:none below md, where a live region announces nothing at all.
        So the visible span is now decorative and this one is the accessible
        copy: always in the tree, polite so it waits for a pause in typing
        rather than reading a new total on every keystroke.
      */}
      <span role="status" aria-live="polite" className="sr-only">
        {loading
          ? 'Loading the atlas'
          : `${visible.length.toLocaleString()} spring${visible.length === 1 ? '' : 's'} shown`}
      </span>

      <button
        onClick={locateMe}
        disabled={locating}
        className="shrink-0 rounded-xl border border-basalt-700 bg-basalt-850 p-2 text-steam-300 transition hover:border-basalt-600 hover:text-steam-100 disabled:opacity-50"
        aria-label="Find springs near me"
        title="Near me"
      >
        <svg viewBox="0 0 20 20" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.6">
          <circle cx="10" cy="10" r="3" />
          <circle cx="10" cy="10" r="6.5" />
          <path d="M10 1.5v2M10 16.5v2M1.5 10h2M16.5 10h2" strokeLinecap="round" />
        </svg>
      </button>

      <button
        onClick={toggleUnits}
        className="shrink-0 rounded-xl border border-basalt-700 bg-basalt-850 px-3 py-2 text-sm font-medium tabular-nums text-steam-100 transition hover:border-basalt-600"
        aria-label={`Switch to ${units === 'c' ? 'Fahrenheit' : 'Celsius'}`}
      >
        °{units.toUpperCase()}
      </button>

      <button
        onClick={() => setShowAbout(true)}
        className="shrink-0 rounded-xl border border-basalt-700 bg-basalt-850 p-2 text-steam-300 transition hover:border-basalt-600 hover:text-steam-100"
        aria-label="About this atlas"
      >
        <svg viewBox="0 0 20 20" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.6">
          <circle cx="10" cy="10" r="7.5" />
          <path d="M10 9v5M10 6.2v.6" strokeLinecap="round" />
        </svg>
      </button>
    </header>
  );
}
