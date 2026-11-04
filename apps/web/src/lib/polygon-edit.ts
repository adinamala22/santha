/**
 * Pure helpers for the micro-market polygon editor. The editor keeps an OPEN ring (no repeated
 * closing point) while drawing; the API takes a CLOSED GeoJSON ring of [lng, lat] positions.
 */
export type Position = [number, number];

export const closeRing = (open: Position[]): Position[] => (open.length ? [...open, open[0]!] : []);

export function openRing(closed: Position[]): Position[] {
  const [first] = closed;
  const last = closed[closed.length - 1];
  return first && last && closed.length > 1 && first[0] === last[0] && first[1] === last[1] ? closed.slice(0, -1) : [...closed];
}

const round7 = (x: number) => Math.round(x * 1e7) / 1e7;
export const roundPos = ([lng, lat]: Position): Position => [round7(lng), round7(lat)];

export const addVertex = (ring: Position[], p: Position): Position[] => [...ring, roundPos(p)];
export const moveVertex = (ring: Position[], i: number, p: Position): Position[] => ring.map((v, j) => (j === i ? roundPos(p) : v));
export const removeVertex = (ring: Position[], i: number): Position[] => ring.filter((_, j) => j !== i);

const cross = (o: Position, a: Position, b: Position) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
function crosses(a: Position, b: Position, c: Position, d: Position): boolean {
  const d1 = cross(c, d, a);
  const d2 = cross(c, d, b);
  const d3 = cross(a, b, c);
  const d4 = cross(a, b, d);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

/** Problems to show before sending (the backend validates again, including overlap). */
export function ringProblems(open: Position[]): Array<'tooFew' | 'selfIntersects'> {
  if (open.length < 3) return ['tooFew'];
  const ring = closeRing(open);
  const n = open.length;
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++) {
      if (j === i + 1 || (i === 0 && j === n - 1)) continue;
      if (crosses(ring[i]!, ring[i + 1]!, ring[j]!, ring[j + 1]!)) return ['selfIntersects'];
    }
  return [];
}

/** [[minLng, minLat], [maxLng, maxLat]] of all rings, or null if empty. */
export function bounds(rings: Position[][]): [Position, Position] | null {
  const pts = rings.flat();
  if (!pts.length) return null;
  const lngs = pts.map((p) => p[0]);
  const lats = pts.map((p) => p[1]);
  return [
    [Math.min(...lngs), Math.min(...lats)],
    [Math.max(...lngs), Math.max(...lats)],
  ];
}

/**
 * A circle as an open ring of `sides` points (ops define a micro-market as centre + radius, ADR-019).
 * Same projection as the backend's circlePolygon, so both agree to the centimetre.
 */
export function circleRing(centre: { lat: number; lng: number }, radiusM: number, sides = 48): Position[] {
  const R = 6_371_008.8;
  const dLat = (radiusM / R) * (180 / Math.PI);
  const dLng = dLat / Math.cos((centre.lat * Math.PI) / 180);
  return Array.from({ length: sides }, (_, i) => {
    const a = (2 * Math.PI * i) / sides;
    return roundPos([centre.lng + dLng * Math.cos(a), centre.lat + dLat * Math.sin(a)]);
  });
}
