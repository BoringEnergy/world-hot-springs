import { useEffect, useRef } from 'react';
import maplibregl, { type MapGeoJSONFeature } from 'maplibre-gl';
import type { HotSpring } from '../lib/types';
import { TEMP_BANDS, UNKNOWN_TEMP_COLOR } from '../lib/types';
import { useStore } from '../store/useStore';

const SOURCE = 'springs';

/**
 * CARTO's dark basemap is keyless and free, so the atlas has no API-token
 * dependency and nothing to leak. Attribution is rendered by MapLibre's own
 * control from the style, and repeated in the About panel.
 */
const STYLE = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';

/**
 * Colour ramp driven by the same bands the legend and filters use, expressed as
 * a MapLibre step expression so every point is coloured on the GPU rather than
 * in JS.
 */
function tempColorExpression() {
  // step(tc, coolColor, 30, warmColor, 38, hotColor, ...)
  const step: unknown[] = ['step', ['get', 'tc'], TEMP_BANDS[0].color];
  TEMP_BANDS.forEach((band, i) => {
    const next = TEMP_BANDS[i + 1];
    if (!next) return;
    step.push(band.maxC, next.color);
  });
  // -999 is the "no reading" sentinel; it must not fall through to the coolest
  // band, or every unmeasured spring would render as a cold one.
  return ['case', ['==', ['get', 'tc'], -999], UNKNOWN_TEMP_COLOR, step] as never;
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

      m.addSource(SOURCE, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });

      // Soft outer glow: reads as heat without drawing a literal steam sprite.
      m.addLayer({
        id: 'springs-glow',
        type: 'circle',
        source: SOURCE,
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
      m.addLayer({
        id: 'springs-label',
        type: 'symbol',
        source: SOURCE,
        minzoom: 7,
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

      const onEnter = () => (m.getCanvas().style.cursor = 'pointer');
      const onLeave = () => (m.getCanvas().style.cursor = '');
      m.on('mouseenter', 'springs', onEnter);
      m.on('mouseleave', 'springs', onLeave);

      m.on('click', 'springs', (e) => {
        const f = e.features?.[0] as MapGeoJSONFeature | undefined;
        if (f?.properties?.id) select(String(f.properties.id));
      });
      // Clicking empty ocean closes the card.
      m.on('click', (e) => {
        const hits = m.queryRenderedFeatures(e.point, { layers: ['springs'] });
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
      // Push whatever the store already has.
      const data = toFeatureCollection(useStore.getState().visible);
      (m.getSource(SOURCE) as maplibregl.GeoJSONSource)?.setData(data);
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

  // --- data ---
  useEffect(() => {
    const m = map.current;
    if (!m || !ready.current) return;
    const src = m.getSource(SOURCE) as maplibregl.GeoJSONSource | undefined;
    const data = toFeatureCollection(visible);
    src?.setData(data);
    if (import.meta.env.DEV) {
      document.documentElement.dataset.mapSourceFeatures = String(data.features.length);
    }
  }, [visible]);

  // --- selection ---
  useEffect(() => {
    const m = map.current;
    if (!m || !ready.current) return;
    m.setFilter('springs-selected', ['==', ['get', 'id'], selectedId ?? '']);
    if (!selectedId) return;
    const spring = useStore.getState().springs.find((s) => s.id === selectedId);
    if (!spring) return;
    // Leave room for the detail card on wide screens. The key is omitted
    // entirely when there is no room to leave: passing `padding: undefined`
    // is not the same as passing nothing -- MapLibre reads `.top` off it and
    // throws, which unmounted the whole React tree and blanked the page on
    // every narrow-viewport selection.
    const padding =
      window.innerWidth >= 1024 ? { right: 420, top: 0, bottom: 0, left: 0 } : null;
    m.easeTo({
      center: [spring.location.lng, spring.location.lat],
      zoom: Math.max(m.getZoom(), 8.5),
      duration: 900,
      ...(padding ? { padding } : {}),
    });
  }, [selectedId]);

  // --- user location ---
  useEffect(() => {
    const m = map.current;
    if (!m || !userLocation) return;
    const marker = new maplibregl.Marker({ color: '#4bab8f' })
      .setLngLat([userLocation.lng, userLocation.lat])
      .addTo(m);
    m.easeTo({ center: [userLocation.lng, userLocation.lat], zoom: 6, duration: 1200 });
    return () => {
      marker.remove();
    };
  }, [userLocation]);

  return <div ref={container} className="absolute inset-0" aria-label="Map of hot springs" role="application" />;
}
