/**
 * The first thirty seconds.
 *
 * Before this, arriving at the atlas gave you a dark globe, a search box and a
 * filter button -- an interface that assumes you already know what it is and
 * what you want from it. That is fine for the person who built it and useless
 * for someone who likes hot springs and followed a link.
 *
 * So: say what it is, lead with the number that is the whole argument, and
 * offer three ways in rather than a blinking cursor. The honest number goes
 * first on purpose. "One in five has a temperature" reads as a confession and
 * is in fact the product -- every other hot spring site on the internet shows
 * a confident figure for every entry, which means most of those figures are
 * invented.
 *
 * Shown once. `localStorage` because the alternative is an account, and this
 * atlas does not have accounts and is not going to. Every read and write is
 * guarded: a browser with storage blocked gets the panel every visit, which is
 * a mild annoyance rather than a blank page.
 *
 * Never shown over a deep link. Someone who arrives at /s/whs_... or /terms
 * asked for a specific thing, and a splash panel in front of it is an
 * interstitial -- the pattern this project would criticise anyone else for.
 */
import { useEffect, useState } from 'react';
import { useStore } from '../store/useStore';
import { href, parse } from '../lib/router.ts';

const SEEN_KEY = 'whs.welcomed';

/*
 * Whether the visitor arrived at the map itself, read once from the address
 * they arrived at. Deciding it from the store instead showed the greeting
 * over a cold /s/whs_... or /terms, because the store only applies the route
 * once the dataset is in, and until then it says "nothing asked for". It also
 * put the greeting up when a deep-linked card was closed, in front of someone
 * already using the atlas. Module scope, not component state: the panel
 * unmounts while the filter rail is open, and remounting must not re-read an
 * address the visitor has since moved on from.
 *
 * A deep-link visit does not mark the panel seen. The visitor never saw it,
 * so it is still there for them the next time they arrive at the map.
 */
const ARRIVED_AT_MAP = typeof window !== 'undefined' && parse().kind === 'map';

interface Summary {
  total: number;
  countries: number;
  coverage: { temperature: number };
}

function seen(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === '1';
  } catch {
    return false;
  }
}

function markSeen(): void {
  try {
    localStorage.setItem(SEEN_KEY, '1');
  } catch {
    /* Private window, blocked storage. The panel simply returns next visit. */
  }
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-xl border border-basalt-800 bg-basalt-850/60 px-3 py-2.5">
      <div className="text-lg font-semibold tabular-nums leading-none text-steam-100">{value}</div>
      <div className="mt-1.5 text-[10px] uppercase leading-tight tracking-[0.1em] text-steam-500">{label}</div>
    </div>
  );
}

