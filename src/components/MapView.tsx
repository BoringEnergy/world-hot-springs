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
 * a MapLibre step expression so 14k points are coloured on the GPU rather than
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
      center: [10, 25],
      zoom: 1.4,
      minZoom: 0.6,
      maxZoom: 16,
      attributionControl: { compact: true },
      // The globe is the point. It also makes the geothermal belt legible in a
      // way a Mercator map actively hides.
      // @ts-expect-error projection is supported at runtime in maplibre-gl v5
      projection: { type: 'globe' },
    });

    m.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'bottom-right');
    m.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');
    m.dragRotate.enable();

    m.on('load', () => {
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
      // Push whatever the store already has.
      const data = toFeatureCollection(useStore.getState().visible);
      (m.getSource(SOURCE) as maplibregl.GeoJSONSource)?.setData(data);
    });

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
    src?.setData(toFeatureCollection(visible));
  }, [visible]);

  // --- selection ---
  useEffect(() => {
    const m = map.current;
    if (!m || !ready.current) return;
    m.setFilter('springs-selected', ['==', ['get', 'id'], selectedId ?? '']);
    if (!selectedId) return;
    const spring = useStore.getState().springs.find((s) => s.id === selectedId);
    if (!spring) return;
    m.easeTo({
      center: [spring.location.lng, spring.location.lat],
      zoom: Math.max(m.getZoom(), 8.5),
      duration: 900,
      // Leave room for the detail card on wide screens.
      padding: window.innerWidth >= 1024 ? { right: 420, top: 0, bottom: 0, left: 0 } : undefined,
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
