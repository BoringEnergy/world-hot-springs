import { useMemo } from 'react';
import type { ClothingPolicy, SpringType } from '../lib/types';
import { TEMP_BANDS, bandColor } from '../lib/types';
import { formatClothing, formatType, formatTempValue } from '../lib/format';
import { DEFAULT_FILTERS, TEMP_CEIL, TEMP_FLOOR, useStore, type PriceFilter } from '../store/useStore';

const PRICE_OPTIONS: { id: PriceFilter; label: string }[] = [
  { id: 'any', label: 'Any' },
  { id: 'free', label: 'Free' },
  { id: 'paid', label: 'Paid' },
  { id: 'unknown', label: 'Unknown' },
];

const CLOTHING_OPTIONS: ClothingPolicy[] = ['optional', 'textile-only', 'required', 'mixed', 'unknown'];
const TYPE_OPTIONS: SpringType[] = ['natural', 'wild', 'developed', 'resort', 'unknown'];

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-full border px-2.5 py-1 text-xs transition ${
        active
          ? 'border-ember/60 bg-ember/15 text-steam-100'
          : 'border-basalt-700 bg-basalt-850 text-steam-400 hover:border-basalt-600 hover:text-steam-200'
      }`}
    >
      {children}
    </button>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-basalt-800 px-5 py-4 first:border-t-0">
      <h3 className="mb-2.5 text-[11px] font-medium uppercase tracking-[0.12em] text-steam-400">{title}</h3>
      {children}
    </section>
  );
}

export function FilterRail({ open, onClose }: { open: boolean; onClose: () => void }) {
  const filters = useStore((s) => s.filters);
  const setFilter = useStore((s) => s.setFilter);
  const reset = useStore((s) => s.resetFilters);
  const springs = useStore((s) => s.springs);
  const visible = useStore((s) => s.visible);
  const units = useStore((s) => s.units);

  const countries = useMemo(() => {
    const counts = new Map<string, { name: string; n: number }>();
    for (const s of springs) {
      const prev = counts.get(s.location.country);
      counts.set(s.location.country, { name: s.location.countryName, n: (prev?.n ?? 0) + 1 });
    }
    return [...counts.entries()]
      .filter(([iso]) => iso !== 'XX')
      .sort((a, b) => a[1].name.localeCompare(b[1].name));
  }, [springs]);

  const dirty = JSON.stringify(filters) !== JSON.stringify(DEFAULT_FILTERS);

  function toggle<T>(list: T[], value: T): T[] {
    return list.includes(value) ? list.filter((x) => x !== value) : [...list, value];
  }

  return (
    <div
      className={`pointer-events-auto absolute inset-y-0 left-0 z-30 w-[300px] max-w-[85vw] overflow-y-auto border-r border-basalt-800 bg-basalt-900/95 backdrop-blur-xl transition-transform duration-300 scroll-slim ${
        open ? 'translate-x-0' : '-translate-x-full'
      }`}
      aria-hidden={!open}
    >
      <div className="sticky top-0 z-10 flex items-center justify-between border-b border-basalt-800 bg-basalt-900/95 px-5 py-3.5 backdrop-blur-xl">
        <div>
          <h2 className="text-sm font-semibold text-steam-100">Filters</h2>
          <p className="text-xs tabular-nums text-steam-400">
            {visible.length.toLocaleString()} of {springs.length.toLocaleString()} springs
          </p>
        </div>
        <div className="flex items-center gap-1">
          {dirty && (
            <button
              onClick={reset}
              className="rounded-lg px-2 py-1 text-xs text-steam-400 transition hover:bg-basalt-800 hover:text-steam-100"
            >
              Reset
            </button>
          )}
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-steam-400 transition hover:bg-basalt-800 hover:text-steam-100"
            aria-label="Close filters"
          >
            <svg viewBox="0 0 20 20" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.7">
              <path d="M5 5l10 10M15 5L5 15" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </div>

      <Section title="Temperature">
        <div className="flex items-center justify-between text-xs tabular-nums text-steam-200">
          <span>{formatTempValue(filters.tempMin, units)}</span>
          <span className="text-steam-400">to</span>
          <span>
            {filters.tempMax >= TEMP_CEIL ? `${formatTempValue(TEMP_CEIL, units)}+` : formatTempValue(filters.tempMax, units)}
          </span>
        </div>
        <div className="mt-3 space-y-2">
          <input
            type="range"
            min={TEMP_FLOOR}
            max={TEMP_CEIL}
            value={filters.tempMin}
            onChange={(e) => setFilter('tempMin', Math.min(Number(e.target.value), filters.tempMax))}
            className="w-full accent-[var(--color-ember)]"
            aria-label="Minimum temperature"
          />
          <input
            type="range"
            min={TEMP_FLOOR}
            max={TEMP_CEIL}
            value={filters.tempMax}
            onChange={(e) => setFilter('tempMax', Math.max(Number(e.target.value), filters.tempMin))}
            className="w-full accent-[var(--color-ember)]"
            aria-label="Maximum temperature"
          />
        </div>
        <label className="mt-3 flex cursor-pointer items-center gap-2 text-xs text-steam-300">
          <input
            type="checkbox"
            checked={filters.includeUnknownTemp}
            onChange={(e) => setFilter('includeUnknownTemp', e.target.checked)}
            className="size-3.5 accent-[var(--color-ember)]"
          />
          Include springs with no recorded temperature
        </label>
      </Section>

      <Section title="Price">
        <div className="flex flex-wrap gap-1.5">
          {PRICE_OPTIONS.map((p) => (
            <Chip key={p.id} active={filters.price === p.id} onClick={() => setFilter('price', p.id)}>
              {p.label}
            </Chip>
          ))}
        </div>
      </Section>

      <Section title="Clothing policy">
        <div className="flex flex-wrap gap-1.5">
          {CLOTHING_OPTIONS.map((c) => (
            <Chip
              key={c}
              active={filters.clothing.includes(c)}
              onClick={() => setFilter('clothing', toggle(filters.clothing, c))}
            >
              {formatClothing(c)}
            </Chip>
          ))}
        </div>
      </Section>

      <Section title="Type">
        <div className="flex flex-wrap gap-1.5">
          {TYPE_OPTIONS.map((t) => (
            <Chip
              key={t}
              active={filters.types.includes(t)}
              onClick={() => setFilter('types', toggle(filters.types, t))}
            >
              {formatType(t)}
            </Chip>
          ))}
        </div>
      </Section>

      <Section title="Hours">
        <label className="flex cursor-pointer items-center gap-2 text-xs text-steam-300">
          <input
            type="checkbox"
            checked={filters.openNowOnly}
            onChange={(e) => setFilter('openNowOnly', e.target.checked)}
            className="size-3.5 accent-[var(--color-ember)]"
          />
          Only springs with confirmed opening hours
        </label>
        <p className="mt-1.5 text-[11px] leading-relaxed text-steam-400">
          Springs with unknown hours are excluded when this is on. We would rather
          show you fewer results than send you to a locked gate.
        </p>
      </Section>

      <Section title="Country">
        <select
          value={filters.country ?? ''}
          onChange={(e) => setFilter('country', e.target.value || null)}
          className="w-full rounded-lg border border-basalt-700 bg-basalt-850 px-2.5 py-1.5 text-xs text-steam-200 outline-none transition focus:border-basalt-600"
        >
          <option value="">All countries</option>
          {countries.map(([iso, { name, n }]) => (
            <option key={iso} value={iso}>
              {name} ({n})
            </option>
          ))}
        </select>
      </Section>

      <Section title="Temperature legend">
        <ul className="space-y-1.5">
          {TEMP_BANDS.map((b, i) => (
            <li key={b.id} className="flex items-center gap-2 text-xs text-steam-300">
              <span className="size-2.5 rounded-full" style={{ background: b.color }} />
              {b.label}
              <span className="ml-auto tabular-nums text-steam-400">
                {i === 0
                  ? `< ${formatTempValue(b.maxC, units)}`
                  : b.maxC === Infinity
                    ? `${formatTempValue(TEMP_BANDS[i - 1].maxC, units)}+`
                    : `${formatTempValue(TEMP_BANDS[i - 1].maxC, units)}–${formatTempValue(b.maxC, units)}`}
              </span>
            </li>
          ))}
          <li className="flex items-center gap-2 text-xs text-steam-300">
            <span className="size-2.5 rounded-full" style={{ background: bandColor('unknown') }} />
            No recorded temperature
          </li>
        </ul>
      </Section>
    </div>
  );
}
