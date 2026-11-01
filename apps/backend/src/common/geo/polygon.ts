/**
 * Planar geometry on WGS84 lng/lat for micro-market polygons (a few km across, so treating
 * degrees as planar is accurate enough for validation). Used to validate input in both modes and
 * as the in-memory stand-in for PostGIS in fake mode (DATA_STORE=memory). With Postgres,
 * serviceability and overlap are decided by PostGIS; these functions must agree with it on
 * every seeded and tested case.
 */
export type Position = [lng: number, lat: number];

/** GeoJSON Polygon with a single outer ring (holes are not supported for micro-markets). */
export interface GeoPolygon {
  type: 'Polygon';
  coordinates: [Position[]];
}

export interface LatLng {
  lat: number;
  lng: number;
}

const EPS = 1e-12;

const cross = (o: Position, a: Position, b: Position) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

/** Proper crossing of segments ab and cd (touching at endpoints/collinear overlap is not a crossing). */
function segmentsCross(a: Position, b: Position, c: Position, d: Position): boolean {
  const d1 = cross(c, d, a);
  const d2 = cross(c, d, b);
  const d3 = cross(a, b, c);
  const d4 = cross(a, b, d);
  return ((d1 > EPS && d2 < -EPS) || (d1 < -EPS && d2 > EPS)) && ((d3 > EPS && d4 < -EPS) || (d3 < -EPS && d4 > EPS));
}

/** Returns a list of problems; empty means valid. */
export function polygonProblems(p: GeoPolygon): string[] {
  const problems: string[] = [];
  if (p.type !== 'Polygon' || !Array.isArray(p.coordinates) || p.coordinates.length !== 1)
    return ['Polygon must have exactly one outer ring'];
  const ring = p.coordinates[0];
  if (ring.length < 4) problems.push('Ring needs at least 3 distinct points plus the closing point');
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (!first || !last || first[0] !== last[0] || first[1] !== last[1]) problems.push('Ring must be closed (last point = first)');
  for (const [lng, lat] of ring)
    if (!(lng >= -180 && lng <= 180 && lat >= -90 && lat <= 90)) {
      problems.push('Coordinates out of range (expected [lng, lat])');
      break;
    }
  if (problems.length) return problems;

  const n = ring.length - 1;
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++) {
      if (Math.abs(i - j) <= 1 || (i === 0 && j === n - 1)) continue; // adjacent edges share a vertex
      if (segmentsCross(ring[i]!, ring[i + 1]!, ring[j]!, ring[j + 1]!)) {
        problems.push('Ring must not intersect itself');
        return problems;
      }
    }
  if (Math.abs(signedArea(ring)) < 1e-10) problems.push('Polygon has no area');
  return problems;
}

function signedArea(ring: Position[]): number {
  let a = 0;
  for (let i = 0; i < ring.length - 1; i++) a += ring[i]![0] * ring[i + 1]![1] - ring[i + 1]![0] * ring[i]![1];
  return a / 2;
}

/** Point inside or on the boundary (matches ST_Covers). */
export function covers(p: GeoPolygon, pt: LatLng): boolean {
  const ring = p.coordinates[0];
  const x = pt.lng;
  const y = pt.lat;
  for (let i = 0; i < ring.length - 1; i++) {
    const a = ring[i]!;
    const b = ring[i + 1]!;
    const onLine = Math.abs(cross(a, b, [x, y])) < EPS;
    const within = x >= Math.min(a[0], b[0]) - EPS && x <= Math.max(a[0], b[0]) + EPS && y >= Math.min(a[1], b[1]) - EPS && y <= Math.max(a[1], b[1]) + EPS;
    if (onLine && within) return true;
  }
  let inside = false;
  for (let i = 0, j = ring.length - 2; i < ring.length - 1; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Interiors overlap (shared edges or touching corners do not count) — matches ST_Overlaps/ST_Within on interiors. */
export function interiorsOverlap(a: GeoPolygon, b: GeoPolygon): boolean {
  const ra = a.coordinates[0];
  const rb = b.coordinates[0];
  for (let i = 0; i < ra.length - 1; i++)
    for (let j = 0; j < rb.length - 1; j++) if (segmentsCross(ra[i]!, ra[i + 1]!, rb[j]!, rb[j + 1]!)) return true;
  // No proper crossings: overlap only if one contains the other (test an interior point of each).
  return strictlyInside(b, interiorPoint(a)) || strictlyInside(a, interiorPoint(b));
}

function strictlyInside(p: GeoPolygon, pt: LatLng): boolean {
  const ring = p.coordinates[0];
  for (let i = 0; i < ring.length - 1; i++) {
    const a = ring[i]!;
    const b = ring[i + 1]!;
    const onLine = Math.abs(cross(a, b, [pt.lng, pt.lat])) < EPS;
    const within = pt.lng >= Math.min(a[0], b[0]) && pt.lng <= Math.max(a[0], b[0]) && pt.lat >= Math.min(a[1], b[1]) && pt.lat <= Math.max(a[1], b[1]);
    if (onLine && within) return false;
  }
  return covers(p, pt);
}

/** A point strictly inside the polygon: centroid of a triangle fan, nudged until inside. */
function interiorPoint(p: GeoPolygon): LatLng {
  const ring = p.coordinates[0];
  for (let i = 1; i < ring.length - 2; i++) {
    const c = { lng: (ring[0]![0] + ring[i]![0] + ring[i + 1]![0]) / 3, lat: (ring[0]![1] + ring[i]![1] + ring[i + 1]![1]) / 3 };
    if (strictlyInside(p, c)) return c;
  }
  return { lng: ring[0]![0], lat: ring[0]![1] };
}

/** Great-circle distance in metres (matches ST_Distance on geography to well under 1%). */
export function haversineMeters(a: LatLng, b: LatLng): number {
  const R = 6_371_008.8;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Coordinates are stored at 7 decimals (~1 cm): both stores keep identical values (PostGIS prints 9). */
export const COORD_DECIMALS = 7;
const round = (x: number) => Math.round(x * 10 ** COORD_DECIMALS) / 10 ** COORD_DECIMALS;

export function roundPolygon(p: GeoPolygon): GeoPolygon {
  return { type: 'Polygon', coordinates: [p.coordinates[0].map(([lng, lat]) => [round(lng), round(lat)] as Position)] };
}

/** Axis-aligned rectangle polygon, handy for seeds and tests. */
export function rect(minLng: number, minLat: number, maxLng: number, maxLat: number): GeoPolygon {
  return {
    type: 'Polygon',
    coordinates: [
      [
        [minLng, minLat],
        [maxLng, minLat],
        [maxLng, maxLat],
        [minLng, maxLat],
        [minLng, minLat],
      ],
    ],
  };
}
