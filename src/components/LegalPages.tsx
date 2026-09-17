/**
 * Terms, privacy and safety.
 *
 * Kept out of AboutPanel deliberately. `scripts/sources.test.mjs` forbids that
 * file from naming any upstream by hand, because the attribution list there
 * must be rendered from the dataset's own metadata or it goes stale — and
 * three pages of prose is exactly the place a hand-typed credit would sneak
 * back in. Everything provider-specific here is rendered from `lib/basemap.ts`
 * or from `meta`, for the same reason.
 *
 * The privacy page is the one that is easy to get wrong by being flattering.
 * "We don't track you" is true and insufficient: this app makes requests to
 * four hosts that are not us, and one of them learns which spring you opened.
 * That is disclosed below in the same voice the cards use for an unknown
 * temperature.
 */
import type { DatasetMeta } from '../lib/types';
import { imagery, TERRAIN, THIRD_PARTIES, WEATHER_TERMS } from '../lib/basemap.ts';
import { STORAGE_KEYS } from '../lib/storage.ts';
import { numberWords } from '../lib/format.ts';
import { useStore } from '../store/useStore';

export type LegalPage = 'terms' | 'privacy' | 'safety';

export const PAGE_TITLES: Record<LegalPage, string> = {
  terms: 'Terms of use',
  privacy: 'Privacy',
  safety: 'Safety',
};

/** Last substantive revision. Shown on the page, because an undated policy is a claim about nothing. */
export const POLICY_UPDATED = '2026-09-17';

function H({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mt-6 text-[11px] font-semibold uppercase tracking-[0.12em] text-steam-400 first:mt-0">
      {children}
    </h3>
  );
}

function P({ children }: { children: React.ReactNode }) {
  return <p className="mt-2 text-sm leading-relaxed text-steam-300">{children}</p>;
}

function List({ children, label }: { children: React.ReactNode; label?: string }) {
  return (
    <ul aria-label={label} className="mt-2 space-y-1.5 text-sm leading-relaxed text-steam-300">
      {children}
    </ul>
  );
}

function Item({ children }: { children: React.ReactNode }) {
  return (
    <li className="relative pl-4 before:absolute before:left-0 before:top-[0.6em] before:size-1 before:rounded-full before:bg-basalt-600">
      {children}
    </li>
  );
}

function Stamp() {
  return (
    <p className="mt-6 border-t border-basalt-800 pt-3 text-[11px] text-steam-400">
      Last updated {POLICY_UPDATED}.
    </p>
  );
}

