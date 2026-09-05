import { useEffect, useRef } from 'react';
import maplibregl, { type MapGeoJSONFeature } from 'maplibre-gl';
import type { HotSpring } from '../lib/types';
import { TEMP_BANDS, UNKNOWN_TEMP_COLOR } from '../lib/types';
import { useStore } from '../store/useStore';

const SOURCE = 'springs';
const HEAT_SOURCE = 'springs-heat';
const SATELLITE = 'satellite';
const TERRAIN = 'terrain';

/**
 * The basemap ladder: CARTO dark-matter carries the globe and regional views,
 * Esri World Imagery crossfades in for the close descent. Both are keyless,
 * so the atlas keeps its no-token philosophy — attribution is the price, paid
 * in the map control (via the source option) and the About panel.
 */
const SAT_TILES = [
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
];
const SAT_ATTRIBUTION = 'Imagery © Esri, Maxar, Earthstar Geographics';
// Zoom stops for the dark-to-satellite crossfade. Keep in sync with the
// data-sat threshold on the vignette below.
const SAT_FADE_NEAR = 8;
const SAT_FADE_FAR = 10;
// Terrain wakes up as satellite arrives: 3D relief only matters once you can
// see the ground, and keeping it off on the globe view saves DEM tiles.
const TERRAIN_ZOOM = 8.5;
const TERRAIN_TILES = [
  'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png',
];

/**
 * CARTO's dark basemap is keyless and free, so the atlas has no API-token
 * dependency and nothing to leak. Attribution is rendered by MapLibre's own
 * control from the style, and repeated in the About panel.
 */
const STYLE = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';

/**
 * Colour ramp driven by the same bands the legend and filters use, expressed as
 * a MapLibre step expression so every point is coloured on the GPU rather than
 * in JS. Parameterised by the value expression so clusters can colour by their
 * mean temperature with the identical ramp.
 */
function tempColorExpression(value: unknown[] = ['get', 'tc']) {
  // step(tc, coolColor, 30, warmColor, 38, hotColor, ...)
  const step: unknown[] = ['step', value, TEMP_BANDS[0].color];
  TEMP_BANDS.forEach((band, i) => {
    const next = TEMP_BANDS[i + 1];
    if (!next) return;
    step.push(band.maxC, next.color);
  });
  // -999 is the "no reading" sentinel; it must not fall through to the coolest
  // band, or every unmeasured spring would render as a cold one.
  return ['case', ['==', value, -999], UNKNOWN_TEMP_COLOR, step] as never;
}

/**
 * A cluster's warmth is the mean of its measured members. Unmeasured members
 * contribute to neither the sum nor the count, so a hundred Unknowns around
 * one hot spring do not dilute it — and a cluster with no readings at all
 * keeps the -999 sentinel and renders as Unknown, not as cold.
 */
function clusterMeanTemp(): unknown[] {
  return [
    'case',
    ['==', ['get', 'nTc'], 0],
    -999,
    ['/', ['get', 'sumTc'], ['get', 'nTc']],
  ];
}

/** Faint atlas graticule so the dark globe reads as an instrument, not a void. */
function graticule(): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  for (let lng = -180; lng < 180; lng += 20) {
    features.push({
      type: 'Feature',
      id: undefined,
      geometry: { type: 'LineString', coordinates: [[lng, -84], [lng, 84]] },
      properties: {},
    });
  }
  for (let lat = -80; lat <= 80; lat += 20) {
    features.push({
      type: 'Feature',
      id: undefined,
      geometry: { type: 'LineString', coordinates: [[-180, lat], [180, lat]] },
      properties: {},
    });
  }
  return { type: 'FeatureCollection', features };
}

function toFeatureCollection(springs: HotSpring[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: springs.map((s) => ({
      type: 'Feature',
      id: undefined,
      geometry: { type: 'Point', coordinates: [s.location.lng, s.location.lat] },
      properties: {
        id: s.id,
        name: s.name ?? 'Unnamed spring',
        // -999 is the sentinel for "no reading". Using it rather than null keeps
        // the value numeric so MapLibre's step expression stays valid.
        tc: s.temperature.celsius ?? -999,
      },
    })),
  };
}

