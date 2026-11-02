'use client';

import 'maplibre-gl/dist/maplibre-gl.css';
import type { GeoJSONSource, Map as MlMap, Marker } from 'maplibre-gl';
import { useEffect, useRef, useState } from 'react';
import tokens from '../../../../../design/tokens/tailwind.tokens.js';
import { addVertex, bounds, closeRing, moveVertex, type Position, removeVertex } from '@/lib/polygon-edit';

export interface Shape {
  id: string;
  label: string;
  ring: Position[]; // closed ring
  highlight?: boolean;
}

/**
 * Raster tiles for the editor. OpenStreetMap by default (fine for internal ops use at low volume);
 * production can point NEXT_PUBLIC_MAP_TILES_URL at Google/MapTiler tiles (ADR-007).
 */
const TILES = process.env.NEXT_PUBLIC_MAP_TILES_URL ?? 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const C = tokens.colors;

/**
 * Micro-market map (MapLibre). Read-only shapes for context, plus an optional editable ring:
 * click to add a point, drag a point to move it, right-click a point to remove it.
 */
export function PolygonMap({
  shapes,
  edit,
  height = 420,
  unavailable,
}: {
  shapes: Shape[];
  edit?: { ring: Position[]; onChange: (ring: Position[]) => void };
  height?: number;
  unavailable: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<MlMap | null>(null);
  const markers = useRef<Marker[]>([]);
  const lib = useRef<typeof import('maplibre-gl') | null>(null);
  const editRef = useRef(edit);
  editRef.current = edit;
  const [failed, setFailed] = useState(false);
  const [ready, setReady] = useState(false);

  // Create the map once.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const ml = await import('maplibre-gl');
        if (cancelled || !box.current) return;
        lib.current = ml;
        const m = new ml.Map({
          container: box.current,
          style: {
            version: 8,
            sources: { tiles: { type: 'raster', tiles: [TILES], tileSize: 256, attribution: '© OpenStreetMap contributors' } },
            layers: [{ id: 'tiles', type: 'raster', source: 'tiles', paint: { 'raster-saturation': -0.6, 'raster-opacity': 0.8 } }],
          },
          center: [79.98, 14.44],
          zoom: 12,
        });
        m.addControl(new ml.NavigationControl({ showCompass: false }), 'top-right');
        m.on('load', () => {
          const empty = { type: 'FeatureCollection' as const, features: [] };
          m.addSource('shapes', { type: 'geojson', data: empty });
          m.addSource('edit', { type: 'geojson', data: empty });
          m.addLayer({ id: 'shapes-fill', type: 'fill', source: 'shapes', paint: { 'fill-color': ['case', ['get', 'highlight'], C.marigold.DEFAULT, C.indigo.DEFAULT], 'fill-opacity': 0.12 } });
          m.addLayer({ id: 'shapes-line', type: 'line', source: 'shapes', paint: { 'line-color': C.indigo.DEFAULT, 'line-width': 2 } });
          m.addLayer({ id: 'shapes-label', type: 'symbol', source: 'shapes', layout: { 'text-field': ['get', 'label'], 'text-size': 13 }, paint: { 'text-color': C.indigo.DEFAULT, 'text-halo-color': C.cream, 'text-halo-width': 2 } });
          m.addLayer({ id: 'edit-fill', type: 'fill', source: 'edit', paint: { 'fill-color': C.marigold.DEFAULT, 'fill-opacity': 0.25 } });
          m.addLayer({ id: 'edit-line', type: 'line', source: 'edit', paint: { 'line-color': C.marigold[600], 'line-width': 3 } });
          setReady(true);
        });
        m.on('click', (e) => {
          const ed = editRef.current;
          if (ed) ed.onChange(addVertex(ed.ring, [e.lngLat.lng, e.lngLat.lat]));
        });
        m.on('error', () => undefined); // tile errors are not fatal
        // The container is sized by the page grid after mount; keep the canvas in step.
        const ro = new ResizeObserver(() => m.resize());
        ro.observe(box.current);
        m.once('remove', () => ro.disconnect());
        map.current = m;
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
      map.current?.remove();
      map.current = null;
    };
  }, []);

  // Context shapes + fit to everything once loaded.
  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    (m.getSource('shapes') as GeoJSONSource).setData({
      type: 'FeatureCollection',
      features: shapes.map((s) => ({ type: 'Feature', properties: { label: s.label, highlight: !!s.highlight }, geometry: { type: 'Polygon', coordinates: [s.ring] } })),
    });
    const b = bounds([...shapes.map((s) => s.ring), editRef.current?.ring ?? []]);
    if (b) m.fitBounds(b, { padding: 40, duration: 0, maxZoom: 15 });
  }, [shapes, ready]);

  // Editable ring + draggable vertex markers.
  useEffect(() => {
    const m = map.current;
    const ml = lib.current;
    if (!m || !ml || !ready) return;
    const ring = edit?.ring ?? [];
    (m.getSource('edit') as GeoJSONSource).setData({
      type: 'FeatureCollection',
      features:
        ring.length >= 3
          ? [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [closeRing(ring)] } }]
          : ring.length === 2
            ? [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: ring } }]
            : [],
    });
    markers.current.forEach((mk) => mk.remove());
    markers.current = ring.map((p, i) => {
      const el = document.createElement('button');
      el.type = 'button';
      el.setAttribute('aria-label', `Point ${i + 1}`);
      el.className = 'h-4 w-4 rounded-pill border-2 border-white bg-marigold-600 shadow-card';
      el.addEventListener('contextmenu', (ev) => {
        ev.preventDefault();
        const ed = editRef.current;
        if (ed) ed.onChange(removeVertex(ed.ring, i));
      });
      el.addEventListener('click', (ev) => ev.stopPropagation());
      const mk = new ml.Marker({ element: el, draggable: true }).setLngLat(p).addTo(m);
      mk.on('dragend', () => {
        const ed = editRef.current;
        const ll = mk.getLngLat();
        if (ed) ed.onChange(moveVertex(ed.ring, i, [ll.lng, ll.lat]));
      });
      return mk;
    });
  }, [edit?.ring, ready]);

  if (failed) return <p className="rounded-md bg-sky p-6 text-slate">{unavailable}</p>;
  return <div ref={box} style={{ height }} className={`w-full overflow-hidden rounded-md bg-sky ${edit ? 'cursor-crosshair' : ''}`} />;
}
