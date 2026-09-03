import { useEffect, useRef, useState } from 'react';
import type { HotSpring } from '../lib/types';
import { formatElevation, formatTemp, type Units } from '../lib/format';
import {
  bandPalette,
  daylightWord,
  dayProgress,
  fetchSpringWeather,
  hashSeed,
  mulberry32,
  sceneBand,
  solarElevation,
  steamCount,
  weatherLabel,
  type SpringWeather,
} from '../lib/scene';

/**
 * The soak view: a deterministic procedural scene for one spring, painted
 * from its record — sky from solar time, ridgelines from a seeded hash of
 * the spring id, steam density from the temperature reading, live air from
 * Open-Meteo when the network allows.
 *
 * Honesty rules, same as the dataset: a null temperature renders still air
 * with an "unmeasured" caption, never a guessed steamy glow. Curated
 * photos[] render as a strip when present and are simply absent otherwise.
 *
 * FUTURE — curating photography. The record type already carries
 * `photos?: string[]` but no pipeline stage fills it, so today this strip
 * only renders operator-supplied URLs already on the record. The intended
 * shape, when the overlay pipeline grows a photo claim, is one entry per
 * photo: `{ url, page, license, credit }` — a hotlinkable file URL, the
 * public page stating its license, an SPDX-style license id
 * (CC-BY-SA-4.0 and friends; NC/ND variants refused, they are not open),
 * and a human credit line. Every photo claim needs all four, the way every
 * data claim needs a source a stranger can check. Until then: no stock, no
 * placeholders, no scraped thumbnails.
 */

function mix(a: string, b: string, t: number): string {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  return `#${pa.map((v, i) => Math.round(v + (pb[i] - v) * t).toString(16).padStart(2, '0')).join('')}`;
}

function ridgeY(peaks: number[], x01: number): number {
  const n = peaks.length;
  const pos = x01 * (n - 1);
  const i = Math.min(Math.floor(pos), n - 2);
  const f = pos - i;
  const s = f * f * (3 - 2 * f);
  return peaks[i] * (1 - s) + peaks[i + 1] * s;
}