function Terms({ meta }: { meta: DatasetMeta | null }) {
  // Counted from the loaded records, like the footer's key: this sentence
  // said "Nineteen percent" as typed text, a figure the next batch moves.
  const springs = useStore((s) => s.springs);
  const pct = springs.length
    ? Math.round((springs.filter((s) => s.temperature.celsius !== null).length / springs.length) * 100)
    : 0;
  const coverage =
    pct >= 1 && pct <= 99
      ? `${numberWords(pct).replace(/^./, (c) => c.toUpperCase())} percent of these springs have a recorded temperature and the rest have never had one published`
      : 'Most of these springs have never had a temperature published';
  return (
    <>
      <H>What this is</H>
      <P>
        An open atlas of public and semi-public hot springs, published free of charge with no
        account, no subscription and no advertising. There is nothing to buy here and nothing to
        sign up for.
      </P>

      <H>Two licences, and they are not the same</H>
      <P>
        The <strong className="text-steam-100">software</strong> is MIT licensed. The{' '}
        <strong className="text-steam-100">dataset</strong> is not: it is published under{' '}
        {meta ? (
          <a
            href={meta.licenseUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="text-steam-100 underline decoration-basalt-600 underline-offset-4 hover:decoration-ember"
          >
            {meta.license}
          </a>
        ) : (
          'ODbL 1.0'
        )}
        , which is share-alike. Reuse it and you owe attribution —{' '}
        <span className="text-steam-200">{meta?.attribution ?? '© OpenStreetMap contributors'}</span>{' '}
        — and any database you derive from it inherits the same terms. Taking the data and
        relicensing it as your own is the one use this project will pursue.
      </P>
      <P>
        Bulk copies are welcome and do not require permission: the whole dataset is a single
        GeoJSON file served from this site. Scraping the interface one card at a time is slower for
        you and more expensive for us, so please don't.
      </P>

      <H>What is not promised</H>
      <P>
        The atlas is provided as it is, with no warranty of any kind. {coverage}; that is
        stated on every card and it is not a defect being worked on. Prices, hours, access rules
        and clothing policies change without telling us, some records were last checked decades
        ago by their original publisher, and coordinates vary in precision by source.
      </P>
      <List>
        <Item>
          <strong className="text-steam-200">No claim of legal access.</strong> A pin is not
          permission. Land ownership, permits, seasonal closures and local regulations are yours to
          verify before you go.
        </Item>
        <Item>
          <strong className="text-steam-200">No claim of safety.</strong> See the safety page. This
          atlas is not a guide service, an inspection authority, or a rescue service.
        </Item>
        <Item>
          <strong className="text-steam-200">No liability.</strong> To the fullest extent the law
          allows, the project and its contributors are not liable for any loss, injury or damage
          arising from use of this site or its data. You use it at your own risk.
        </Item>
      </List>

      <H>Acceptable use</H>
      <List>
        <Item>Do not present this data as official, governmental, or independently verified. It is none of those.</Item>
        <Item>
          Do not use this project — its data, its interface, or its contributors — to identify,
          infer or publicise a spring that has been deliberately excluded. That exclusion is the
          point of the project and defeating it is the one thing that gets a reuse called out in
          public.
        </Item>
        <Item>Do not hammer the site with automated requests. Download the file instead.</Item>
      </List>

      <H>Removal</H>
      <P>
        If you look after a spring on this map, or you are part of the community around one, and
        you want it gone, it goes. You do not need to prove ownership and you do not need to
        justify it. Removal is permanent and survives future data imports, because exclusions are
        stored by geographic radius rather than by upstream id. Contact us privately if a public
        request would itself draw attention to the place.
      </P>
      <P>
        Versioned releases of the dataset are archived on Zenodo under a DOI, and an archived
        version cannot be altered, any more than the repository's history can. Removal applies to
        the live atlas, to the repository from that point on, and to every later version.
        If the spring is already in an archived version, we will ask Zenodo to restrict access to
        the affected files; that is Zenodo's decision, and it may or may not be granted. Pending
        requests are handled before any release is made, so a request that reaches us in time
        never enters an archive.
      </P>

      <H>Changes and governing law</H>
      <P>
        These terms may change; the date below is the last substantive revision and the history is
        public in the repository. The project is operated from Colorado, United States, and these
        terms are governed by Colorado law.
      </P>
      <Stamp />
    </>
  );
}

function Privacy() {
  return (
    <>
      <H>The short version</H>
      <P>
        No accounts. No tracking cookies. No analytics. No advertising, no third-party tags, no
        fingerprinting, and nothing sold or shared. We do not build a profile of you because we do
        not collect anything to build one from.
      </P>

      <H>What stays in your browser</H>
      {/*
        Rendered from lib/storage.ts, the one list of keys the code writes.
        This paragraph used to name one key and call it the only one, while
        the welcome panel wrote a second.
      */}
      <P>
        These keys in your browser's local storage are everything this site writes to your device.
        They never leave it, and clearing your site data removes them.
      </P>
      <List label="Stored on your device">
        {STORAGE_KEYS.map((s) => (
          <Item key={s.key}>
            <strong className="text-steam-200">{s.title}</strong>{' '}
            <code className="text-steam-200">{s.key}</code>: {s.purpose}
          </Item>
        ))}
      </List>
      <List>
        <Item>
          <strong className="text-steam-200">Your location, if you ask for it.</strong> Pressing
          "near me" asks your browser for a coordinate and sorts the list by distance. The
          coordinate is used in the page and is never transmitted — not to us, not to anyone. It
          is gone when you close the tab.
        </Item>
      </List>

      <H>Who else your browser talks to</H>
      <P>
        This is the part most privacy policies leave out. The map is assembled from tiles and
        readings served by other organisations, and a request to any of them reveals your IP
        address to that organisation, as every web request does.
      </P>
      <div className="mt-3 overflow-hidden rounded-xl border border-basalt-800">
        {THIRD_PARTIES.map((t, i) => (
          <div
            key={t.host}
            className={`px-3 py-2.5 ${i > 0 ? 'border-t border-basalt-800' : ''}`}
          >
            <code className="text-xs text-steam-200">{t.host}</code>
            <p className="mt-0.5 text-[11px] leading-relaxed text-steam-400">
              {t.what} — contacted {t.when}
            </p>
          </div>
        ))}
      </div>
      <P>
        One of those deserves naming plainly: the current-conditions reading on a spring card is
        fetched per spring, using that spring's coordinates. So the weather provider can infer
        which spring you opened, in a way the tile providers cannot. If that matters to you, the
        card works without it — block the request and the reading simply renders as unavailable.
      </P>

      <H>Hosting and logs</H>
      <P>
        The site is static files on a commercial host. Like any web server, that host records
        standard request logs — IP address, timestamp, path, user agent — which we do not query,
        export, or join to anything. We have added no logging of our own on top of it.
      </P>

      <H>Rights</H>
      <P>
        There is no account to delete and no export to request, because there is no record of you
        to delete or export. If you believe otherwise, write to us and we will look.
      </P>

      <H>Two different things called privacy</H>
      <P>
        This page is about <em>your</em> privacy as a visitor. The project also has an editorial
        privacy rule — which springs are deliberately kept off the map, permanently, at the request
        of the people who live near them. That one is explained in the About panel and in the
        repository, and it is the more important of the two.
      </P>
      <Stamp />
    </>
  );
}

function Safety() {
  return (
    <>
      <div className="rounded-xl border-2 border-ember bg-ember/15 px-4 py-3">
        <p className="text-sm font-semibold leading-relaxed text-steam-100">
          Geothermal water scalds, and undeveloped sources have no staff, no signage and no rescue.
          Every figure in this atlas is a starting point, not a guarantee. Test the water before
          you get in.
        </p>
      </div>

      <H>Heat</H>
      <P>
        Source temperature is not pool temperature, and neither is stable. Flow and mixing shift
        with rainfall, snowmelt and season, so a pool that was pleasant last spring can be
        dangerous this week. Water above roughly 45 °C causes burns with surprising speed, and the
        hottest springs in this dataset are at or above boiling. Where a card distinguishes source
        from pool, read it: a 75 °C source is a burn, not a bath.
      </P>

      <H>Ground</H>
      <P>
        In active geothermal areas the crust over a thermal feature can be thin enough to break
        under a footstep, with near-boiling water beneath. This is how people are most often
        seriously injured in geothermal basins. Stay on boardwalks and established ground where
        they exist, and treat unfamiliar sinter and mud as unsafe.
      </P>

      <H>Water you should not put your head under</H>
      <P>
        Untreated warm freshwater can carry <em>Naegleria fowleri</em>, an amoeba that causes a
        rare and almost always fatal brain infection when water is forced up the nose. Infection
        does not come from swallowing it. The practical rule from public-health guidance is to keep
        your head above water in untreated geothermal pools, and to avoid diving, jumping and
        submerging. Thermal water can also carry bacteria that infect open wounds.
      </P>

      <H>Air</H>
      <P>
        Hydrogen sulfide collects in enclosed or low-lying spots around sulfur springs. It smells
        of rotten eggs at low concentrations and then stops smelling of anything as it deadens your
        sense of smell — so the smell going away is a reason to leave, not a reassurance.
      </P>

      <H>Your body</H>
      <P>
        Long soaks in hot water raise core temperature and drop blood pressure; fainting while
        alone in a pool is a drowning. Alcohol makes all of that worse and is a factor in a large
        share of hot spring deaths. Pregnancy, cardiovascular conditions and some medications
        change the risk substantially — that is a conversation with a clinician, not with a map.
      </P>

      <H>Remoteness</H>
      <P>
        Most wild springs have no phone signal, no address to give a dispatcher, and an access
        track that a tow truck will not attempt. Tell someone where you are going. Assume you are
        your own first responder.
      </P>

      <H>What this atlas is not</H>
      <P>
        It is not an inspection, a certification, or a recommendation. A spring appearing here means
        public sources place it there — nothing more. Where a land manager prohibits entering the
        water, the card says so before anything else, and that prohibition is not advisory.
      </P>
      <Stamp />
    </>
  );
}

/** Provider terms, rendered from config so the credit cannot drift from what ships. */
export function BasemapCredits() {
  return (
    <>
      {imagery && <span>{imagery.terms} </span>}
      <span>{TERRAIN.terms} </span>
      <span>{WEATHER_TERMS}</span>
    </>
  );
}

export function LegalPages({ page, meta }: { page: LegalPage; meta: DatasetMeta | null }) {
  if (page === 'terms') return <Terms meta={meta} />;
  if (page === 'privacy') return <Privacy />;
  return <Safety />;
}
