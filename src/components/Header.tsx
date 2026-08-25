import { useStore } from '../store/useStore';

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

  return (
    <header className="pointer-events-auto absolute inset-x-0 top-0 z-40 flex items-center gap-2 border-b border-basalt-800/80 bg-basalt-950/80 px-3 py-2.5 backdrop-blur-xl sm:px-4">
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

      <span className="hidden shrink-0 text-xs tabular-nums text-steam-400 md:inline">
        {loading ? 'Loading…' : `${visible.length.toLocaleString()} springs`}
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