function paint(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  spring: HotSpring,
  now: Date,
  t: number,
): void {
  const rng = mulberry32(hashSeed(spring.id));
  const palette = bandPalette(sceneBand(spring));
  const elev = solarElevation(spring.location.lat, spring.location.lng, now);
  const prog = dayProgress(spring.location.lng, now);

  // --- sky: night / ember dusk / steel day blended by sun height ---
  const nightF = Math.max(0, Math.min(1, -elev / 14));
  const duskF = Math.max(0, 1 - Math.abs(elev + 3) / 9);
  const top = mix(mix('#4a6b84', '#1c0f08', nightF), '#0f0503', duskF * 0.4);
  const mid = mix(mix('#8fa8b8', '#57260f', nightF), '#b4501e', duskF * 0.55);
  const horizon = mix(mix('#c9b896', '#d9663a', nightF * 0.4), '#f08a55', duskF * 0.5);
  const sky = ctx.createLinearGradient(0, 0, 0, h * 0.72);
  sky.addColorStop(0, top);
  sky.addColorStop(0.62, mid);
  sky.addColorStop(1, horizon);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h * 0.72 + 1);

  // --- stars, only where night reaches ---
  if (nightF > 0.05) {
    for (let i = 0; i < 110; i++) {
      const x = rng() * w;
      const y = rng() * h * 0.6;
      const a = nightF * (0.2 + 0.8 * rng());
      ctx.fillStyle = `rgba(245,239,229,${a.toFixed(3)})`;
      const r = rng() < 0.12 ? 1.4 : 0.8;
      ctx.fillRect(x, y, r, r);
    }
  }

  // --- sun or moon rides the day arc ---
  const bodyX = w * (0.12 + 0.76 * prog);
  if (elev >= -1) {
    const bodyY = h * 0.66 - (Math.min(elev, 60) / 60) * h * 0.55;
    const glowR = h * 0.16;
    const glow = ctx.createRadialGradient(bodyX, bodyY, 0, bodyX, bodyY, glowR);
    glow.addColorStop(0, palette.glow);
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = glow;
    ctx.fillRect(bodyX - glowR, bodyY - glowR, glowR * 2, glowR * 2);
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#f7ead0';
    ctx.beginPath();
    ctx.arc(bodyX, bodyY, Math.max(5, h * 0.035), 0, Math.PI * 2);
    ctx.fill();
  } else {
    const bodyY = h * 0.5 - (Math.min(-elev, 40) / 40) * h * 0.3;
    ctx.fillStyle = '#e8e2d4';
    ctx.beginPath();
    ctx.arc(bodyX, bodyY, Math.max(4, h * 0.022), 0, Math.PI * 2);
    ctx.fill();
  }

  // --- ridgelines, far to near, drawn over the sky's foot ---
  const layers = [
    { base: 0.52, amp: 0.1, peaks: 5, color: '#2b2320' },
    { base: 0.6, amp: 0.07, peaks: 7, color: '#171312' },
    { base: 0.68, amp: 0.05, peaks: 9, color: '#0d0b0a' },
  ];
  for (const layer of layers) {
    const vals = Array.from({ length: layer.peaks }, () => rng());
    ctx.fillStyle = layer.color;
    ctx.beginPath();
    ctx.moveTo(0, h * 0.72 + 1);
    for (let x = 0; x <= w; x += 6) {
      const y = h * layer.base - ridgeY(vals, x / w) * h * layer.amp;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(w, h * 0.72 + 1);
    ctx.closePath();
    ctx.fill();
  }

  // --- water: the pool band glows in the spring's own temperature colour ---
  const waterY = h * 0.7;
  const water = ctx.createLinearGradient(0, waterY, 0, h);
  water.addColorStop(0, palette.water);
  water.addColorStop(1, palette.waterDeep);
  ctx.fillStyle = water;
  ctx.fillRect(0, waterY, w, h - waterY);
  const poolGlow = ctx.createRadialGradient(
    w * 0.5, waterY + 4, 0, w * 0.5, waterY + 4, w * 0.45,
  );
  poolGlow.addColorStop(0, 'rgba(245,239,229,0.28)');
  poolGlow.addColorStop(1, 'rgba(245,239,229,0)');
  ctx.fillStyle = poolGlow;
  ctx.fillRect(0, waterY, w, h - waterY);
  // Shimmer strokes drift on the clock.
  ctx.strokeStyle = 'rgba(245,239,229,0.16)';
  ctx.lineWidth = 1.5;
  for (let i = 0; i < 6; i++) {
    const y = waterY + ((h - waterY) * (i + 1)) / 7;
    const drift = Math.sin(t * (0.5 + i * 0.13) + i * 1.7) * w * 0.03;
    ctx.beginPath();
    ctx.moveTo(w * 0.12 + drift, y);
    ctx.lineTo(w * 0.88 + drift, y);
    ctx.stroke();
  }

  // --- steam: density is the reading. No reading, no steam. ---
  const n = steamCount(spring);
  for (let i = 0; i < n; i++) {
    const bx = rng();
    const r = (7 + rng() * 22) * (w / 420);
    const speed = 0.05 + rng() * 0.075;
    const phase = rng();
    const p = (t * speed + phase) % 1;
    const y = waterY + 6 - p * h * 0.58;
    const x = bx * w + Math.sin(p * 9 + phase * 12) * 16;
    ctx.fillStyle = `rgba(245,239,229,${(Math.sin(p * Math.PI) * 0.15).toFixed(3)})`;
    ctx.beginPath();
    ctx.arc(x, y, r * (0.7 + p * 0.7), 0, Math.PI * 2);
    ctx.fill();
  }

  // --- vignette keeps the ember-room mood at the edges ---
  const vig = ctx.createRadialGradient(
    w / 2, h * 0.45, Math.min(w, h) * 0.35, w / 2, h * 0.5, Math.max(w, h) * 0.75,
  );
  vig.addColorStop(0, 'rgba(0,0,0,0)');
  vig.addColorStop(1, 'rgba(5,4,3,0.5)');
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, w, h);
}