export function WelcomePanel() {
  const springs = useStore((s) => s.springs);
  const loading = useStore((s) => s.loading);
  const error = useStore((s) => s.error);
  const selectedId = useStore((s) => s.selectedId);
  const showAbout = useStore((s) => s.showAbout);
  const page = useStore((s) => s.page);
  const select = useStore((s) => s.select);
  const setPage = useStore((s) => s.setPage);
  const locateMe = useStore((s) => s.locateMe);

  const [open, setOpen] = useState(() => ARRIVED_AT_MAP && !seen());
  const [summary, setSummary] = useState<Summary | null>(null);

  useEffect(() => {
    if (!open) return;
    fetch(`${import.meta.env.BASE_URL}data/summary.json`)
      .then((r) => r.json())
      .then(setSummary)
      .catch(() => setSummary(null));
  }, [open]);

  const dismiss = () => {
    markSeen();
    setOpen(false);
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && dismiss();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // A deep link, a card or a standing page outranks the greeting, always.
  if (!open || selectedId || showAbout || page || error) return null;

  /*
   * A spring worth landing on: one the atlas actually knows something about.
   * Sending someone to a record whose every field says Unknown is a true
   * introduction to the dataset and a terrible one to the project, and the
   * completeness score already ranks exactly this.
   */
  const showMeOne = () => {
    const good = springs.filter((s) => s.temperature.celsius !== null && s.quality.completeness >= 50);
    const pool = good.length ? good : springs;
    if (!pool.length) return;
    const pick = pool[Math.floor(Math.random() * pool.length)];
    dismiss();
    select(pick.id);
  };

  const total = summary?.total ?? springs.length;
  const countries = summary?.countries ?? null;
  const tempPct =
    summary && summary.total ? Math.round((summary.coverage.temperature / summary.total) * 100) : null;

  const action =
    'rounded-xl border px-3.5 py-2.5 text-sm font-medium transition disabled:opacity-40';

  return (
    <div className="animate-rise pointer-events-auto absolute inset-x-3 top-3 z-30 max-h-[calc(100%-24px)] max-w-[420px] overflow-y-auto rounded-2xl border border-basalt-700 bg-basalt-900/95 p-5 shadow-2xl shadow-black/60 backdrop-blur-xl scroll-slim sm:inset-x-auto sm:left-4 sm:top-4 sm:max-h-[calc(100%-32px)] sm:max-w-[420px]">
      <button
        onClick={dismiss}
        aria-label="Close"
        className="absolute right-3 top-3 rounded-lg p-1.5 text-steam-500 transition hover:bg-basalt-800 hover:text-steam-100"
      >
        <svg viewBox="0 0 20 20" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.7">
          <path d="M5 5l10 10M15 5L5 15" strokeLinecap="round" />
        </svg>
      </button>

      <h2 className="pr-8 text-[15px] font-semibold leading-snug text-steam-100">
        Every hot spring the public record knows about.
      </h2>
      <p className="mt-2 text-sm leading-relaxed text-steam-300">
        Temperature, price, clothing policy and opening hours, with the source attached to every
        field — and an explicit <span className="italic text-steam-400">Unknown</span> wherever the
        world has never written one down.
      </p>

      <div className="mt-4 grid grid-cols-3 gap-2">
        <Stat value={total.toLocaleString()} label="Springs" />
        <Stat value={countries ? String(countries) : '—'} label="Countries" />
        <Stat value={tempPct !== null ? `${tempPct}%` : '—'} label="With a reading" />
      </div>

      <p className="mt-3 text-[12px] leading-relaxed text-steam-400">
        That last number is the point. Four springs in five have no published reading anywhere, so
        this atlas says so instead of inventing one. Some springs are also left off deliberately and
        permanently, because the people who look after them asked.
      </p>

      <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
        <button
          onClick={dismiss}
          className={`${action} border-ember/60 bg-ember/15 text-steam-100 hover:border-ember hover:bg-ember/25`}
        >
          Open the map
        </button>
        <button
          onClick={() => {
            dismiss();
            locateMe();
          }}
          className={`${action} border-basalt-700 bg-basalt-850 text-steam-200 hover:border-basalt-600 hover:text-steam-100`}
        >
          Near me
        </button>
        <button
          onClick={showMeOne}
          disabled={loading || springs.length === 0}
          className={`${action} border-basalt-700 bg-basalt-850 text-steam-200 hover:border-basalt-600 hover:text-steam-100`}
        >
          Show me one
        </button>
      </div>

      {/*
        Last, and in the warning colour, because it is the only line here that
        can matter to someone's body. A hot spring atlas that greets you without
        mentioning that geothermal water scalds is selling a day out.
      */}
      <a
        href={href({ kind: 'page', page: 'safety' })}
        onClick={(e) => {
          if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
          e.preventDefault();
          dismiss();
          setPage('safety');
        }}
        className="mt-4 flex items-start gap-2 rounded-xl border border-ember/35 bg-ember/10 px-3 py-2.5 text-[12px] leading-relaxed text-steam-200 transition hover:border-ember/70"
      >
        <svg viewBox="0 0 20 20" className="mt-px size-4 shrink-0 text-ember-bright" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden>
          <path d="M10 3.2 2.8 16h14.4L10 3.2Z" strokeLinejoin="round" />
          <path d="M10 8.2v3.4M10 13.8v.5" strokeLinecap="round" />
        </svg>
        <span>
          Geothermal water scalds and the ground around it can be thin.{' '}
          <span className="font-medium text-ember-bright underline decoration-ember/50 underline-offset-2">
            Read the safety page
          </span>{' '}
          before you go anywhere.
        </span>
      </a>
    </div>
  );
}
