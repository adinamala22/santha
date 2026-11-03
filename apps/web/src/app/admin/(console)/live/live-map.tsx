'use client';

import 'maplibre-gl/dist/maplibre-gl.css';
import type { GeoJSONSource, Map as MlMap } from 'maplibre-gl';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import tokens from '../../../../../../../design/tokens/tailwind.tokens.js';

/** Served from public/ by scripts/sync-brand.mjs (MapLibre 6 cannot locate its worker inside a Next bundle). */
const MAPLIBRE_WORKER = '/maplibre/maplibre-gl-worker.mjs';
const TILES = process.env.NEXT_PUBLIC_MAP_TILES_URL ?? 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const C = tokens.colors;

export interface LivePoint {
  kind: 'rider' | 'store';
  lat: number;
  lng: number;
  label: string;
}

/** Riders (marigold) and stores with active orders (indigo) on the city map. */
export function LiveMap({ points, unavailable, height = 380 }: { points: LivePoint[]; unavailable: string; height?: number }) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<MlMap | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const ml = await import('maplibre-gl');
        ml.setWorkerUrl(MAPLIBRE_WORKER);
        if (cancelled || !box.current) return;
        const m = new ml.Map({
          container: box.current,
          style: {
            version: 8,
            sources: { tiles: { type: 'raster', tiles: [TILES], tileSize: 256, attribution: '© OpenStreetMap contributors' } },
            layers: [{ id: 'tiles', type: 'raster', source: 'tiles', paint: { 'raster-saturation': -0.6, 'raster-opacity': 0.8 } }],
          },
          center: [79.99, 14.45],
          zoom: 12.5,
        });
        m.addControl(new ml.NavigationControl({ showCompass: false }), 'top-right');
        m.on('load', () => {
          m.addSource('points', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
          m.addLayer({
            id: 'points',
            type: 'circle',
            source: 'points',
            paint: {
              'circle-radius': ['case', ['==', ['get', 'kind'], 'rider'], 7, 6],
              'circle-color': ['case', ['==', ['get', 'kind'], 'rider'], C.marigold.DEFAULT, C.indigo.DEFAULT],
              'circle-stroke-color': C.cream,
              'circle-stroke-width': 2,
            },
          });
          m.addLayer({ id: 'labels', type: 'symbol', source: 'points', layout: { 'text-field': ['get', 'label'], 'text-size': 11, 'text-offset': [0, 1.3] }, paint: { 'text-color': C.ink, 'text-halo-color': C.cream, 'text-halo-width': 2 } });
          setReady(true);
        });
        map.current = m;
      } catch {
        setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
      map.current?.remove();
      map.current = null;
    };
  }, []);

  useEffect(() => {
    const m = map.current;
    if (!ready || !m) return;
    (m.getSource('points') as GeoJSONSource).setData({
      type: 'FeatureCollection',
      features: points.map((p) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [p.lng, p.lat] }, properties: { kind: p.kind, label: p.label } })),
    });
  }, [ready, points]);

  if (failed) return <p className="text-slate">{unavailable}</p>;
  return <div ref={box} data-testid="live-map" style={{ height }} className="w-full overflow-hidden rounded-md" />;
}

/** Re-renders the server page every `seconds` (fresh KPIs, positions and attention items). */
export function AutoRefresh({ seconds }: { seconds: number }) {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => router.refresh(), seconds * 1000);
    return () => clearInterval(t);
  }, [router, seconds]);
  return null;
}
