import { bandColor, tempBand } from '../lib/types';
import {
  formatAccessStatus,
  formatClothing,
  formatCoords,
  formatDistance,
  formatElevation,
  formatHoursStatus,
  formatName,
  formatPrice,
  formatTemp,
  formatType,
  distanceKm,
} from '../lib/format';
import { useStore } from '../store/useStore';
import { Field } from './Field';
import { SoakScene } from './SoakScene';

export function DetailPanel() {
  const selectedId = useStore((s) => s.selectedId);
  const spring = useStore((s) => s.springs.find((x) => x.id === s.selectedId));
  const units = useStore((s) => s.units);
  const select = useStore((s) => s.select);
  const userLocation = useStore((s) => s.userLocation);

  if (!selectedId || !spring) return null;

  const band = tempBand(spring.temperature.celsius);
  const color = bandColor(band);
  const known = spring.quality.completeness;

  return (
    <aside
      className="animate-rise pointer-events-auto absolute inset-x-0 bottom-0 z-20 max-h-[72vh] overflow-y-auto rounded-t-2xl border-t border-basalt-700 bg-basalt-900/95 backdrop-blur-xl scroll-slim lg:inset-y-0 lg:left-auto lg:right-0 lg:max-h-none lg:w-[400px] lg:rounded-none lg:rounded-l-2xl lg:border-l lg:border-t-0"
      aria-label={`Details for ${formatName(spring)}`}
    >
      <div className="sticky top-0 z-10 flex items-start gap-3 border-b border-basalt-800 bg-basalt-900/95 px-5 py-4 backdrop-blur-xl">
        <span
          className="mt-1.5 size-3 shrink-0 rounded-full ring-4"
          style={{ background: color, ['--tw-ring-color' as string]: `${color}33` }}
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-lg font-semibold leading-tight text-steam-100">
            {formatName(spring)}
          </h2>
          <p className="mt-0.5 truncate text-xs text-steam-400">
            {[spring.location.nearestTown, spring.location.region, spring.location.countryName]
              .filter(Boolean)
              .join(' · ')}
            {userLocation && ` · ${formatDistance(distanceKm(userLocation, spring.location), units)} away`}
          </p>
        </div>
        <button
          onClick={() => select(null)}
          className="-mr-1 rounded-lg p-1.5 text-steam-400 transition hover:bg-basalt-800 hover:text-steam-100"
          aria-label="Close details"
        >
          <svg viewBox="0 0 20 20" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.7">
            <path d="M5 5l10 10M15 5L5 15" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      {/*
        A prohibition, not a caution — so it sits above the warnings list and
        does not look like one of its bullets. This app is built around finding
        a place to bathe and it offers a directions link on every record; for a
        feature where entering the water is forbidden, saying so is the first
        thing on screen or it is nothing. The directions link stays: visiting
        is legal and normal, implying you may get in is the harm.
      */}
      {spring.access.bathingAllowed === false && (
        <div className="mx-5 mt-4 rounded-xl border-2 border-ember bg-ember/20 px-4 py-3">
          <h3 className="flex items-center gap-2 text-sm font-bold text-ember-bright">
            <svg viewBox="0 0 20 20" className="size-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <path d="M10 2.5 18.5 17.5H1.5z" strokeLinejoin="round" />
              <path d="M10 8v4M10 15h.01" strokeLinecap="round" />
            </svg>
            Do not enter the water
          </h3>
          <p className="mt-1.5 text-xs leading-relaxed text-steam-100">
            Bathing is not permitted here. {formatAccessStatus(spring.access.status)}
          </p>
        </div>
      )}

      {/*
        Below the prohibition, never above it. The scene is an invitation to
        soak; on a feature where entering the water is forbidden, an invitation
        rendered first is the last thing seen before the warning.
      */}
      <SoakScene key={spring.id} spring={spring} units={units} />

      {spring.warnings.length > 0 && (
        <div className="mx-5 mt-4 rounded-xl border border-ember/35 bg-ember/10 px-4 py-3">
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ember-bright">
            Before you go
          </h3>
          <ul className="mt-2 space-y-1.5">
            {spring.warnings.map((w) => (
              <li key={w} className="text-xs leading-relaxed text-steam-200">
                {w}
              </li>
            ))}
          </ul>
        </div>
      )}

      <dl className="px-5 pb-2 pt-2">
        <Field label="Temperature">
          <div className="flex items-baseline gap-2">
            <span
              className={
                spring.temperature.celsius === null
                  ? 'text-steam-400 italic'
                  : 'text-2xl font-semibold tabular-nums'
              }
              style={spring.temperature.celsius === null ? undefined : { color }}
            >
              {formatTemp(spring, units)}
            </span>
            {spring.temperature.celsius !== null && (
              <span className="text-xs text-steam-400">
                {units === 'c'
                  ? `${spring.temperature.fahrenheit}°F`
                  : `${spring.temperature.celsius}°C`}
              </span>
            )}
            {spring.temperature.celsius === null && spring.temperature.qualitative && (
              <span className="rounded-full border border-basalt-700 bg-basalt-850 px-2 py-0.5 text-[11px] text-steam-300">
                described as {spring.temperature.qualitative}
              </span>
            )}
          </div>
          {spring.temperature.source && (
            <p className="mt-1 text-xs text-steam-400">{spring.temperature.source}</p>
          )}
        </Field>

        <Field label="Price" value={formatPrice(spring)} hint={spring.access.notes} />
        <Field
          label="Clothing policy"
          value={formatClothing(spring.clothing.policy)}
          hint={
            spring.clothing.schedule || spring.clothing.notes ? (
              <>
                {spring.clothing.schedule}
                {spring.clothing.schedule && spring.clothing.notes ? ' · ' : ''}
                {spring.clothing.notes}
              </>
            ) : undefined
          }
        />
        <Field
          label="Hours"
          value={spring.hours.open ?? formatHoursStatus(spring.hours.status)}
          hint={spring.hours.seasonalNotes}
        />
        <Field label="Type" value={formatType(spring.type)} />
        <Field label="Elevation" value={formatElevation(spring.location.elevation, units)} />
        <Field label="Coordinates">
          <a
            className="text-steam-100 underline decoration-basalt-600 underline-offset-4 transition hover:decoration-ember"
            href={`https://www.openstreetmap.org/?mlat=${spring.location.lat}&mlon=${spring.location.lng}#map=15/${spring.location.lat}/${spring.location.lng}`}
            target="_blank"
            rel="noreferrer noopener"
          >
            {formatCoords(spring.location.lat, spring.location.lng)}
          </a>
        </Field>

        {spring.description && <Field label="Description" value={spring.description} />}

        {spring.tags.length > 0 && (
          <Field label="Tags">
            <div className="flex flex-wrap gap-1.5">
              {spring.tags.map((t) => (
                <span
                  key={t}
                  className="rounded-full border border-basalt-700 bg-basalt-850 px-2 py-0.5 text-[11px] text-steam-300"
                >
                  {t.replace(/-/g, ' ')}
                </span>
              ))}
            </div>
          </Field>
        )}

        <Field label="Data quality">
          <div className="flex items-center gap-3">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-basalt-800">
              <div
                className="h-full rounded-full bg-mineral transition-[width]"
                style={{ width: `${known}%` }}
              />
            </div>
            <span className="text-xs tabular-nums text-steam-400">{known}% complete</span>
          </div>
          <p className="mt-2 text-xs leading-relaxed text-steam-400">
            {spring.verified
              ? 'Checked by a human against a primary source.'
              : 'Machine-ingested from public sources, not yet human-verified.'}{' '}
            Last updated {spring.lastVerified}.
          </p>
        </Field>

        <Field label="Sources">
          <ul className="space-y-1">
            {spring.sources.map((src) => (
              <li key={src}>
                <a
                  href={src}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="break-all text-xs text-steam-300 underline decoration-basalt-600 underline-offset-4 transition hover:text-steam-100 hover:decoration-ember"
                >
                  {src.replace(/^https?:\/\//, '')}
                </a>
              </li>
            ))}
          </ul>
        </Field>
      </dl>

      <div className="px-5 pb-6 pt-2">
        <a
          href={`https://www.google.com/maps/dir/?api=1&destination=${spring.location.lat},${spring.location.lng}`}
          target="_blank"
          rel="noreferrer noopener"
          className="block rounded-xl border border-basalt-700 bg-basalt-850 px-4 py-2.5 text-center text-sm font-medium text-steam-100 transition hover:border-basalt-600 hover:bg-basalt-800"
        >
          Directions
        </a>
        <p className="mt-3 text-[11px] leading-relaxed text-steam-400">
          Something wrong or missing? Corrections are welcome. Springs that locals
          ask us not to publicise are removed permanently and never re-added.
        </p>
      </div>
    </aside>
  );
}
