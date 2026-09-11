/**
 * Every upstream this atlas draws from, and the terms it comes under.
 *
 * ONE definition, read by the GeoJSON metadata and asserted against DATA.md
 * by a test. This repository has been bitten three times by a second copy of
 * a fact -- the completeness scorer, the TSV numeric list, a text-column list
 * restated in a test -- and an attribution that drifts from what actually
 * shipped is the version of that mistake with legal weight.
 *
 * `provider` matches `quality.provenance`, so a source cannot be listed here
 * without the pipeline naming it, and a test checks both directions.
 */
export const UPSTREAMS = [
  {
    provider: 'osm',
    name: 'OpenStreetMap',
    role: 'Base layer. Placed the great majority of the pins.',
    licence: 'ODbL 1.0',
    licenceUrl: 'https://opendatacommons.org/licenses/odbl/1-0/',
    attribution: '© OpenStreetMap contributors',
    url: 'https://www.openstreetmap.org/',
  },
  {
    provider: 'ncei',
    name: 'NOAA NCEI, Thermal Springs List for the United States (1981)',
    role: 'Minted 1,023 US pins and corroborated others. doi:10.25921/c8p0-zs06',
    licence: 'CC0 1.0',
    licenceUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
    attribution: 'NOAA National Centers for Environmental Information',
    url: 'https://doi.org/10.25921/c8p0-zs06',
  },
  {
    provider: 'aist',
    name: 'AIST/GSJ, Geochemical Map of Hot Spring Waters (GRES-DB ONSEN 2020)',
    // The one upstream whose licence REQUIRES attribution rather than merely
    // inviting it, which is why this file exists at all.
    role: 'Japanese wellhead temperatures, chemistry and Hot Spring Law classifications.',
    licence: '政府標準利用規約 第2.0版 (CC BY 4.0 compatible), attribution required',
    licenceUrl: 'https://www.gsi.go.jp/kikakuchousei/kikakuchousei40182.html',
    attribution: 'Geological Survey of Japan, AIST',
    url: 'https://gbank.gsj.jp/gres-db/',
  },
  {
    provider: 'wqp',
    name: 'Water Quality Portal (USGS / EPA / NWQMC)',
    role: 'US spring temperatures.',
    licence: 'US federal government work, public domain',
    licenceUrl: 'https://www.usa.gov/government-works',
    attribution: 'US Geological Survey, US Environmental Protection Agency and the National Water Quality Monitoring Council',
    url: 'https://www.waterqualitydata.us/',
  },
  {
    provider: 'nbmg',
    name: 'Nevada Bureau of Mines and Geology, AASG state geothermal data',
    role: 'Nevada and Colorado spring chemistry.',
    licence: 'US state geological survey data, public domain',
    licenceUrl: 'https://www.usa.gov/government-works',
    attribution: 'Nevada Bureau of Mines and Geology, University of Nevada, Reno',
    url: 'https://web2.nbmg.unr.edu/ArcGIS/rest/services/',
  },
];

/**
 * The collection's own terms.
 *
 * ODbL, because ODbL is share-alike and OpenStreetMap is in here. Mixing a
 * share-alike database with public-domain and CC BY sources does not dilute
 * the share-alike obligation, so the derived database inherits the strictest
 * term rather than the most convenient one.
 */
export const COLLECTION_LICENCE = 'ODbL 1.0';
export const COLLECTION_LICENCE_URL = 'https://opendatacommons.org/licenses/odbl/1-0/';

/** One line naming everyone who must be named. */
export function attributionLine() {
  return UPSTREAMS.map((u) => u.attribution).join('; ');
}

/** The block that goes in the GeoJSON's `metadata`. */
export function licenceMetadata() {
  return {
    license: COLLECTION_LICENCE,
    licenseUrl: COLLECTION_LICENCE_URL,
    licenseNote:
      'ODbL because OpenStreetMap is share-alike; the other sources are public domain or CC BY-compatible and impose no stricter term.',
    attribution: attributionLine(),
    // British spelling inside this repository, American in the emitted
    // GeoJSON, because `license` is what every consumer of a FeatureCollection
    // looks for. The mapping is explicit on both keys so the two spellings
    // cannot silently pass an undefined between them.
    sources: UPSTREAMS.map((u) => ({
      provider: u.provider,
      name: u.name,
      license: u.licence,
      licenseUrl: u.licenceUrl,
      attribution: u.attribution,
      url: u.url,
    })),
  };
}