export function MapView() {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const ready = useRef(false);
  // Generation counter for camera flights: any user-initiated move bumps it,
  // so a stale chained leg can recognise it lost the race and stand down.
  const flight = useRef(0);

  const visible = useStore((s) => s.visible);
  const selectedId = useStore((s) => s.selectedId);
  const select = useStore((s) => s.select);
  const userLocation = useStore((s) => s.userLocation);

  // --- init ---
  useEffect(() => {
    if (!container.current || map.current) return;

    const m = new maplibregl.Map({
      container: container.current,
      style: STYLE,
      center: [20, 20],
      // Framed so the globe fills the viewport rather than floating in it.
      // minZoom stops it being shrunk to a dot in the middle of black space.
      zoom: 2.3,
      minZoom: 1.6,
      maxZoom: 16,
      attributionControl: { compact: true },
    });

    if (import.meta.env.DEV) {
      document.documentElement.dataset.mapPhase = 'constructed';
      m.on('styledata', () => (document.documentElement.dataset.mapPhase = 'styledata'));
      m.on('error', (e) => {
        document.documentElement.dataset.mapError = String(e?.error?.message ?? e);
      });
    }

    m.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'bottom-right');
    m.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');
    m.dragRotate.enable();

    /**
     * Layer setup keys off the style being ready, not the `load` event.
     *
     * `load` requires the first frame to have been painted, so in any context
     * where the page is not compositing — a background tab, a hidden pane, an
     * automated check — it never fires and the springs layer is never added.
     * `styledata` only needs the style itself, which is the actual
     * precondition for addSource/addLayer.
     */
    let initialised = false;
    const setup = () => {
      // The precondition for addSource/addLayer is a parsed style, which is
      // what getStyle() reflects. isStyleLoaded() additionally waits on every
      // source, and that can stay false indefinitely when nothing is painting.
      if (initialised || !m.getStyle()?.layers) return;
      initialised = true;

      // Globe is set here, not as a constructor option — MapLibre v5 has no
      // `projection` map option, so passing one is silently ignored and you get
      // Mercator. It also has to come after the style, which would otherwise
      // overwrite it.
      //
      // Mercator is actively misleading for this dataset: it inflates Iceland
      // and Kamchatka and squashes the equatorial belt, so the geothermal
      // pattern reads as "hot springs are a northern thing". They are not.
      m.setProjection({ type: 'globe' });

      // Ember atmosphere: near-black zenith, scorched horizon. The blend
      // eases off as you descend so satellite close-ups read as daylight.
      m.setSky({
        'sky-color': '#060504',
        'horizon-color': '#46230f',
        'fog-color': '#0b0a09',
        'fog-ground-blend': 0.6,
        'horizon-fog-blend': 0.5,
        'sky-horizon-blend': 0.55,
        'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 1, 12, 0],
      });

      m.addSource(SOURCE, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
        // Clusters take over the regional view; clusterMaxZoom matches the
        // label layer's minzoom so points resolve just as names appear.
        cluster: true,
        clusterRadius: 56,
        clusterMaxZoom: 7,
        clusterProperties: {
          sumTc: ['+', ['case', ['==', ['get', 'tc'], -999], 0, ['get', 'tc']]],
          nTc: ['+', ['case', ['==', ['get', 'tc'], -999], 0, 1]],
        },
      });

      // The heat bloom reads the same points unclustered: a heatmap over
      // clustered features would double-count through point_count and smear
      // the geothermal pattern.
      m.addSource(HEAT_SOURCE, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });

      m.addSource(SATELLITE, {
        type: 'raster',
        tiles: SAT_TILES,
        tileSize: 256,
        maxzoom: 19,
        attribution: SAT_ATTRIBUTION,
      });

      // Keyless elevation: Mapzen terrain tiles on AWS Open Data, terrarium
      // encoding. The source is registered up front; setTerrain switches it
      // on past TERRAIN_ZOOM (see onZoom) so the globe view pays nothing.
      m.addSource(TERRAIN, {
        type: 'raster-dem',
        tiles: TERRAIN_TILES,
        encoding: 'terrarium',
        tileSize: 256,
        maxzoom: 15,
        attribution: 'Terrain: Mapzen Terrain Tiles (AWS Open Data)',
      });

      // Soft outer glow: reads as heat without drawing a literal steam sprite.
      // Clustered features are excluded — the cluster circle below speaks
      // for them, and double-rendering would halo every dense region.
      m.addLayer({
        id: 'springs-glow',
        type: 'circle',
        source: SOURCE,
        filter: ['!', ['has', 'point_count']],
        paint: {
          'circle-color': tempColorExpression(),
          'circle-blur': 1,
          'circle-opacity': 0.35,
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 1, 4, 6, 9, 12, 22],
        },
      });

      m.addLayer({
        id: 'springs',
        type: 'circle',
        source: SOURCE,
        filter: ['!', ['has', 'point_count']],
        paint: {
          'circle-color': tempColorExpression(),
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 1, 1.8, 6, 4, 12, 9],
          'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 4, 0, 7, 1],
          'circle-stroke-color': 'rgba(11,10,9,0.85)',
        },
      });

      // Selection ring, driven by a filter rather than a second source.
      m.addLayer({
        id: 'springs-selected',
        type: 'circle',
        source: SOURCE,
        filter: ['==', ['get', 'id'], ''],
        paint: {
          'circle-color': 'transparent',
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 1, 6, 8, 12, 14, 20],
          'circle-stroke-width': 2,
          'circle-stroke-color': '#f5efe5',
        },
      });

      // Labels only once you are close enough for them to mean something.
      // Unclustered points only: past clusterMaxZoom every point is its own
      // feature, so the filter is a no-op exactly where labels appear.
      m.addLayer({
        id: 'springs-label',
        type: 'symbol',
        source: SOURCE,
        minzoom: 7,
        filter: ['!', ['has', 'point_count']],
        layout: {
          'text-field': ['get', 'name'],
          'text-size': 11,
          'text-offset': [0, 1.1],
          'text-anchor': 'top',
          'text-font': ['Open Sans Regular', 'Noto Sans Regular'],
          'text-optional': true,
        },
        paint: {
          'text-color': '#e4dcd1',
          'text-halo-color': '#0b0a09',
          'text-halo-width': 1.4,
        },
      });

      // Cluster discs, coloured by the members' mean temperature on the same
      // ramp as everything else — a hot region glows hot, an unmeasured one
      // stays steam-grey rather than pretending to be cold.
      m.addLayer({
        id: 'clusters',
        type: 'circle',
        source: SOURCE,
        filter: ['has', 'point_count'],
        paint: {
          'circle-color': tempColorExpression(clusterMeanTemp()),
          'circle-radius': [
            'interpolate',
            ['linear'],
            ['get', 'point_count'],
            10, 13,
            100, 19,
            750, 27,
          ],
          'circle-opacity': 0.88,
          'circle-stroke-width': 1.5,
          'circle-stroke-color': 'rgba(11,10,9,0.9)',
        },
      });

      m.addLayer({
        id: 'cluster-count',
        type: 'symbol',
        source: SOURCE,
        filter: ['has', 'point_count'],
        layout: {
          'text-field': ['get', 'point_count_abbreviated'],
          'text-size': 11,
          // Same stacks as the spring labels: these glyphs provably exist in
          // the CARTO style, so counts never render as tofu.
          'text-font': ['Open Sans Regular', 'Noto Sans Regular'],
        },
        paint: {
          'text-color': '#f5efe5',
          'text-halo-color': '#0b0a09',
          'text-halo-width': 1.2,
        },
      });

      // Satellite imagery, crossfading in across the descent band. minzoom
      // starts prefetching one level early so tiles are already arriving when
      // the fade begins; raster-fade-duration is zero because the
      // zoom-interpolated opacity IS the fade — the built-in fade would lag it.
      // Inserted beneath the springs layers: imagery is the ground, never the
      // subject, so points and labels stay legible over bright terrain.
      m.addLayer(
        {
          id: 'satellite',
          type: 'raster',
          source: SATELLITE,
          minzoom: SAT_FADE_NEAR - 1,
          paint: {
            'raster-opacity': [
              'interpolate',
              ['linear'],
              ['zoom'],
              SAT_FADE_NEAR,
              0,
              SAT_FADE_FAR,
              1,
            ],
            'raster-fade-duration': 0,
          },
        },
        'springs-glow',
      );

      // Geothermal bloom for the planetary view: unmeasured springs carry no
      // weight, so grey unknowns never masquerade as heat. Fades out as
      // clusters take over the regional view; maxzoom 5 is a backstop.
      m.addLayer(
        {
          id: 'springs-heat',
          type: 'heatmap',
          source: HEAT_SOURCE,
          maxzoom: 5,
          paint: {
            'heatmap-weight': [
              'case',
              ['==', ['get', 'tc'], -999],
              0,
              ['interpolate', ['linear'], ['get', 'tc'], 0, 0.15, 40, 0.7, 60, 1],
            ],
            'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 1, 0.9, 4, 2.2],
            'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 1, 14, 4, 34],
            'heatmap-color': [
              'interpolate',
              ['linear'],
              ['heatmap-density'],
              0, 'rgba(11,10,9,0)',
              0.25, '#3a1c10',
              0.5, '#7e3418',
              0.72, '#d9663a',
              0.9, '#e0a33a',
              1, '#f5efe5',
            ],
            'heatmap-opacity': ['interpolate', ['linear'], ['zoom'], 1, 0.85, 3.5, 0.5, 4.5, 0],
          },
        },
        'satellite',
      );

      m.addSource('graticule', { type: 'geojson', data: graticule() });
      m.addLayer(
        {
          id: 'graticule',
          type: 'line',
          source: 'graticule',
          paint: {
            'line-color': '#4a413c',
            'line-opacity': 0.3,
            'line-width': 1,
          },
        },
        'satellite',
      );

      const onEnter = () => (m.getCanvas().style.cursor = 'pointer');
      const onLeave = () => (m.getCanvas().style.cursor = '');
      m.on('mouseenter', 'springs', onEnter);
      m.on('mouseleave', 'springs', onLeave);
      m.on('mouseenter', 'clusters', onEnter);
      m.on('mouseleave', 'clusters', onLeave);

      // The vignette deepens once satellite takes over (see index.css), so
      // bright daylight imagery keeps the ember-on-basalt mood at its edges.
      // Terrain toggles on the same descent: threshold-crossing only, so we
      // never thrash setTerrain mid-gesture.
      let terrainOn = false;
      const onZoom = () => {
        const z = m.getZoom();
        if (container.current) {
          container.current.dataset.sat = z >= SAT_FADE_NEAR ? 'on' : '';
        }
        const want = z >= TERRAIN_ZOOM;
        if (want !== terrainOn) {
          terrainOn = want;
          if (want) m.setTerrain({ source: TERRAIN, exaggeration: 1.15 });
          else m.setTerrain(null);
        }
      };
      m.on('zoom', onZoom);
      onZoom();
      // A user grabbing the camera wins over any scripted flight in progress.
      // Programmatic moves carry no originalEvent, so this fires only for the
      // human — the chained arrival leg checks the counter and stands down.
      m.on('movestart', (e) => {
        if (e.originalEvent) flight.current += 1;
      });

      m.on('click', 'springs', (e) => {
        const f = e.features?.[0] as MapGeoJSONFeature | undefined;
        if (f?.properties?.id) select(String(f.properties.id));
      });
      // A cluster click drills in rather than selecting: the expansion zoom
      // is computed from the actual members, so one click lands exactly
      // where the cluster resolves into points.
      m.on('click', 'clusters', (e) => {
        const f = e.features?.[0];
        const clusterId = f?.properties?.cluster_id;
        const geometry = f?.geometry;
        if (typeof clusterId !== 'number' || geometry?.type !== 'Point') return;
        const src = m.getSource(SOURCE) as maplibregl.GeoJSONSource;
        const center = geometry.coordinates as [number, number];
        void src.getClusterExpansionZoom(clusterId).then((zoom) => {
          // A drill-in is a new intention: cancel any descent in progress.
          flight.current += 1;
          m.easeTo({ center, zoom, duration: 700 });
        });
      });
      // Clicking empty ocean closes the card.
      m.on('click', (e) => {
        const hits = m.queryRenderedFeatures(e.point, { layers: ['springs', 'clusters'] });
        if (hits.length === 0) select(null);
      });

      ready.current = true;
      map.current = m;
      // Dev-only introspection. The data attribute (rather than a window global)
      // is deliberate: automated checks often run in an isolated JS world where
      // page globals are invisible, but the DOM is shared.
      if (import.meta.env.DEV) {
        (window as unknown as { __map?: maplibregl.Map }).__map = m;
        const report = () => {
          document.documentElement.dataset.mapReady = String(m.loaded());
          document.documentElement.dataset.mapPoints = String(
            m.queryRenderedFeatures({ layers: ['springs'] }).length,
          );
        };
        m.on('idle', report);
        report();
      }
      // Push whatever the store already has. Both point sources carry the
      // same data: the clustered one for points, the plain one for the heat
      // bloom (see the layer setup for why they must stay separate).
      const data = toFeatureCollection(useStore.getState().visible);
      (m.getSource(SOURCE) as maplibregl.GeoJSONSource)?.setData(data);
      (m.getSource(HEAT_SOURCE) as maplibregl.GeoJSONSource)?.setData(data);
    };

    m.on('styledata', setup);
    m.on('load', setup);
    setup();

    map.current = m;
    return () => {
      m.remove();
      map.current = null;
      ready.current = false;
    };
  }, [select]);

  // --- idle drift ---
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    // After 10s untouched, the globe turns over slowly — a living planet, not
    // a paused video. Any interaction, any selection, any zoom past the
    // regional view, or reduced-motion stops it. The per-frame guard (rather
    // than only a start-time check) is what keeps a mid-spin select from
    // fighting the camera flight: the next frame simply declines.
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let spinRaf = 0;
    let lastInteract = Date.now();
    let retryTimer = 0;
    const stopSpin = () => {
      cancelAnimationFrame(spinRaf);
      spinRaf = 0;
      window.clearTimeout(retryTimer);
    };
    const kick = () => {
      if (!spinRaf && !reduceMotion.matches) spinRaf = requestAnimationFrame(spinStep);
    };
    const spinStep = () => {
      spinRaf = 0;
      if (
        reduceMotion.matches ||
        useStore.getState().selectedId !== null ||
        m.getZoom() >= 4 ||
        Date.now() - lastInteract < 10_000 ||
        !m.isStyleLoaded()
      ) {
        return;
      }
      const c = m.getCenter();
      // ~1.5°/s at 60fps: a full turn takes four unhurried minutes.
      m.setCenter([c.lng + 0.025, c.lat]);
      spinRaf = requestAnimationFrame(spinStep);
    };
    const noteInteract = () => {
      lastInteract = Date.now();
      stopSpin();
      retryTimer = window.setTimeout(kick, 10_500);
    };
    // Deselecting also releases the camera: without this the globe would sit
    // still after the card closes, since closing fires no map event.
    const unsub = useStore.subscribe((s, prev) => {
      if (prev.selectedId !== null && s.selectedId === null) {
        lastInteract = Date.now();
        // Clear first: assigning over a pending timer leaks it, and the
        // orphan still fires a kick later.
        window.clearTimeout(retryTimer);
        retryTimer = window.setTimeout(kick, 10_500);
      }
      if (s.selectedId !== null) stopSpin();
    });
    m.on('mousedown', noteInteract);
    m.on('touchstart', noteInteract);
    m.on('wheel', noteInteract);
    // Keyboard panning fires none of the three above, so a keyboard user
    // below zoom 4 had the globe start drifting under them ten seconds in.
    // Bound to the container rather than a map move event on purpose: the
    // drift moves the camera itself, so a move-based listener would read its
    // own frames as interaction and stop the spin immediately.
    const container = m.getContainer();
    container.addEventListener('keydown', noteInteract);
    m.on('idle', kick);
    kick();
    return () => {
      // A stray frame after unmount would drive a removed map.
      stopSpin();
      unsub();
      m.off('mousedown', noteInteract);
      m.off('touchstart', noteInteract);
      m.off('wheel', noteInteract);
      container.removeEventListener('keydown', noteInteract);
      m.off('idle', kick);
    };
  }, []);

  // --- data ---
  useEffect(() => {
    const m = map.current;
    if (!m || !ready.current) return;
    const data = toFeatureCollection(visible);
    (m.getSource(SOURCE) as maplibregl.GeoJSONSource | undefined)?.setData(data);
    (m.getSource(HEAT_SOURCE) as maplibregl.GeoJSONSource | undefined)?.setData(data);
    if (import.meta.env.DEV) {
      document.documentElement.dataset.mapSourceFeatures = String(data.features.length);
    }
  }, [visible]);

  // --- selection: the descent ---
  const prevSelected = useRef<string | null>(null);
  useEffect(() => {
    const m = map.current;
    if (!m || !ready.current) {
      prevSelected.current = selectedId;
      return;
    }
    m.setFilter('springs-selected', ['==', ['get', 'id'], selectedId ?? '']);
    const wasSelected = prevSelected.current;
    prevSelected.current = selectedId;
    if (!selectedId) {
      // Card closed: release the tilt where we stand and drift back one
      // context level — never yank the user across the planet for closing
      // a card. No-op on first paint (nothing was selected).
      if (wasSelected === null) return;
      const zoom = Math.max(4, m.getZoom() - 2);
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        m.jumpTo({ pitch: 0, zoom });
      } else {
        flight.current += 1;
        m.easeTo({ pitch: 0, zoom, duration: 800 });
      }
      return;
    }
    const spring = useStore.getState().springs.find((s) => s.id === selectedId);
    if (!spring) return;
    const center: [number, number] = [spring.location.lng, spring.location.lat];
    // Leave room for the detail card on wide screens. The key is omitted
    // entirely when there is no room to leave: passing `padding: undefined`
    // is not the same as passing nothing -- MapLibre reads `.top` off it and
    // throws, which unmounted the whole React tree and blanked the page on
    // every narrow-viewport selection.
    const padding =
      window.innerWidth >= 1024 ? { right: 420, top: 0, bottom: 0, left: 0 } : null;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      m.jumpTo({ center, zoom: 12 });
      return;
    }
    const run = ++flight.current;
    // Stage 1 — the arc: flyTo curves over the globe and arrives pitched at
    // 55°, so the last second is a swoop over 3D terrain on satellite.
    m.flyTo({ center, zoom: 10.5, pitch: 55, duration: 2600, ...(padding ? { padding } : {}) });
    m.once('moveend', () => {
      // Lost the race (user grabbed the camera, or a newer selection)? Then
      // this leg never happened — stand down instead of yanking the view.
      if (flight.current !== run || useStore.getState().selectedId !== selectedId) return;
      // Stage 2 — settle top-down onto the water.
      m.easeTo({ center, zoom: 12.5, pitch: 0, duration: 1400 });
    });
  }, [selectedId]);

  // --- user location ---
  useEffect(() => {
    const m = map.current;
    if (!m || !userLocation) return;
    const marker = new maplibregl.Marker({ color: '#4bab8f' })
      .setLngLat([userLocation.lng, userLocation.lat])
      .addTo(m);
    // "Near me" is a new intention like any other: stand down the descent.
    flight.current += 1;
    m.easeTo({ center: [userLocation.lng, userLocation.lat], zoom: 6, duration: 1200 });
    return () => {
      marker.remove();
    };
  }, [userLocation]);

  return (
    <div ref={container} className="absolute inset-0" aria-label="Map of hot springs" role="application">
      <div className="map-vignette pointer-events-none absolute inset-0 z-[1]" aria-hidden />
    </div>
  );
}