export function SoakScene({ spring, units }: { spring: HotSpring; units: Units }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [weather, setWeather] = useState<SpringWeather | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    void fetchSpringWeather(spring.location.lat, spring.location.lng, controller.signal).then(setWeather);
    return () => controller.abort();
  }, [spring.location.lat, spring.location.lng]);

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!wrap || !canvas || !ctx) return;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let raf = 0;
    let running = false;
    let inView = false;
    const render = (t: number) => {
      const rect = wrap.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      if (canvas.width !== Math.round(rect.width * dpr)) {
        canvas.width = Math.round(rect.width * dpr);
        canvas.height = Math.round(rect.height * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      paint(ctx, rect.width, rect.height, spring, new Date(), t);
    };
    const t0 = performance.now();
    const frame = () => {
      raf = 0;
      if (!document.hidden) render((performance.now() - t0) / 1000);
      if (running) raf = requestAnimationFrame(frame);
    };
    const start = () => {
      if (running || reduceMotion) return;
      running = true;
      raf = requestAnimationFrame(frame);
    };
    const stop = () => {
      running = false;
      cancelAnimationFrame(raf);
    };
    // Reduced motion: one honest static frame, sized correctly.
    render(2.2);
    const ro = new ResizeObserver(() => {
      if (reduceMotion || !running) render(2.2);
    });
    ro.observe(wrap);
    const io = new IntersectionObserver(([entry]) => {
      inView = entry.isIntersecting;
      if (inView) start();
      else stop();
    });
    io.observe(wrap);
    const onVis = () => {
      if (document.hidden) stop();
      else if (inView) start();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      stop();
      ro.disconnect();
      io.disconnect();
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [spring]);

  const now = new Date();
  const elev = solarElevation(spring.location.lat, spring.location.lng, now);
  const air =
    weather !== null
      ? units === 'c'
        ? `${weather.tempC.toFixed(0)}°C air`
        : `${((weather.tempC * 9) / 5 + 32).toFixed(0)}°F air`
      : null;
  const caption = [
    spring.temperature.celsius !== null ? `${formatTemp(spring, units)} water` : 'Unmeasured water',
    spring.location.elevation !== null
      ? formatElevation(spring.location.elevation, units)
      : null,
    air,
    daylightWord(elev),
  ]
    .filter((x): x is string => x !== null)
    .join(' · ');
  const ariaSummary =
    `Procedural ${daylightWord(elev)} scene for ${spring.name ?? 'an unnamed spring'}: ` +
    (spring.temperature.celsius !== null
      ? `water rendered in its ${sceneBand(spring)} temperature colour`
      : 'no temperature reading, rendered as still air and calm water');

  return (
    <figure
      className={
        expanded
          ? 'fixed inset-3 z-50 flex flex-col overflow-hidden rounded-2xl border border-basalt-700 bg-basalt-950 shadow-2xl sm:inset-8'
          : 'relative mx-5 mt-4 overflow-hidden rounded-2xl border border-basalt-800'
      }
      role="img"
      aria-label={ariaSummary}
    >
      <div ref={wrapRef} className={expanded ? 'relative min-h-0 flex-1' : 'relative h-48'}>
        <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" aria-hidden />
        <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-2 p-3">
          <span className="rounded-full border border-basalt-700/80 bg-basalt-950/70 px-2.5 py-1 text-[11px] capitalize backdrop-blur-sm text-steam-200">
            {daylightWord(elev)}
            {weather !== null && ` · ${weatherLabel(weather.code)}`}
          </span>
          <button
            onClick={() => setExpanded((v) => !v)}
            className="pointer-events-auto rounded-full border border-basalt-700/80 bg-basalt-950/70 p-1.5 text-steam-300 backdrop-blur-sm transition hover:text-steam-100"
            aria-label={expanded ? 'Shrink scene' : 'Expand scene'}
            aria-pressed={expanded}
          >
            <svg viewBox="0 0 20 20" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.7">
              {expanded ? (
                <path d="M12 4H4v8M8 16h8V8M4 4l6 6M16 16l-6-6" strokeLinecap="round" strokeLinejoin="round" />
              ) : (
                <path d="M8 4H4v4M16 8V4h-4M4 12v4h4M16 16h-4v-4" strokeLinecap="round" strokeLinejoin="round" />
              )}
            </svg>
          </button>
        </div>
        <figcaption className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-basalt-950/85 to-transparent px-3 pb-2.5 pt-8 text-xs text-steam-200">
          {caption}
          {spring.temperature.celsius === null && (
            <span className="mt-0.5 block text-[11px] italic text-steam-400">
              No thermometer has visited — the air stays still.
            </span>
          )}
          {weather !== null && (
            <span className="mt-0.5 block text-[10px] text-steam-400" title="Creative Commons Attribution 4.0">
              Live air via Open-Meteo
            </span>
          )}
        </figcaption>
      </div>

      {spring.photos && spring.photos.length > 0 && (
        <div className="flex gap-2 overflow-x-auto border-t border-basalt-800 bg-basalt-950/90 p-3 scroll-slim">
          {spring.photos.map((url) => (
            <img
              key={url}
              src={url}
              alt=""
              loading="lazy"
              className="h-20 shrink-0 rounded-lg border border-basalt-700 object-cover"
            />
          ))}
        </div>
      )}
    </figure>
  );
}
