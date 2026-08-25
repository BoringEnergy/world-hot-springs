# Hot Springs Atlas — Product Specification

1. Vision & Core Philosophy

Build a beautiful, respectful, high-quality global atlas of public and semi-public hot springs.  
We create and own our own curated dataset.  
Critical rule (non-negotiable): Truly hidden local gems and “unicorns” are deliberately excluded from the public map and dataset. We never track, index, geocode, or expose them. This privacy stance is a deliberate product moat and ethical foundation. If a spring is known only to locals and the owners/community do not want wider exposure, it stays off the map forever.

2. Repository Bootstrap Instructions for the Agent

* Create a fresh public GitHub repository named r world-hot-springs.  
* Initialize with a modern web stack (recommendation below).  
* Repo needs massive customization post fork: [https://github.com/bilawalsidhu/gods-eye-view](https://github.com/bilawalsidhu/gods-eye-view). Short term: customize or reference it only for conceptual ideas (3D globe, Cesium, modular data layers, voice optional later).  
* First commit should contain this specification as SPEC.md plus a clean README.

3. Core Data Model (Our Own Dataset)

Every entry is a HotSpring object with the following fields. Unknown values must be explicitly stored and displayed as “Unknown” (never invent or leave blank).  
ts  
interface HotSpring {  
  id: string;                    // stable UUID or slug  
  name: string;  
  location: {  
    lat: number;  
    lng: number;  
    elevation?: number;          // meters  
    country: string;  
    region?: string;  
    nearestTown?: string;  
  };  
  temperature: {  
    celsius: number | null;  
    fahrenheit: number | null;   // always store both or compute on the fly  
    source?: string;             // where the measurement came from  
    measuredAt?: string;         // ISO date if known  
  };  
  access: {  
    price: string | null;        // e.g. "Free", "$15 USD", "Donation", "Unknown"  
    currency?: string;  
    notes?: string;  
  };  
  clothing: {  
    policy: "optional" | "required" | "textile-only" | "mixed" | "unknown";  
    schedule?: string;           // e.g. "Clothing optional after 8pm", "Mixed days: Tue/Thu"  
    notes?: string;  
  };  
  hours: {  
    open: string | null;         // free-form or structured "06:00-22:00"  
    seasonalNotes?: string;  
    status: "open" | "seasonal" | "closed" | "unknown";  
  };  
  type: "natural" | "developed" | "resort" | "wild" | "unknown";  
  unicorn: false;                // ALWAYS false in the public dataset. True unicorns are never stored.  
  verified: boolean;  
  lastVerified: string;          // ISO date  
  sources: string[];             // array of public source URLs or citations  
  photos?: string[];             // only public, permissioned images  
  description?: string;  
  tags?: string[];               // e.g. ["sulfur", "scenic", "family-friendly"]  
  warnings?: string[];           // safety, access, environmental  
}

4. Dataset Strategy

* We build and maintain our own curated GeoJSON / JSON / SQLite / Postgres dataset.  
* Start by ingesting and cleaning public sources only (OpenStreetMap natural=hot_spring, digitized Waring 1965 dataset, national open lists, official tourism boards, peer-reviewed papers).  
* Every record must be manually or semi-automatically reviewed.  
* Add a clear “Data Quality” flag and provenance.  
* Community contribution flow later: users can suggest new public springs or corrections, but every submission is reviewed and unicorn candidates are rejected or kept private.  
* Explicit exclusion list (private, never committed): any spring flagged by locals/owners as “do not publicize”.  
* Temperature is stored in both °C and °F (or computed live). UI has a global toggle.

5. Product Features (MVP → v1)

Map & Exploration

* Interactive 3D globe or high-quality 2D/3D map (CesiumJS or MapLibre + 3D tiles preferred for “wow” factor).  
* Points colored by temperature band.  
* Click → rich detail card showing all fields above. Unknown fields render as “Unknown”.  
* Filters: temperature range, price (free / paid / unknown), clothing policy, hours/open now, country/region, type.  
* Search by name or nearest to me.  
* “Unicorn mode” does not exist in the public product. There is no way to request or reveal hidden springs.

Units & Display

* Global toggle: °C ↔ °F (persisted in localStorage).  
* Price shown in local currency when possible + USD equivalent optional.  
* Clothing schedule shown clearly when available.

Respect & Ethics Layer

* In the UI and README: clear statement that we intentionally omit true local secrets and unicorns.  
* No reverse-engineering, scraping of private forums, or user-submitted “secret” locations without explicit public permission.  
* If someone tries to add a known unicorn, the system rejects it with a respectful message.

6. Recommended Tech Stack (Agent should follow unless strongly justified otherwise)

* Frontend: Vite + TypeScript + React (or Svelte)  
* Map: CesiumJS (for 3D globe) or MapLibre GL JS + 3D terrain  
* Data: Start with static GeoJSON + simple JSON API; later move to a lightweight backend (Hono / Fastify + SQLite or Postgres)  
* Styling: Tailwind + clean modern design  
* State: Zustand or similar  
* Deployment: Vercel / Cloudflare Pages ready  
* License: MIT or Apache-2.0 for code; dataset under a clear open license with attribution requirements

7. Non-Goals (explicitly out of scope for v1)

* Tracking or displaying true unicorns / hidden local-only springs  
* Real-time occupancy or live camera feeds  
* User accounts with private lists of secrets  
* Commercial booking engine  
* Aggressive SEO of every tiny spring

8. Implementation Phases for the Agent

Phase 0 – Repo & Spec  
Create the repo, put this SPEC.md in the root, write a clear README explaining the privacy philosophy.Phase 1 – Data Foundation

* Design the schema.  
* Ingest and clean the first 1–2k high-quality public records.  
* Generate a clean data/hot-springs.geojson.  
* Document every source and cleaning step.

Phase 2 – Core Map UI

* Globe/map with points.  
* Detail panel with all fields.  
* °C/°F toggle.  
* Basic filters.

Phase 3 – Polish & Ethics

* Unknown-state handling.  
* Privacy statement.  
* Contribution guidelines that protect unicorns.  
* Basic search and “near me”.

Phase 4+ (later)  
Voice, offline support, community moderation, mobile PWA, etc.

9. Success Criteria

* A visitor can explore thousands of real, public hot springs with transparent data quality.  
* Temperature, price, clothing policy, and hours are first-class and clearly labeled when unknown.  
* Zero public exposure of true unicorns.  
* The dataset is ours, versioned, and attributable.  
* The product feels respectful and delightful.

