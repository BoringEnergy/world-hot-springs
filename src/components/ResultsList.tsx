import { useMemo } from 'react';
import { bandColor, tempBand } from '../lib/types';
import { distanceKm, formatDistance, formatName, formatPrice, formatTemp } from '../lib/format';
import { sortByDistance, useStore } from '../store/useStore';

const MAX_ROWS = 60;

/**
 * The list only appears when the user has expressed an intent that a list can
 * answer — a search, or "near me". Otherwise the globe is the interface and a
 * permanent sidebar of 14,000 rows would just be noise.
 */
export function ResultsList() {
  const visible = useStore((s) => s.visible);
  const query = useStore((s) => s.filters.query);
  const userLocation = useStore((s) => s.userLocation);
  const units = useStore((s) => s.units);
  const select = useStore((s) => s.select);
  const selectedId = useStore((s) => s.selectedId);

  const active = query.trim().length > 0 || userLocation !== null;

  const rows = useMemo(() => {
    if (!active) return [];
    const list = userLocation ? sortByDistance(visible, userLocation) : visible;
    return list.slice(0, MAX_ROWS);
  }, [active, visible, userLocation]);

  if (!active) return null;

  return (
    <div className="pointer-events-auto absolute left-3 top-[64px] z-20 flex max-h-[calc(100vh-88px)] w-[300px] max-w-[calc(100vw-24px)] flex-col overflow-hidden rounded-2xl border border-basalt-800 bg-basalt-900/95 backdrop-blur-xl sm:left-4">
      <div className="border-b border-basalt-800 px-4 py-2.5">
        <p className="text-xs tabular-nums text-steam-400">
          {visible.length.toLocaleString()} match{visible.length === 1 ? '' : 'es'}
          {userLocation && ', nearest first'}
          {visible.length > MAX_ROWS && ` · showing ${MAX_ROWS}`}
        </p>
      </div>

      {rows.length === 0 ? (
        <p className="px-4 py-6 text-center text-xs leading-relaxed text-steam-400">
          Nothing matches those filters. Try widening the temperature range, or turn
          on “include springs with no recorded temperature” — most springs in the
          world have never had one taken.
        </p>
      ) : (
        <ul className="overflow-y-auto scroll-slim">
          {rows.map((s) => {
            const color = bandColor(tempBand(s.temperature.celsius));
            return (
              <li key={s.id}>
                <button
                  onClick={() => select(s.id)}
                  className={`flex w-full items-center gap-3 border-b border-basalt-800/60 px-4 py-2.5 text-left transition hover:bg-basalt-850 ${
                    selectedId === s.id ? 'bg-basalt-850' : ''
                  }`}
                >
                  <span className="size-2 shrink-0 rounded-full" style={{ background: color }} aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-steam-100">{formatName(s)}</span>
                    <span className="block truncate text-[11px] text-steam-400">
                      {[s.location.nearestTown, s.location.countryName].filter(Boolean).join(', ')}
                      {userLocation && ` · ${formatDistance(distanceKm(userLocation, s.location), units)}`}
                    </span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span
                      className="block text-xs tabular-nums"
                      style={{ color: s.temperature.celsius === null ? undefined : color }}
                    >
                      <span className={s.temperature.celsius === null ? 'italic text-steam-400' : ''}>
                        {formatTemp(s, units)}
                      </span>
                    </span>
                    <span className="block text-[10px] text-steam-400">{formatPrice(s)}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
